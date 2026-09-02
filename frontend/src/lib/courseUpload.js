// What the Add Course form is allowed to send.
//
// The form and the API disagreed about what a section video is (#106). The file
// picker said:
//
//   <Form.Label>Section Content (Video or Image)</Form.Label>
//   <Form.Control name="S_content" type="file" accept="video/*,image/*" required />
//
// and the API said, in backend/utils/videoUpload.js:
//
//   const extension = path.extname(String(file.originalname || "")).toLowerCase();
//   const mimeType = String(file.mimetype || "").toLowerCase();
//   return extension === ".mp4" && ALLOWED_MP4_MIME_TYPES.has(mimeType);
//
// .mp4 with a video/mp4 or application/mp4 type, and nothing else — the rule #44
// deliberately tightened. A .mov, a .webm or a .png was accepted by the form,
// uploaded in full, and rejected by Multer's fileFilter at the end.
//
// Size and count were the same shape. The server enforces MAX_VIDEO_SIZE_MB and
// MAX_SECTION_VIDEOS and maps each to a specific 413 or 400; the form checked
// neither before sending, so a teacher with eight 300 MB lectures uploaded
// 2.4 GB to be told at the end that one file was too big — without being told
// which one. And because handleSubmit builds one FormData for the whole course,
// a single bad file discarded the entire submission, file inputs included,
// which cannot be repopulated programmatically.
//
// These constants mirror the server's; they do not replace them. The check in
// backend/utils/videoUpload.js stays exactly where it is and stays
// authoritative. Duplicating a constant so the browser can refuse a file before
// spending four minutes uploading it is not the same as duplicating a security
// boundary.

import { parseCoursePrice } from './coursePricing.js';
import {
  categoryErrorMessage,
  isUsableCourseCategory,
} from './courseCategories.js';

export const ALLOWED_VIDEO_EXTENSION = '.mp4';

// ALLOWED_MP4_MIME_TYPES in backend/utils/videoUpload.js.
export const ALLOWED_VIDEO_MIME_TYPES = Object.freeze([
  'video/mp4',
  'application/mp4',
]);

// What the file picker should offer. Naming the extension as well as the type
// matters: some platforms report an empty type for a file the user picked by
// extension, and the picker filters on whichever it understands.
export const VIDEO_ACCEPT_ATTRIBUTE = '.mp4,video/mp4';

// DEFAULT_MAX_VIDEO_SIZE_MB and DEFAULT_MAX_SECTION_VIDEOS, same file. A
// deployment can lower these through MAX_VIDEO_SIZE_MB / MAX_SECTION_VIDEOS, in
// which case the server rejects what this lets through — which is the right way
// round for a client-side check.
export const DEFAULT_MAX_VIDEO_SIZE_MB = 250;
export const DEFAULT_MAX_SECTION_VIDEOS = 20;

const BYTES_PER_MB = 1024 * 1024;

/**
 * The limits to validate against, with the server's defaults filled in.
 *
 * @param {object} [overrides]
 * @returns {{ maxVideoSizeMb: number, maxSectionVideos: number, maxVideoBytes: number }}
 */
export function uploadLimits(overrides = {}) {
  const maxVideoSizeMb =
    Number.isFinite(overrides.maxVideoSizeMb) && overrides.maxVideoSizeMb > 0
      ? Math.floor(overrides.maxVideoSizeMb)
      : DEFAULT_MAX_VIDEO_SIZE_MB;

  const maxSectionVideos =
    Number.isFinite(overrides.maxSectionVideos) &&
    overrides.maxSectionVideos > 0
      ? Math.floor(overrides.maxSectionVideos)
      : DEFAULT_MAX_SECTION_VIDEOS;

  return {
    maxVideoSizeMb,
    maxSectionVideos,
    maxVideoBytes: maxVideoSizeMb * BYTES_PER_MB,
  };
}

/**
 * A size a person can read.
 *
 * "Video exceeds the 250 MB upload limit" is only useful next to how big the
 * file actually is.
 *
 * @param {unknown} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value < 0) return 'unknown size';
  if (value < 1024) return `${Math.round(value)} B`;

  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;

  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;

  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * The lowercase extension of a filename, including the dot.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function fileExtension(name) {
  const text = String(name ?? '');
  const dot = text.lastIndexOf('.');

  if (dot <= 0 || dot === text.length - 1) return '';

  return text.slice(dot).toLowerCase();
}

/**
 * Whether the browser reported a type the API accepts.
 *
 * An empty type is *not* a pass. A browser leaves it blank for an extension it
 * does not recognise, and the API rejects a blank mimetype outright, so
 * treating blank as unknown keeps the two answers the same.
 *
 * @param {unknown} type
 * @returns {boolean}
 */
export function isAllowedVideoType(type) {
  const normalized = String(type ?? '').trim().toLowerCase();

  return ALLOWED_VIDEO_MIME_TYPES.includes(normalized);
}

/**
 * Whether a file looks like something the API will take.
 *
 * Extension **and** type, which is the same pair `isAllowedMp4File` checks.
 *
 * @param {{ name?: string, type?: string }} file
 * @returns {boolean}
 */
export function isAllowedVideoFile(file) {
  if (!file || typeof file !== 'object') return false;

  return (
    fileExtension(file.name) === ALLOWED_VIDEO_EXTENSION &&
    isAllowedVideoType(file.type)
  );
}

