// Query building for GET /api/admin/payments.
//
// The controller accepted page, limit, search, status and sort, and applied
// exactly one of them to the database:
//
//   const records = await coursePaymentSchema
//     .find(match)                      // match held the date range, nothing else
//     .populate("userId", "name email")
//     .populate("courseId", "C_title C_price")
//     .lean();
//
//   let sanitizedPayments = records.map(buildSanitizedPayment);
//   if (search) { sanitizedPayments = sanitizedPayments.filter(...) }
//   if (status) { sanitizedPayments = sanitizedPayments.filter(...) }
//   sanitizedPayments.sort(sorters[sort]);
//   const paginatedPayments = sanitizedPayments.slice(startIndex, startIndex + limit);
//
// No skip, no limit, no sort on the query. Search, status, ordering, the
// summary totals and the slice all ran in Node over the whole collection, to
// return a page of at most fifty rows — and a payment row is written on every
// enrolment, free courses included, so this is the admin table that grows
// fastest (#104).
//
// It is the same defect #96 fixed for the user and course lists. Everything is
// pushed into one aggregation here: $match the date range, $lookup the user and
// the course, $addFields the normalised status and the numeric amount, $match
// search and status, then $facet the rows, the summary and the count so a
// single round trip answers all three and they cannot disagree.
//
// Two things resisted a plain find(). The stored status has five spellings that
// map onto three ("enrolled", "paid" and "completed" are all successful), and
// the amount lives on the joined course as C_price, a free-form String. Both
// become computed fields before the $match that needs them.

const { escapeRegex, normalizeText } = require("./courseListing");

const ALLOWED_STATUSES = new Set([
  "successful",
  "pending",
  "failed",
  // #128. A student can leave a course now. The payment row is kept and
  // marked rather than deleted — a financial record must not disappear
  // because somebody changed their mind — so the ledger needs a bucket for
  // it. Without one it would fall through STATUS_EXPRESSION's default and be
  // reported as "pending", which is the wrong answer twice over: nothing is
  // pending, and it would inflate a number an admin reads as work to do.
  "withdrawn",
]);

const ALLOWED_SORTS = new Set([
  "newest",
  "oldest",
  "amount-asc",
  "amount-desc",
]);

const SUCCESSFUL_STATUS_VALUES = [
  "success",
  "successful",
  "completed",
  "paid",
  "enrolled",
];

const FAILED_STATUS_VALUES = ["failed", "declined", "rejected", "cancelled"];

// Deliberately its own bucket rather than a member of FAILED_STATUS_VALUES. A
// withdrawal is not a payment that failed: the money moved, and whether it
// comes back is a question this application does not answer.
const WITHDRAWN_STATUS_VALUES = ["withdrawn"];

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 120;

// The strings the old row shaper substituted for a missing reference. Kept
// exactly, because they are searchable: an admin looking for orphaned rows
// types "Deleted" into the search box and the filter has to still find them.
const UNKNOWN_EMAIL = "Unknown";
const MISSING_COURSE_TITLE = "Deleted or unavailable course";

/**
 * Parses one page-size or page-number value.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} maximum
 * @returns {number}
 */
function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(
    Array.isArray(value) ? value[0] : value,
    10,
  );

  if (!Number.isFinite(parsed) || parsed < 1) return fallback;

  return Math.min(parsed, maximum);
}

/**
 * Parses a date boundary, widening a bare YYYY-MM-DD end date to the end of
 * that day so "up to the 5th" includes the 5th.
 *
 * @param {unknown} value
 * @param {boolean} [endOfDay]
 * @returns {Date|null}
 */
function parseDateBoundary(value, endOfDay = false) {
  if (!value) return null;

  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) return null;

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
}

/**
 * Validates the query string and returns the filters to build a pipeline from.
 *
 * Every rejection the old controller produced is reproduced here, with the same
 * messages, so the client sees no change in behaviour on a bad request.
 *
 * @param {object} [query]
 * @returns {{ valid: boolean, message?: string, value?: object }}
 */
