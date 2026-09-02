// The category a course is filed under.
//
// The Add Course dropdown offered its own placeholder as a selectable option
// with no `value`, so the value was the label:
//
//   <Form.Select value={addCourse.C_categories} onChange={handleCourseTypeChange}>
//      <option>Select categories</option>
//      <option>IT &amp; Software</option>
//
// and `validateCourseSubmission` only required `C_categories` to be a non-empty
// string, which "Select categories" satisfies. A teacher who filled in
// everything else and never opened the dropdown published a course filed under
// the literal category "Select categories", and `buildCourseFilter` would then
// happily filter the catalogue to it (#135).
//
// What this does NOT do is restrict the category to the three the dropdown
// offers. `C_categories` is free-form throughout the codebase — the fixtures
// alone use "Web", "Programming", "Engineering", "Backend Development" — and
// an allow-list would reject courses that are correctly categorised today. The
// defect is that a placeholder is accepted as a real answer, so that is what is
// refused here. Narrowing the vocabulary is a data-migration question and a
// separate piece of work.

// What the dropdown offers. Exported so the form's option elements and this
// module are one list rather than two.
const COURSE_CATEGORIES = Object.freeze([
  "IT & Software",
  "Finance & Accounting",
  "Personal Development",
]);

// The placeholder labels that have shipped in the dropdown. Matched
// case-insensitively, and "Select a category" is included because that is what
// the option reads now — a course created against the old build and edited
// against the new one must not be able to keep the old placeholder either.
const CATEGORY_PLACEHOLDERS = Object.freeze([
  "select categories",
  "select a category",
  "select category",
]);

/**
 * Collapses the whitespace in a submitted category.
 *
 * The catalogue's category filter is an exact (case-insensitive) match, so
 * "IT  &  Software" stored with a double space is a course nobody can filter
 * to. Trimming is not a validation decision, it is the same normalisation the
 * other text fields already get.
 *
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCourseCategory(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Whether a submitted category is the dropdown's placeholder rather than a
 * category.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isCategoryPlaceholder(value) {
  return CATEGORY_PLACEHOLDERS.includes(
    normalizeCourseCategory(value).toLowerCase(),
  );
}

/**
 * The message shown when the placeholder was submitted.
 *
 * @returns {string}
 */
function categoryErrorMessage() {
  return "Choose a course category";
}

module.exports = {
  CATEGORY_PLACEHOLDERS,
  COURSE_CATEGORIES,
  categoryErrorMessage,
  isCategoryPlaceholder,
  normalizeCourseCategory,
};
