// Editing a course that already exists.
//
// #127. A course could be created and deleted. It could not be changed.
//
//   $ grep -rn "router.put\|router.patch" backend/routers
//   backend/routers/courseReviewRoutes.js:25:router.put("/review/:reviewId", ...)
//
// One PUT in the project, and it belonged to a review. So correcting a typo in
// a title, or a price entered as 499 when it should have been 4990, meant
// deleting the course and building it again — and `deleteCourseController` is
// deliberately destructive (#74). It removes every section video from disk and
// then `removeCourseDependents` removes every enrolment, payment, review and
// bookmark that pointed at the course. Fixing one character cost every
// student's progress, the whole upload, and for a paid course every payment.
//
// None of the fields below touches a file on disk, and none of them
// invalidates an enrolment, so none of them needs any of that.

const {
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  asTrimmedString,
} = require("./courseInput");
const { normalizeCoursePrice } = require("./coursePricing");

const MAX_SECTION_TITLE_LENGTH = 150;
const MAX_SECTION_DESCRIPTION_LENGTH = 2000;

// An allow-list, and the reason is #55: `{ ...req.body }` is how a client came
// to be able to hand itself the admin role. Everything absent from this list is
// ignored rather than rejected, so a client that posts a whole course document
// back — which is exactly what an edit form pre-filled from a GET will do —
// still works, and still cannot write `userId`, `enrolled` or a section's
// stored file path.
const EDITABLE_FIELDS = Object.freeze([
  "C_title",
  "C_categories",
  "C_description",
  "C_price",
]);

const FIELD_RULES = Object.freeze({
  C_title: { label: "Course title", max: MAX_TITLE_LENGTH, required: true },
  C_categories: {
    label: "Course category",
    max: MAX_CATEGORY_LENGTH,
    required: true,
  },
  C_description: {
    label: "Course description",
    max: MAX_DESCRIPTION_LENGTH,
    required: true,
  },
  // The only optional one. A blank price means free, which is the rule #114
  // settled, so an empty string here is a value rather than a mistake.
  C_price: { label: "Course price", max: 60, required: false },
});

const has = (body, field) =>
  Object.prototype.hasOwnProperty.call(body, field) &&
  body[field] !== undefined;

/**
 * Validates one metadata field, writing into `errors` and `changes`.
 */
function applyField(field, body, errors, changes) {
  if (!has(body, field)) return;

  const rule = FIELD_RULES[field];
  const text = asTrimmedString(body[field]);

  if (rule.required && !text) {
    errors[field] = `${rule.label} is required`;
    return;
  }

  if (text.length > rule.max) {
    errors[field] = `${rule.label} must be at most ${rule.max} characters`;
    return;
  }

  changes[field] =
    field === "C_price" ? normalizeCoursePrice(text) : text;
}

/**
 * Rewrites the text on a course's sections, leaving everything else on them
 * alone.
 *
 * `S_content` is never read from the body. It holds the stored filename and
 * path of an uploaded video, and this route does not accept uploads; taking it
 * from a request would let a client repoint a section at any file in the
 * uploads directory — the class of thing #76 closed by refusing to serve that
 * directory at all.
 *
 * @param {Array} current the course's existing sections
 * @param {unknown} submitted
 * @param {object} errors
 * @returns {Array|null} the rewritten sections, or null when nothing changes
 */
function applySections(current, submitted, errors) {
  if (submitted === undefined) return null;

  if (!Array.isArray(submitted)) {
    errors.sections = "Sections must be a list";
    return null;
  }

  const existing = Array.isArray(current) ? current : [];

  // The count is fixed by the uploads, which this route cannot change. A
  // shorter or longer list is a client that thinks it can add or remove a
  // section here, and silently ignoring the extra entries would be worse than
  // saying so.
  if (submitted.length !== existing.length) {
    errors.sections = `This course has ${existing.length} section${
      existing.length === 1 ? "" : "s"
    }. Adding or removing one is not possible here.`;
    return null;
  }

  const rewritten = existing.map((section, index) => {
    const source = submitted[index];

    // A section that is not an object is left exactly as it is. `sections` is
    // declared as `{}` on the schema, so the collection holds whatever was
    // written to it, and rewriting an unreadable row is not this route's job.
    if (!section || typeof section !== "object") return section;

    const base = { ...section };

    if (!source || typeof source !== "object") return base;

    if (has(source, "S_title")) {
      const title = asTrimmedString(source.S_title);

      if (!title) {
        errors[`sections.${index}.S_title`] = `Section ${
          index + 1
        } needs a title`;
      } else if (title.length > MAX_SECTION_TITLE_LENGTH) {
        errors[`sections.${index}.S_title`] = `Section ${
          index + 1
        } title must be at most ${MAX_SECTION_TITLE_LENGTH} characters`;
      } else {
        base.S_title = title;
      }
    }

    if (has(source, "S_description")) {
      const description = asTrimmedString(source.S_description);

      if (description.length > MAX_SECTION_DESCRIPTION_LENGTH) {
        errors[`sections.${index}.S_description`] = `Section ${
          index + 1
        } description must be at most ${MAX_SECTION_DESCRIPTION_LENGTH} characters`;
      } else {
        base.S_description = description;
      }
    }

    return base;
  });

  return rewritten;
}

/**
 * Works out what an edit changes.
 *
 * Only the fields present in the body are touched, so a client may send one
 * field or all of them. Everything outside the allow-list is ignored.
 *
 * @param {object} options
 * @param {object} options.body
 * @param {object} options.course the course as stored
 * @returns {{ valid: boolean, errors: object, changes?: object }}
 */
function validateCourseEdit({ body = {}, course = {} } = {}) {
  const errors = {};
  const changes = {};

  for (const field of EDITABLE_FIELDS) {
    applyField(field, body, errors, changes);
  }

  const sections = applySections(course.sections, body.sections, errors);

  if (sections) {
    changes.sections = sections;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  if (Object.keys(changes).length === 0) {
    return {
      valid: false,
      errors: { body: "No editable fields were supplied" },
      empty: true,
    };
  }

  return { valid: true, errors: {}, changes };
}

/**
 * The course as an edit form needs it.
 *
 * Section text is included and `S_content` is not: #94 deliberately kept the
 * stored file paths out of the educator's list response, and there is no
 * reason for an edit form to see them either. The count is what the form needs
 * in order to render the right number of rows.
 *
 * @param {object} course a lean course document
 * @returns {object}
 */
function toEditableCourse(course = {}) {
  const sections = Array.isArray(course.sections) ? course.sections : [];

  return {
    _id: course._id,
    C_title: course.C_title || "",
    C_categories: course.C_categories || "",
    C_description: course.C_description || "",
    C_price: course.C_price || "",
    C_educator: course.C_educator || "",
    sections: sections.map((section, index) => ({
      index,
      S_title: section?.S_title || "",
      S_description: section?.S_description || "",
      // Whether there is a video at all, without saying where it is.
      hasVideo: Boolean(section?.S_content),
    })),
  };
}

module.exports = {
  EDITABLE_FIELDS,
  MAX_SECTION_DESCRIPTION_LENGTH,
  MAX_SECTION_TITLE_LENGTH,
  applySections,
  toEditableCourse,
  validateCourseEdit,
};