function parsePaymentQuery(query = {}) {
  const page = parsePositiveInteger(query.page, 1, 100000);
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const search = normalizeText(query.search, MAX_SEARCH_LENGTH);
  const status = normalizeText(query.status, 30).toLowerCase();
  const sort = normalizeText(query.sort, 30).toLowerCase() || "newest";

  if (status && !ALLOWED_STATUSES.has(status)) {
    return { valid: false, message: "Invalid payment status filter." };
  }

  if (!ALLOWED_SORTS.has(sort)) {
    return { valid: false, message: "Invalid payment sort option." };
  }

  const startDate = parseDateBoundary(query.startDate);
  const endDate = parseDateBoundary(query.endDate, true);

  if (query.startDate && !startDate) {
    return { valid: false, message: "Invalid start date." };
  }

  if (query.endDate && !endDate) {
    return { valid: false, message: "Invalid end date." };
  }

  if (startDate && endDate && startDate > endDate) {
    return { valid: false, message: "Start date cannot be after end date." };
  }

  return {
    valid: true,
    value: { page, limit, search, status, sort, startDate, endDate },
  };
}

/**
 * The date-range match, which is the only filter that can run before the joins.
 *
 * @param {object} filters
 * @returns {object} a Mongo filter, possibly empty
 */
function buildDateMatch({ startDate, endDate } = {}) {
  if (!startDate && !endDate) return {};

  const createdAt = {};

  if (startDate) createdAt.$gte = startDate;
  if (endDate) createdAt.$lte = endDate;

  return { createdAt };
}

/**
 * Maps the five stored status spellings onto the three the dashboard shows.
 *
 * This is what stopped the status filter running in the database: it is a
 * property of the normalised value, not of the stored one, so it has to become
 * a computed field before it can be matched.
 */
const STATUS_EXPRESSION = {
  $let: {
    vars: {
      stored: {
        $toLower: {
          $trim: { input: { $ifNull: ["$status", ""] } },
        },
      },
    },
    in: {
      $switch: {
        branches: [
          {
            case: { $in: ["$$stored", SUCCESSFUL_STATUS_VALUES] },
            then: "successful",
          },
          {
            case: { $in: ["$$stored", FAILED_STATUS_VALUES] },
            then: "failed",
          },
          {
            case: { $in: ["$$stored", WITHDRAWN_STATUS_VALUES] },
            then: "withdrawn",
          },
        ],
        default: "pending",
      },
    },
  },
};

/**
 * Reads a number out of the joined course's C_price.
 *
 * C_price is a String on courseModel — "499", "Rs. 1,299", "free". The old code
 * ran parseFloat over a regex-stripped copy for every row in the collection on
 * every request, including when the sort had nothing to do with the amount.
 *
 * Commas are removed first so a grouped number is not truncated at the comma,
 * then the first numeric run is taken. Anything with no numeric run at all —
 * "free" — comes out as 0, which is what parseAmount did.
 */
const AMOUNT_EXPRESSION = {
  $let: {
    vars: {
      digits: {
        $regexFind: {
          input: {
            $replaceAll: {
              input: { $ifNull: ["$course.C_price", ""] },
              find: ",",
              replacement: "",
            },
          },
          regex: "[0-9]+(?:\\.[0-9]+)?",
        },
      },
    },
    in: {
      $convert: {
        input: { $ifNull: ["$$digits.match", "0"] },
        to: "double",
        onError: 0,
        onNull: 0,
      },
    },
  },
};

/**
 * The searchable text for one row.
 *
 * The fallbacks are the ones the old row shaper used, because they were
 * searchable: filtering on "Deleted" found the orphaned rows, and that has to
 * keep working.
 */
const SEARCH_EXPRESSION = {
  $concat: [
    { $toString: "$_id" },
    " ",
    { $ifNull: ["$student.email", UNKNOWN_EMAIL] },
    " ",
    { $ifNull: ["$student.name", ""] },
    " ",
    { $ifNull: ["$course.C_title", MISSING_COURSE_TITLE] },
  ],
};

/**
 * The sort, always with an _id tiebreak.
 *
 * The old in-memory comparators had none, so two payments sharing a timestamp —
 * ordinary when a seed script or a burst of enrolments writes several in the
 * same millisecond — could swap places between two requests and make a row
 * appear on both page one and page two, or on neither.
 *
 * @param {string} sort
 * @returns {object}
 */
