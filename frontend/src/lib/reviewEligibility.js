// Whether this account can review this course, and what to say when it cannot.
//
// `CourseReviews` had two states — signed out, or `canReview` — and rendered
// one sentence for everything that was not the second:
//
//   Enroll in this course before submitting a verified review.
//
// An educator looking at their own course got that sentence, and it was advice
// that leads nowhere: they can enrol, they may already have enrolled, and the
// review would still be refused. Before #117 it was worse than useless — the
// review was accepted, badged "✓ Verified enrollment", and averaged into the
// rating the catalogue badge renders.
//
// `GET /api/reviews/:courseId/mine` returns a `reason` now, so the difference
// can be said out loud.

export const REVIEW_DENIAL = Object.freeze({
  NOT_ENROLLED: 'not-enrolled',
  OWN_COURSE: 'own-course',
});

const MESSAGES = Object.freeze({
  'signed-out': 'Sign in with an enrolled student account to leave a review.',
  [REVIEW_DENIAL.NOT_ENROLLED]:
    'Enroll in this course before submitting a verified review.',
  [REVIEW_DENIAL.OWN_COURSE]:
    'You created this course, so you cannot review it. Reviews come from the students who took it.',
});

/**
 * The sentence to show in place of the review form.
 *
 * @param {object} options
 * @param {boolean} options.isAuthenticated
 * @param {string|null|undefined} options.reason a `REVIEW_DENIAL` value
 * @returns {string} empty when the form should be shown instead
 */
export function reviewDenialMessage({ isAuthenticated, reason } = {}) {
  if (!isAuthenticated) return MESSAGES['signed-out'];
  if (!reason) return '';

  // An unrecognised reason from a newer server still has to say something,
  // and the enrolment prompt is the safe default: it is the common case and
  // it is never actively wrong for a signed-in non-author.
  return MESSAGES[reason] || MESSAGES[REVIEW_DENIAL.NOT_ENROLLED];
}

/**
 * Whether the review form should render at all.
 *
 * Kept separate from the message so a failed `/mine` request — which leaves
 * `canReview` false with no reason — still hides the form rather than showing
 * one that will be refused.
 *
 * @param {object} options
 * @param {boolean} options.isAuthenticated
 * @param {boolean} options.canReview
 * @returns {boolean}
 */
export function canShowReviewForm({ isAuthenticated, canReview } = {}) {
  return Boolean(isAuthenticated && canReview);
}

/**
 * Reads the eligibility block off a `/mine` response.
 *
 * An older server sends `canReview` and nothing else, so `reason` is derived
 * from it rather than assumed present.
 *
 * @param {object} payload the response body
 * @returns {{ canReview: boolean, reason: string|null, isAuthor: boolean }}
 */
export function readEligibility(payload) {
  const canReview = Boolean(payload?.canReview);
  const reason =
    typeof payload?.reason === 'string' && payload.reason
      ? payload.reason
      : canReview
        ? null
        : REVIEW_DENIAL.NOT_ENROLLED;

  return {
    canReview,
    reason,
    isAuthor: Boolean(payload?.isAuthor) || reason === REVIEW_DENIAL.OWN_COURSE,
  };
}
