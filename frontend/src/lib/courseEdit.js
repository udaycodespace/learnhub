// The edit-a-course form.
//
// #127. There was no form, because there was no endpoint. A course could be
// created and deleted and nothing else, so an educator correcting a typo in a
// title had to delete the course — and `deleteCourseController` removes every
// section video from disk and then every enrolment, payment, review and
// bookmark that pointed at it. One character cost every student's progress and
// the whole upload.
//
// The rules mirror `backend/utils/courseEdit.js`. Nothing can import across the
// wire, so the same table is asserted on both sides, the pattern #114
// established. The server stays authoritative.

export const MAX_TITLE_LENGTH = 120;
export const MAX_CATEGORY_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 5000;
export const MAX_PRICE_LENGTH = 60;
export const MAX_SECTION_TITLE_LENGTH = 150;
export const MAX_SECTION_DESCRIPTION_LENGTH = 2000;

const asTrimmedString = (value) =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value);

/**
 * The form state for a course returned by `GET /api/user/editcourse/:id`.
 *
 * @param {object|null|undefined} course
 * @returns {object}
 */
export function toEditForm(course) {
  const source = course && typeof course === 'object' ? course : {};
  const sections = Array.isArray(source.sections) ? source.sections : [];

  return {
    C_title: source.C_title || '',
    C_categories: source.C_categories || '',
    C_price: source.C_price || '',
    C_description: source.C_description || '',
    sections: sections.map((section) => ({
      S_title: section?.S_title || '',
      S_description: section?.S_description || '',
      hasVideo: Boolean(section?.hasVideo),
    })),
  };
}

/**
 * @param {object} [form]
 * @returns {{ valid: boolean, errors: object }}
 */
export function validateEditForm(form = {}) {
  const errors = {};

  const title = asTrimmedString(form.C_title);
  if (!title) {
    errors.C_title = 'Course title is required';
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.C_title = `Course title must be at most ${MAX_TITLE_LENGTH} characters`;
  }

  const category = asTrimmedString(form.C_categories);
  if (!category) {
    errors.C_categories = 'Course category is required';
  } else if (category.length > MAX_CATEGORY_LENGTH) {
    errors.C_categories = `Course category must be at most ${MAX_CATEGORY_LENGTH} characters`;
  }

  const description = asTrimmedString(form.C_description);
  if (!description) {
    errors.C_description = 'Course description is required';
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.C_description = `Course description must be at most ${MAX_DESCRIPTION_LENGTH} characters`;
  }

  // The one optional field: a blank price means free, which is the rule #114
  // settled, so an empty string is a value rather than a mistake.
  const price = asTrimmedString(form.C_price);
  if (price.length > MAX_PRICE_LENGTH) {
    errors.C_price = `Course price must be at most ${MAX_PRICE_LENGTH} characters`;
  }

  const sections = Array.isArray(form.sections) ? form.sections : [];

  sections.forEach((section, index) => {
    const sectionTitle = asTrimmedString(section?.S_title);

    if (!sectionTitle) {
      errors[`sections.${index}.S_title`] = `Section ${index + 1} needs a title`;
    } else if (sectionTitle.length > MAX_SECTION_TITLE_LENGTH) {
      errors[`sections.${index}.S_title`] =
        `Section ${index + 1} title must be at most ${MAX_SECTION_TITLE_LENGTH} characters`;
    }

    const sectionDescription = asTrimmedString(section?.S_description);

    if (sectionDescription.length > MAX_SECTION_DESCRIPTION_LENGTH) {
      errors[`sections.${index}.S_description`] =
        `Section ${index + 1} description must be at most ${MAX_SECTION_DESCRIPTION_LENGTH} characters`;
    }
  });

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * The body to send.
 *
 * Only the editable fields, and for sections only the two text fields. The
 * server ignores anything else, but sending a course's stored file paths back
 * to it would be a strange thing to do even when it is harmless.
 *
 * @param {object} [form]
 * @returns {object}
 */
export function toUpdatePayload(form = {}) {
  return {
    C_title: asTrimmedString(form.C_title),
    C_categories: asTrimmedString(form.C_categories),
    C_price: asTrimmedString(form.C_price),
    C_description: asTrimmedString(form.C_description),
    sections: (Array.isArray(form.sections) ? form.sections : []).map(
      (section) => ({
        S_title: asTrimmedString(section?.S_title),
        S_description: asTrimmedString(section?.S_description),
      }),
    ),
  };
}

/**
 * Whether anything on the form differs from what was loaded.
 *
 * Used to keep Save disabled on an untouched form, so the "No editable fields
 * were supplied" answer is never something a user has to read.
 *
 * @param {object} form
 * @param {object} original
 * @returns {boolean}
 */
export function hasChanges(form, original) {
  return (
    JSON.stringify(toUpdatePayload(form)) !==
    JSON.stringify(toUpdatePayload(original))
  );
}

/**
 * The sentence and the per-field markers for a rejected update.
 *
 * @param {object} error an axios error
 * @returns {{ message: string, errors: object }}
 */
export function readEditError(error) {
  const data = error?.response?.data;

  const message =
    typeof data?.message === 'string' && data.message.trim()
      ? data.message
      : error?.response
        ? 'The course could not be updated.'
        : 'The server could not be reached.';

  const errors =
    data?.errors && typeof data.errors === 'object' && !Array.isArray(data.errors)
      ? data.errors
      : {};

  return { message, errors };
}