function buildPaymentSort(sort) {
  switch (sort) {
    case "oldest":
      return { createdAt: 1, _id: 1 };

    case "amount-asc":
      return { amount: 1, _id: 1 };

    case "amount-desc":
      return { amount: -1, _id: -1 };

    case "newest":
    default:
      return { createdAt: -1, _id: -1 };
  }
}

/**
 * Builds the whole aggregation.
 *
 * @param {object} filters as returned by parsePaymentQuery
 * @param {object} [options]
 * @param {string} [options.userCollection]
 * @param {string} [options.courseCollection]
 * @returns {object[]} an aggregation pipeline
 */
function buildPaymentPipeline(filters = {}, options = {}) {
  const {
    userCollection = "users",
    courseCollection = "courses",
  } = options;

  const { page, limit, search, status, sort } = filters;
  const skip = (Math.max(1, page || 1) - 1) * (limit || DEFAULT_LIMIT);

  const pipeline = [];

  const dateMatch = buildDateMatch(filters);

  // First, and on an indexed field: coursePaymentModel indexes { createdAt: -1 }.
  if (Object.keys(dateMatch).length > 0) {
    pipeline.push({ $match: dateMatch });
  }

  pipeline.push(
    {
      $lookup: {
        from: userCollection,
        localField: "userId",
        foreignField: "_id",
        as: "student",
        // Only the two columns the table renders. The old populate pulled the
        // same two, but for every payment in the database.
        pipeline: [{ $project: { name: 1, email: 1 } }],
      },
    },
    {
      $lookup: {
        from: courseCollection,
        localField: "courseId",
        foreignField: "_id",
        as: "course",
        pipeline: [{ $project: { C_title: 1, C_price: 1 } }],
      },
    },
    // preserveNullAndEmptyArrays, or a payment whose user or course was deleted
    // would vanish from the dashboard instead of showing as an orphaned row.
    { $unwind: { path: "$student", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$course", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        normalizedStatus: STATUS_EXPRESSION,
        amount: AMOUNT_EXPRESSION,
      },
    },
  );

  if (search) {
    pipeline.push({
      $addFields: { searchText: SEARCH_EXPRESSION },
    });

    // escapeRegex is not optional: the value goes into a RegExp and a bare "("
    // is enough to turn a search box into a 500.
    pipeline.push({
      $match: {
        searchText: { $regex: escapeRegex(search), $options: "i" },
      },
    });
  }

  if (status) {
    pipeline.push({ $match: { normalizedStatus: status } });
  }

  pipeline.push({
    $facet: {
      // The page itself.
      rows: [
        { $sort: buildPaymentSort(sort) },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            createdAt: 1,
            updatedAt: 1,
            amount: 1,
            status: "$normalizedStatus",
            studentId: "$student._id",
            studentName: "$student.name",
            studentEmail: "$student.email",
            courseId: "$course._id",
            courseTitle: "$course.C_title",
            // Both shapes. cardLast4 is what has been stored since #55;
            // cardnumber only exists on rows written before it.
            cardLast4: "$cardDetails.cardLast4",
            cardNumber: "$cardDetails.cardnumber",
          },
        },
      ],
      // Computed over everything the filters matched, not over the page, and in
      // the same pass — so the totals cannot drift from the rows.
      summary: [
        {
          $group: {
            _id: "$normalizedStatus",
            count: { $sum: 1 },
            revenue: { $sum: "$amount" },
          },
        },
      ],
      total: [{ $count: "value" }],
    },
  });

  return pipeline;
}

/**
 * Folds the $facet summary buckets into the block the dashboard renders.
 *
 * @param {Array<{ _id: string, count: number, revenue: number }>} buckets
 * @returns {object}
 */
function buildSummary(buckets = []) {
  const summary = {
    totalTransactions: 0,
    successful: 0,
    pending: 0,
    failed: 0,
    withdrawn: 0,
    totalRevenue: 0,
  };

  for (const bucket of Array.isArray(buckets) ? buckets : []) {
    const status = bucket?._id;
    const count = Number(bucket?.count) || 0;

    summary.totalTransactions += count;

    if (Object.hasOwn(summary, status)) {
      summary[status] += count;
    }

    // Revenue counts successful payments only, as it always has — and a
    // withdrawn row is deliberately not successful, so leaving a course takes
    // its amount back out of the total.
    if (status === "successful") {
      summary.totalRevenue += Number(bucket?.revenue) || 0;
    }
  }

  return summary;
}

