// What "free" means, once.
//
// It used to mean three different things, and they disagreed on half of a
// small sample of realistic prices (#114):
//
//   utils/courseListing.js   /^\s*(?:free|0(?:\.0+)?)\s*$/i      the catalogue
//   utils/paymentDetails.js  new Set(["", "0", "free"])          checkout
//   utils/bookmarkListing.js /[0-9]/ anywhere means paid         the wishlist
//
//   price        catalogue checkout wishlist
//   "0"          free      free     paid      <-- DISAGREE
//   "0.00"       free      paid     paid      <-- DISAGREE
//   ""           paid      free     free      <-- DISAGREE
//
// The visible half of that: a course priced "0.00" rendered ACCESS: Free on
// its catalogue card, so clicking Enroll skipped the payment modal, so the
// request carried four empty strings, so the server — following a different
// rule — rejected it as an unpaid paid course. There was no path through the
// UI to the payment form, because the UI did not believe there was anything to
// pay. The course could not be enrolled in at all.
//
// C_price is a free-form String on courseModel with no `required`, so every
// shape below is reachable in stored data. `normalizeCoursePrice` runs on
// write and collapses the free forms to one label, but it only arrived with
// #83 — anything created before that, or written directly, is still whatever
// it was.

const FREE_PRICE_LABEL = "free";

// Trailing zeros and repeated leading zeros both count: "0", "00", "0.0" and
// "0.00" are the same number. The literal word is accepted in any casing
// because it is what normalizeCoursePrice writes.
const FREE_PRICE_PATTERN = /^\s*(?:free|0+(?:\.0+)?)\s*$/i;

/**
 * Whether a course costs nothing.
 *
 * An absent price is free. That is what the server already charges —
 * `enrollCourseController` writes `amount: "free"` and asks for no card
 * details — and it is the half of the old checkout rule worth keeping. The
 * catalogue disagreed and called a blank price paid, which rendered a card
 * reading `ACCESS:` followed by nothing and opened a payment form for a course
 * nobody was going to be charged for.
 *
 * @param {unknown} price the raw `C_price` off a course document
 * @returns {boolean}
 */
function isFreePrice(price) {
  if (price === undefined || price === null) return true;

  const text = String(price).trim();

  if (!text) return true;

  return FREE_PRICE_PATTERN.test(text);
}

/**
 * The complement, for the call sites that read better that way.
 *
 * @param {unknown} price
 * @returns {boolean}
 */
function isPaidPrice(price) {
  return !isFreePrice(price);
}

/**
 * Accepts a course document rather than a price, matching how the client-side
 * mirror is called.
 *
 * @param {object|null|undefined} course
 * @returns {boolean}
 */
function isFreeCourse(course) {
  return isFreePrice(course?.C_price);
}

/**
 * @param {object|null|undefined} course
 * @returns {boolean}
 */
function isPaidCourse(course) {
  return !isFreeCourse(course);
}

const MAX_PRICE_LENGTH = 40;

// A course cannot cost more than this. Not a business rule so much as a bound:
// without one, "999999999999" is a valid price and the payments dashboard
// totals it.
const MAX_COURSE_PRICE = 1000000;

// A non-free price, once the currency noise is off it: digits, optionally a
// decimal point and one or two places. No sign — a negative price is not a
// discount, it is a course that pays the student — and no exponent, because
// "1e9" is a number JavaScript understands and not a price anybody typed.
const PRICE_PATTERN = /^\d+(?:\.\d{1,2})?$/;

// Thousands separators and a leading currency symbol are how people write
// prices, and refusing them would be pedantry. They are stripped before the
// pattern is applied and are not part of what gets stored.
const PRICE_NOISE_PATTERN = /[\s,\u20B9$\u20AC\u00A3]|(?:^rs\.?)/gi;

/**
 * Decides whether a submitted price is one the platform can charge.
 *
 * `normalizeCoursePrice` answers "what do we store"; it collapsed every free
 * form to one label and passed everything else through untouched, so "abc",
 * "-500" and "<script>" were all stored, advertised on the catalogue card,
 * classified paid, and written into the payments row's `amount` (#135). This
 * is the question that was never asked.
 *
 * A free price is valid and has no amount — that is the case
 * `normalizeCoursePrice` already handles and this does not second-guess.
 *
 * @param {unknown} value the submitted `C_price`
 * @param {object} [options]
 * @param {number} [options.max] the ceiling, in whole currency units
 * @returns {{valid: boolean, free: boolean, amount: number|null,
 *            normalized: string|null, reason: string|null}}
 */
