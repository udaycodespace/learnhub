// The category a course is filed under, in the browser.
//
// The mirror of `backend/utils/courseCategories.js`. The dropdown offered its
// own placeholder as a selectable option with no `value`, so its value was its
// label and an untouched form submitted the literal string "Select categories"
// — which the API, requiring only a non-empty string, stored (#135).
//
// The category is deliberately not restricted to the three below. `C_categories`
// is free-form throughout the app, and an allow-list would reject courses that
// are correctly categorised today. The placeholder is what gets refused.

export const COURSE_CATEGORIES = Object.freeze([
  'IT & Software',
  'Finance & Accounting',
  'Personal Development',
]);

// Shown before a choice is made. Carries an empty value in the markup now, so
// it cannot be submitted at all — this list is the second line of defence, and
// covers a course created against the old build.
export const CATEGORY_PLACEHOLDER = 'Select a category';

export const CATEGORY_PLACEHOLDERS = Object.freeze([
  'select categories',
  'select a category',
  'select category',
]);

/**
 * Collapses the whitespace in a submitted category.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeCourseCategory(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Whether the value is a placeholder rather than a category.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCategoryPlaceholder(value) {
  return CATEGORY_PLACEHOLDERS.includes(
    normalizeCourseCategory(value).toLowerCase(),
  );
}

/**
 * Whether the value is something the form may submit.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUsableCourseCategory(value) {
  const text = normalizeCourseCategory(value);

  return Boolean(text) && !isCategoryPlaceholder(text);
}

/**
 * @returns {string}
 */
export function categoryErrorMessage() {
  return 'Choose a course category';
}