/**
 * Why this file cannot be uploaded, or null when it can.
 *
 * The message names the file, because a course with twelve sections gave the
 * teacher nothing to go on: the old error said only that *some* file was wrong.
 *
 * @param {{ name?: string, type?: string, size?: number }} file
 * @param {object} [limits]
 * @returns {string|null}
 */
export function describeFileProblem(file, limits = uploadLimits()) {
  if (!file || typeof file !== 'object') {
    return 'Choose an .mp4 video for this section.';
  }

  const name = String(file.name || 'This file');

  if (!isAllowedVideoFile(file)) {
    return `“${name}” is not an .mp4 video. Sections accept .mp4 files only.`;
  }

  const size = Number(file.size);

  if (Number.isFinite(size) && size > limits.maxVideoBytes) {
    return `“${name}” is ${formatFileSize(size)}, over the ${limits.maxVideoSizeMb} MB limit for a section video.`;
  }

  if (Number.isFinite(size) && size === 0) {
    return `“${name}” is empty.`;
  }

  return null;
}

/**
 * Validates one section.
 *
 * @param {object} section
 * @param {object} [limits]
 * @returns {object} field name → message, empty when the section is fine
 */
export function validateSection(section = {}, limits = uploadLimits()) {
  const errors = {};

  if (!String(section.S_title || '').trim()) {
    errors.S_title = 'Give this section a title.';
  }

  if (!String(section.S_description || '').trim()) {
    errors.S_description = 'Give this section a description.';
  }

  const problem = describeFileProblem(section.S_content, limits);

  if (problem) {
    errors.S_content = problem;
  }

  return errors;
}

/**
 * Validates the whole submission before a single byte is uploaded.
 *
 * Returns per-section errors as well as a form-level message, so the teacher is
 * told *which* section is wrong rather than that something, somewhere, is.
 *
 * @param {object} course
 * @param {object} [limits]
 * @returns {{ valid: boolean, formError: string, sectionErrors: object }}
 */
/**
 * The course-level fields the form can check without the server.
 *
 * Price and category were checked by neither side (#135): the API required
 * only that the category be a non-empty string — which the dropdown's own
 * placeholder is — and did not look at the price at all. The category is not
 * restricted to the three the dropdown offers; only the placeholder and blank
 * are refused.
 *
 * @param {object} course
 * @returns {object} field name → message, empty when they are both fine
 */
export function validateCourseDetails(course = {}) {
  const errors = {};

  if (!isUsableCourseCategory(course.C_categories)) {
    errors.C_categories = categoryErrorMessage();
  }

  const price = parseCoursePrice(course.C_price);

  if (!price.valid) {
    errors.C_price = price.reason;
  }

  return errors;
}

export function validateCourseUpload(course = {}, limits = uploadLimits()) {
  const sections = Array.isArray(course.sections) ? course.sections : [];
  const sectionErrors = {};

  // Before the section checks: a bad price is worth catching before several
  // hundred megabytes go up, which is the whole point of mirroring the rule.
  const detailErrors = validateCourseDetails(course);

  if (Object.keys(detailErrors).length > 0) {
    return {
      valid: false,
      formError: Object.values(detailErrors).join('. '),
      detailErrors,
      sectionErrors,
    };
  }

  if (sections.length === 0) {
    return {
      valid: false,
      formError: 'Add at least one section with an .mp4 video.',
      detailErrors: {},
      sectionErrors,
    };
  }

  if (sections.length > limits.maxSectionVideos) {
    return {
      valid: false,
      formError: `A course can have at most ${limits.maxSectionVideos} sections. Remove ${sections.length - limits.maxSectionVideos} before submitting.`,
      detailErrors: {},
      sectionErrors,
    };
  }

  sections.forEach((section, index) => {
    const errors = validateSection(section, limits);

    if (Object.keys(errors).length > 0) {
      sectionErrors[index] = errors;
    }
  });

  const failed = Object.keys(sectionErrors);

  if (failed.length === 0) {
    return { valid: true, formError: '', detailErrors: {}, sectionErrors };
  }

  const numbers = failed.map((index) => Number(index) + 1);

  return {
    valid: false,
    formError:
      numbers.length === 1
        ? `Section ${numbers[0]} needs attention before this course can be created.`
        : `Sections ${numbers.join(', ')} need attention before this course can be created.`,
    detailErrors: {},
    sectionErrors,
  };
}

/**
 * Builds the multipart body.
 *
 * The server pairs each uploaded file with the S_title and S_description at the
 * same position — position is the only thing tying them together — so the three
 * repeated fields are appended together, per section, in order.
 *
 * @param {object} course
 * @param {object} [options]
 * @param {Function} [options.FormDataImpl] injectable, so this is testable
 * @returns {FormData}
 */
export function buildCourseFormData(course = {}, { FormDataImpl } = {}) {
  const Impl = FormDataImpl || FormData;
  const formData = new Impl();

  for (const [key, value] of Object.entries(course)) {
    if (key === 'sections') continue;

    formData.append(key, value ?? '');
  }

  const sections = Array.isArray(course.sections) ? course.sections : [];

  for (const section of sections) {
    formData.append('S_content', section.S_content);
    formData.append('S_title', section.S_title ?? '');
    formData.append('S_description', section.S_description ?? '');
  }

  return formData;
}

/**
 * The line under the file input, so the rule is visible before a file is picked
 * rather than only after one is rejected.
 *
 * @param {object} [limits]
 * @returns {string}
 */
export function describeUploadRules(limits = uploadLimits()) {
  return `.mp4 video, up to ${limits.maxVideoSizeMb} MB. A course can have up to ${limits.maxSectionVideos} sections.`;
}