function parseCoursePrice(value, { max = MAX_COURSE_PRICE } = {}) {
  if (isFreePrice(value)) {
    return {
      valid: true,
      free: true,
      amount: 0,
      normalized: FREE_PRICE_LABEL,
      reason: null,
    };
  }

  const raw = String(value).trim();

  if (raw.length > MAX_PRICE_LENGTH) {
    return {
      valid: false,
      free: false,
      amount: null,
      normalized: null,
      reason: `Price must be at most ${MAX_PRICE_LENGTH} characters`,
    };
  }

  const cleaned = raw.replace(PRICE_NOISE_PATTERN, "");

  if (!PRICE_PATTERN.test(cleaned)) {
    return {
      valid: false,
      free: false,
      amount: null,
      normalized: null,
      reason:
        "Price must be a number, for example 499 or 499.00. Enter 0 for a free course",
    };
  }

  const amount = Number(cleaned);

  // The pattern already excludes NaN and Infinity; this catches a value long
  // enough to lose precision before it reaches the database.
  if (!Number.isFinite(amount)) {
    return {
      valid: false,
      free: false,
      amount: null,
      normalized: null,
      reason: "Price is not a number this platform can charge",
    };
  }

  if (amount > max) {
    return {
      valid: false,
      free: false,
      amount: null,
      normalized: null,
      reason: `Price must be at most ${max}`,
    };
  }

  // `isFreePrice` has already claimed everything that reads as zero, so
  // reaching here with 0 means a form like "0.000" that the free pattern's
  // one-or-more-zeros branch did not match. It is still free.
  if (amount === 0) {
    return {
      valid: true,
      free: true,
      amount: 0,
      normalized: FREE_PRICE_LABEL,
      reason: null,
    };
  }

  return {
    valid: true,
    free: false,
    amount,
    // Stored without the separators and the symbol it may have arrived with,
    // so two teachers typing "Rs. 1,299" and "1299" produce the same string
    // and the catalogue's price column can be compared.
    normalized: cleaned,
    reason: null,
  };
}

/**
 * The value to persist for a submitted price.
 *
 * Every free form collapses to one label, so the stored data stops
 * accumulating new variants even though the rule above can still read the old
 * ones. Moved here from utils/courseInput so the write rule and the read rule
 * are the same rule rather than two that have to be kept in step.
 *
 * @param {unknown} value
 * @param {object} [options]
 * @param {number} [options.maxLength]
 * @returns {string}
 */
function normalizeCoursePrice(value, { maxLength = MAX_PRICE_LENGTH } = {}) {
  if (isFreePrice(value)) return FREE_PRICE_LABEL;

  return String(value).trim().slice(0, maxLength);
}

/**
 * How a price is shown.
 *
 * A free course reads "Free" rather than "free" or an empty cell.
 *
 * @param {unknown} price
 * @returns {string}
 */
function formatPriceLabel(price) {
  if (isFreePrice(price)) return "Free";

  return String(price).trim();
}

/**
 * The `C_price` clause matching free courses, for a Mongo find filter.
 *
 * A blank or absent price is free, and a regex cannot match a field that does
 * not exist, so the `$or` carries the two non-regex cases explicitly.
 *
 * @returns {object} a clause for `{ $or: [...] }`
 */
function freePriceFilterClauses() {
  return [
    { C_price: { $exists: false } },
    { C_price: null },
    { C_price: { $regex: /^\s*$/ } },
    { C_price: { $regex: FREE_PRICE_PATTERN } },
  ];
}

/**
 * The `$and` clauses matching paid courses.
 *
 * The negation of the above: the field exists, is not null, is not blank, and
 * does not read as zero.
 *
 * @returns {object[]} clauses for `{ $and: [...] }`
 */
function paidPriceFilterClauses() {
  return [
    { C_price: { $exists: true, $ne: null } },
    { C_price: { $not: /^\s*$/ } },
    { C_price: { $not: FREE_PRICE_PATTERN } },
  ];
}

/**
 * The same rule as an aggregation expression, for the pipelines that compute
 * an `accessType` rather than filtering on one.
 *
 * `$regexMatch` takes a string pattern, not a RegExp, so the source is handed
 * over with an "i" option rather than the literal above.
 *
 * @param {string} [priceField] the field path holding the price
 * @returns {object} a `$cond` yielding "free" or "paid"
 */
function accessTypeExpression(priceField = "$course.C_price") {
  return {
    $cond: [
      {
        $regexMatch: {
          // A missing price is an empty string here, which the pattern's
          // blank branch matches, so absent and blank land on "free" the same
          // way isFreePrice puts them there.
          input: { $ifNull: [priceField, ""] },
          regex: "^\\s*(?:free|0+(?:\\.0+)?)?\\s*$",
          options: "i",
        },
      },
      "free",
      "paid",
    ],
  };
}

module.exports = {
  FREE_PRICE_LABEL,
  FREE_PRICE_PATTERN,
  MAX_COURSE_PRICE,
  MAX_PRICE_LENGTH,
  PRICE_PATTERN,
  parseCoursePrice,
  accessTypeExpression,
  formatPriceLabel,
  freePriceFilterClauses,
  isFreeCourse,
  isFreePrice,
  isPaidCourse,
  isPaidPrice,
  normalizeCoursePrice,
  paidPriceFilterClauses,
};
