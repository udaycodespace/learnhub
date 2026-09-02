// Shapes the course player reads out of GET /api/user/coursecontent/:courseid.
//
// The player used to decide completion for itself:
//
//   completedModule.length === courseContent.length
//
// `completedModule` is the enrolment's `progress` array verbatim, and it can
// hold the same sectionId twice (rows written before #39 had no uniqueness
// guard) and ids for sections the course no longer has. So that comparison was
// wrong in both directions — it could withhold a certificate from a finished
// course and hand one out for an unfinished one.
//
// The server computes the summary now, from the same helpers My Courses uses.
// This module normalises the response and answers the questions the component
// asks of it; it does not recompute anything the server sent.

export const PROGRESS_STATES = {
  NOT_STARTED: 'not-started',
  IN_PROGRESS: 'in-progress',
  COMPLETE: 'complete',
};

const EMPTY_PROGRESS = { completed: 0, total: 0, percent: 0 };

function toPositiveInteger(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.floor(parsed);
}

/**
 * @param {unknown} payload the parsed response body
 * @returns {{ completed: number, total: number, percent: number }}
 */
export function readProgress(payload) {
  const progress = payload && typeof payload === 'object' ? payload.progress : null;

  if (!progress || typeof progress !== 'object') return { ...EMPTY_PROGRESS };

  const total = toPositiveInteger(progress.total);
  const completed = Math.min(toPositiveInteger(progress.completed), total);
  const percent =
    total === 0 ? 0 : Math.min(100, toPositiveInteger(progress.percent));

  return { completed, total, percent };
}

/**
 * @param {{completed: number, total: number}} progress
 * @returns {string} one of PROGRESS_STATES
 */
export function progressState(progress) {
  if (!progress || progress.total === 0) return PROGRESS_STATES.NOT_STARTED;
  if (progress.completed >= progress.total) return PROGRESS_STATES.COMPLETE;
  if (progress.completed > 0) return PROGRESS_STATES.IN_PROGRESS;

  return PROGRESS_STATES.NOT_STARTED;
}

/**
 * @param {{completed: number, total: number}} progress
 * @returns {string}
 */
export function describeProgress(progress) {
  if (!progress || progress.total === 0) return 'No sections yet';

  return `${progress.completed} of ${progress.total} sections complete`;
}

/**
 * Normalises one section of the response.
 *
 * `hasVideo` and `completed` are both sent by the server. The component reads
 * them separately and must never derive the second from the first — a section
 * with no video is still a section, and that is the whole of #93.
 */
export function readSection(section, index) {
  const source = section && typeof section === 'object' ? section : {};
  const content = source.S_content || null;

  const streamUrl = readStreamUrl(content);

  return {
    index: Number.isInteger(source.index) ? source.index : index,
    sectionId: source.sectionId || null,
    title: source.S_title || `Section ${index + 1}`,
    description: source.S_description || '',
    hasVideo: Boolean(source.hasVideo ?? streamUrl),
    streamUrl,
    completed: Boolean(source.completed),
  };
}

/**
 * @param {unknown} payload the parsed response body
 * @returns {Array<object>}
 */
export function readSections(payload) {
  const sections =
    payload && typeof payload === 'object' ? payload.courseContent : null;

  if (!Array.isArray(sections)) return [];

  return sections.map(readSection);
}

/**
 * The guarded stream URL the server minted for a section.
 *
 * The player used to build `${host}/uploads/${path}` out of the file's storage
 * path, which is why every section video was reachable by anyone who could
 * guess a filename. /uploads is no longer served: `withPlaybackUrls` replaces
 * `S_content` with a single `streamUrl` pointing at the guarded video route,
 * and that URL is only useful alongside the playback token (#76).
 *
 * @param {unknown} content `S_content`
 * @returns {string} the stream URL, or '' when the section has no video
 */
export function readStreamUrl(content) {
  if (!content || typeof content !== 'object') return '';

  const raw = content.streamUrl;

  return typeof raw === 'string' && raw ? raw : '';
}

/**
 * The address `POST /api/user/completemodule` expects for a section.
 *
 * `progressController.normalizeSectionId` accepts either the index or the
 * section's `_id`, and prefers the `_id` when the section has one because an
 * index moves if a section is inserted ahead of it.
 *
 * @param {{index: number, sectionId: string|null}} section
 * @returns {string|number}
 */
export function sectionAddress(section) {
  if (!section) return 0;

  return section.sectionId || section.index;
}

/**
 * True when the server says this enrolment is finished.
 *
 * Reads `isComplete` when the server sent it and falls back to comparing the
 * summary, so an older response body does not silently read as complete.
 *
 * @param {unknown} payload
 * @returns {boolean}
 */
export function readIsComplete(payload) {
  if (payload && typeof payload === 'object' && 'isComplete' in payload) {
    return Boolean(payload.isComplete);
  }

  const progress = readProgress(payload);

  return progress.total > 0 && progress.completed >= progress.total;
}

/**
 * The short-lived token `/api/user/coursecontent/:courseid` mints once it has
 * confirmed this viewer is enrolled. Scoped to the one course, and the only
 * thing that opens the video route, so a section's `streamUrl` is inert
 * without it (#76).
 *
 * @param {unknown} payload
 * @returns {string}
 */
export function readPlaybackToken(payload) {
  const raw =
    payload && typeof payload === 'object' ? payload.playbackToken : null;

  return typeof raw === 'string' && raw ? raw : '';
}

/**
 * @param {unknown} payload
 * @returns {Date|null}
 */
export function readCertificateDate(payload) {
  const raw =
    payload && typeof payload === 'object' ? payload.certificateDate : null;

  if (!raw) return null;

  const parsed = new Date(raw);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * @param {Date|null} date
 * @returns {string}
 */
export function formatCertificateDate(date) {
  if (!date) return '';

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
