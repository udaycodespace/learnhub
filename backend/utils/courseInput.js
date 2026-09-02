// Validation and normalisation for POST /api/user/addcourse.
//
// The route is multipart, and Multer starts a multipart parse by replacing the
// request body outright:
//
//   req.body = Object.create(null)          // multer/lib/make-middleware.js
//
// authMiddleware runs before Multer and publishes the caller by writing
// `req.body.userId`, so on this one route that value does not survive. What
// reached the controller was whatever the browser had put in the form, which
// meant the client picked the owner of the course it was creating.
//
// Identity is resolved from `req.user` here instead. That object is set by the
// same middleware, is not part of the body, and is untouched by Multer.

const {
  FREE_PRICE_LABEL,
  normalizeCoursePrice,
  parseCoursePrice,
} = require("./coursePricing");
const {
  COURSE_CATEGORIES,
  categoryErrorMessage,
  isCategoryPlaceholder,
  normalizeCourseCategory,
} = require("./courseCategories");

const MAX_EDUCATOR_LENGTH = 100;
const MAX_TITLE_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_SECTION_TITLE_LENGTH = 150;
const MAX_SECTION_DESCRIPTION_LENGTH = 2000;

/**
 * A repeated multipart field arrives as an array. Everything that expects a
 * single value reads through here so `C_title=a&C_title=b` cannot turn a string
 * field into an array and reach Mongoose as one.
 */
function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function asTrimmedString(value) {
  const single = firstValue(value);

  if (single === undefined || single === null) return "";
  if (typeof single === "string") return single.trim();
  if (typeof single === "number" || typeof single === "boolean") {
    return String(single);
  }

  // An ObjectId, a Buffer, anything else with a useful toString.
  return String(single).trim();
}

/**
 * Reads the authenticated identity off `req.user`.
 *
 * The admin token carries the pseudo-identity `{ _id: "admin" }` and no name,
 * so `name` comes back empty for it; the caller falls back to the submitted
 * educator in that case. Every real account has one.
 *
 * @param {object} [user] req.user, as set by authMiddleware
 * @returns {{ userId: string, name: string }}
 */
function resolveAuthor(user = {}) {
  return {
    userId: asTrimmedString(user?._id ?? user?.id),
    name: asTrimmedString(user?.name),
  };
}

function requireText(errors, field, value, label, maxLength) {
  const text = asTrimmedString(value);

  if (!text) {
    errors[field] = `${label} is required`;
    return "";
  }

  if (text.length > maxLength) {
    errors[field] = `${label} must be at most ${maxLength} characters`;
    return text;
  }

  return text;
}

/**
 * Pairs an uploaded file with the section title and description at the same
 * index. Multer gives one array of files and one repeated field per column, so
 * position is the only thing tying them together.
 */
function normalizeSectionField(value, index) {
  return Array.isArray(value) ? value[index] : value;
}

function buildSections(files, body) {
  return files.map((file, index) => ({
    S_title: asTrimmedString(
      normalizeSectionField(body.S_title, index),
    ).slice(0, MAX_SECTION_TITLE_LENGTH),
    S_content: {
      filename: file.filename,
      path: `/uploads/${file.filename}`,
    },
    S_description: asTrimmedString(
      normalizeSectionField(body.S_description, index),
    ).slice(0, MAX_SECTION_DESCRIPTION_LENGTH),
  }));
}

/**
 * Validates a course submission and returns the document fields to persist.
 *
 * `userId` and `C_educator` are never read from the body for an account that
 * has a name: they come from the verified token. Anything the form said about
 * either is ignored rather than rejected, so an existing client that still
 * posts them keeps working.
 *
 * @param {object} options
 * @param {object} options.body req.body after the multipart parse
 * @param {Array} options.files req.files
 * @param {object} options.user req.user
 * @returns {{ valid: boolean, errors: object, value?: object }}
 */
function validateCourseSubmission({ body = {}, files = [], user = {} } = {}) {
  const errors = {};
  const author = resolveAuthor(user);

  if (!author.userId) {
    return {
      valid: false,
      errors: { userId: "Authenticated user is required" },
      unauthenticated: true,
    };
  }

  // A named account always wins. The admin pseudo-identity has no name, so it
  // is the one caller allowed to say who the educator is.
  const educator = author.name
    ? author.name.slice(0, MAX_EDUCATOR_LENGTH)
    : requireText(
        errors,
        "C_educator",
        body.C_educator,
        "Educator name",
        MAX_EDUCATOR_LENGTH,
      );

  const title = requireText(
    errors,
    "C_title",
    body.C_title,
    "Course title",
    MAX_TITLE_LENGTH,
  );
  // requireText still catches blank. What it could not catch is the dropdown's
  // own "Select categories" placeholder, which is a non-empty string and is
  // what an untouched form submits (#135).
  const categories = normalizeCourseCategory(
    requireText(
      errors,
      "C_categories",
      body.C_categories,
      "Course category",
      MAX_CATEGORY_LENGTH,
    ),
  );

  if (categories && isCategoryPlaceholder(categories)) {
    errors.C_categories = categoryErrorMessage();
  }
  const description = requireText(
    errors,
    "C_description",
    body.C_description,
    "Course description",
    MAX_DESCRIPTION_LENGTH,
  );

  // The price was the one field that went through the normaliser and no check
  // at all, so "abc" and "-500" were stored, advertised on the card, and
  // written into the payments row's amount (#135).
  const price = parseCoursePrice(asTrimmedString(body.C_price));

  if (!price.valid) {
    errors.C_price = price.reason;
  }

  const uploadedFiles = Array.isArray(files) ? files : [];

  // Without this a course saves with `sections: []`, and enrolling in it stores
  // `course_Length: 0`, which reads as 100% complete on the first render.
  if (uploadedFiles.length === 0) {
    errors.S_content = "At least one section video is required";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: {},
    value: {
      userId: author.userId,
      C_educator: educator,
      C_title: title,
      C_categories: categories,
      C_description: description,
      // parseCoursePrice has already validated this and produced the value to
      // store — the free label for a free course, the amount without its
      // separators or currency symbol for a paid one — so two teachers typing
      // "Rs. 1,299" and "1299" write the same string.
      C_price: price.normalized,
      sections: buildSections(uploadedFiles, body),
    },
  };
}

const formatCourseMessage = (errors = {}) => Object.values(errors).join(". ");

module.exports = {
  COURSE_CATEGORIES,
  FREE_PRICE_LABEL,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EDUCATOR_LENGTH,
  MAX_TITLE_LENGTH,
  asTrimmedString,
  buildSections,
  firstValue,
  formatCourseMessage,
  normalizeCoursePrice,
  normalizeSectionField,
  resolveAuthor,
  validateCourseSubmission,
};
