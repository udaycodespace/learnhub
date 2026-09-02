// The pure half of the student "My courses" table.
//
// #65 rewrote GET /api/user/getallcoursesuser into a paginated endpoint that
// also returns a progress summary per enrolment:
//
//   { success, data: [ { ...course, enrolledAt, courseLength, certificateDate,
//                        progress: { completed, total, percent } } ],
//     pagination: { page, limit, totalItems, totalPages, ... } }
//
// EnrolledCourses.jsx called it bare and read two fields off each row, so the
// pagination block was dropped and a student with more than twelve enrolments
// could not reach the thirteenth — the same shape of bug as #75, one screen
// over — and the progress the server had already computed was never shown.
//
// No React in here, so it can be tested without a DOM.

export const PAGE_SIZE = 12;

export const PROGRESS_STATES = Object.freeze({
  NOT_STARTED: 'not-started',
  IN_PROGRESS: 'in-progress',
  COMPLETE: 'complete',
});

/**
 * @param {object} [state]
 * @param {number} [state.page]
 * @param {number} [state.limit]
 * @returns {{ page: number, limit: number }} params for axios
 */
export function buildEnrolledParams({ page = 1, limit = PAGE_SIZE } = {}) {
  return {
    page: Math.max(1, Math.floor(page) || 1),
    limit: Math.max(1, Math.floor(limit) || PAGE_SIZE),
  };
}

const toWholeNumber = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) return 0;

  return Math.floor(parsed);
};

/**
 * Normalises the progress block on one row.
 *
 * The server computes this and caps `completed` at `total`, but the client
 * cannot assume the block is there: a row cached from before #65, or a partial
 * response, has no `progress` at all. Falling back to `courseLength` keeps the
 * denominator meaningful in that case rather than rendering `0 of undefined`.
 *
 * @param {object} row one entry from `data`
 * @returns {{ completed: number, total: number, percent: number }}
 */
export function readProgress(row) {
  const block = row?.progress;
  const total = toWholeNumber(
    block?.total ?? row?.courseLength ?? row?.course_Length,
  );
  const completed = Math.min(toWholeNumber(block?.completed), total);

  // Recomputed rather than trusted: `percent` and the two counts have to agree
  // or the bar and the label under it contradict each other.
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return { completed, total, percent };
}

/**
 * @param {{ completed: number, total: number }} progress
 * @returns {string} one of PROGRESS_STATES
 */
export function progressState({ completed, total }) {
  if (total > 0 && completed >= total) return PROGRESS_STATES.COMPLETE;
  if (completed > 0) return PROGRESS_STATES.IN_PROGRESS;

  return PROGRESS_STATES.NOT_STARTED;
}

/**
 * "3 of 8 sections". A course with no sections yet says so rather than
 * claiming 0 of 0.
 *
 * @param {{ completed: number, total: number }} progress
 * @returns {string}
 */
export function describeProgress({ completed, total }) {
  if (total === 0) return 'No sections yet';

  return `${completed} of ${total} ${total === 1 ? 'section' : 'sections'}`;
}

/**
 * The link into the course player.
 *
 * The old table interpolated the title straight into the path, so a course
 * called "Node.js: HTTP/2 in practice" produced a URL with extra segments and
 * the route matched something else. Both segments are encoded now.
 *
 * @param {object} row
 * @returns {string}
 */
export function courseHref(row) {
  const id = encodeURIComponent(String(row?._id ?? ''));
  const title = encodeURIComponent(String(row?.C_title ?? 'Course'));

  return `/courseSection/${id}/${title}`;
}

/**
 * @param {unknown} value an ISO date from `enrolledAt`
 * @returns {string} a short local date, or '' when there isn't one
 */
export function formatEnrolledDate(value) {
  if (!value) return '';

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) return '';

  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * "Showing 13–20 of 20 enrolled courses".
 *
 * @param {object} pagination
 * @param {number} shown how many rows are rendered
 * @returns {string}
 */
export function describeEnrolledRange(pagination, shown) {
  const page = Math.max(1, Number(pagination?.page) || 1);
  const limit = Math.max(1, Number(pagination?.limit) || PAGE_SIZE);
  const totalItems = Math.max(0, Number(pagination?.totalItems) || 0);

  if (!totalItems) return 'No enrolled courses';

  const first = (page - 1) * limit + 1;
  const last = Math.min(first + Math.max(shown, 0) - 1, totalItems);
  const noun = totalItems === 1 ? 'enrolled course' : 'enrolled courses';

  if (first === last) {
    return `Showing ${first} of ${totalItems} ${noun}`;
  }

  return `Showing ${first}–${last} of ${totalItems} ${noun}`;
}

/**
 * What leaving a course actually costs, as a sentence.
 *
 * #128. There was no way to leave one at all: an enrolment row was only ever
 * created, and the only deletes are in the cascade for a deleted course or a
 * deleted account. So a free course joined by one click — `handleEnroll` skips
 * the payment modal entirely for a free course, so there is no confirmation
 * step — stayed on this table for the life of the account.
 *
 * The confirmation names what goes and what stays, because it is not
 * reversible and the two are not obvious. Progress lives on the enrolment row,
 * so it goes with it; the payment record is kept and marked, because a
 * financial record must not disappear because somebody changed their mind.
 *
 * @param {object} row a row from the enrolled-courses table
 * @returns {string[]} one sentence per consequence
 */
export function describeWithdrawal(row) {
  const { completed } = readProgress(row);

  const lines = [];

  if (completed > 0) {
    lines.push(
      `Your progress through ${completed} section${completed === 1 ? '' : 's'} will be lost.`,
    );
  }

  lines.push('Any review you left for this course will be removed.');
  lines.push(
    'Your payment record is kept and marked as withdrawn; this does not request a refund.',
  );
  lines.push('You can enrol again from the catalogue.');

  return lines;
}