/**
 * Masks a card number down to its last four digits.
 *
 * @param {unknown} cardNumber
 * @returns {string|null}
 */
function maskCardNumber(cardNumber) {
  const digits = String(cardNumber || "").replace(/\D/g, "");

  if (digits.length < 4) return null;

  return `•••• •••• •••• ${digits.slice(-4)}`;
}

/**
 * Masks whichever of the two stored shapes the row carries.
 *
 * The old controller read `cardDetails.cardnumber` only. #55 removed that field
 * and stores `cardDetails.cardLast4` instead, so every payment written since
 * then rendered a blank card column. cardLast4 wins; cardnumber is still read
 * for rows written before the change.
 *
 * @param {object} row
 * @returns {string|null}
 */
function maskStoredCard(row = {}) {
  if (row.cardLast4) return maskCardNumber(row.cardLast4);

  return maskCardNumber(row.cardNumber);
}

/**
 * Shapes one projected row into the response body.
 *
 * Runs over the page only — ten rows by default — where the old shaper ran over
 * every payment in the collection to produce those same ten.
 *
 * @param {object} row
 * @returns {object}
 */
function toPaymentRow(row = {}) {
  const amount = Number(row.amount);

  return {
    id: String(row._id),
    student: {
      id: row.studentId ? String(row.studentId) : null,
      name: row.studentName || null,
      email: row.studentEmail || UNKNOWN_EMAIL,
    },
    course: {
      id: row.courseId ? String(row.courseId) : null,
      title: row.courseTitle || MISSING_COURSE_TITLE,
    },
    amount: Number.isFinite(amount) ? amount : 0,
    currency: "INR",
    status: row.status || "pending",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    maskedCard: maskStoredCard(row),
  };
}

/**
 * Turns the single $facet document into the response body.
 *
 * @param {object} facet the one document the aggregation returns
 * @param {object} filters as returned by parsePaymentQuery
 * @returns {{ data: object[], summary: object, pagination: object }}
 */
function readPaymentFacet(facet, filters = {}) {
  const rows = Array.isArray(facet?.rows) ? facet.rows : [];
  const totalItems = Number(facet?.total?.[0]?.value) || 0;
  const limit = filters.limit || DEFAULT_LIMIT;

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const page = Math.min(Math.max(1, filters.page || 1), totalPages);

  return {
    data: rows.map(toPaymentRow),
    summary: buildSummary(facet?.summary),
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
      hasPreviousPage: page > 1,
      hasNextPage: page < totalPages,
    },
  };
}

/**
 * Whether the requested page sits past the end of the result set.
 *
 * The old code clamped by slicing an array it already had. An aggregation has
 * skipped past the end before it knows how many rows there were, so an
 * out-of-range page is detected from the count and re-run once, rather than
 * returning an empty page for a non-empty result set.
 *
 * @param {object} filters
 * @param {number} totalItems
 * @returns {number|null} the page to retry with, or null when none is needed
 */
function clampedPage(filters = {}, totalItems = 0) {
  const limit = filters.limit || DEFAULT_LIMIT;
  const page = Math.max(1, filters.page || 1);

  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));

  return page > totalPages ? totalPages : null;
}

module.exports = {
  ALLOWED_SORTS,
  ALLOWED_STATUSES,
  AMOUNT_EXPRESSION,
  DEFAULT_LIMIT,
  FAILED_STATUS_VALUES,
  WITHDRAWN_STATUS_VALUES,
  MAX_LIMIT,
  MISSING_COURSE_TITLE,
  STATUS_EXPRESSION,
  SUCCESSFUL_STATUS_VALUES,
  UNKNOWN_EMAIL,
  buildDateMatch,
  buildPaymentPipeline,
  buildPaymentSort,
  buildSummary,
  clampedPage,
  maskCardNumber,
  maskStoredCard,
  parseDateBoundary,
  parsePaymentQuery,
  parsePositiveInteger,
  readPaymentFacet,
  toPaymentRow,
};
