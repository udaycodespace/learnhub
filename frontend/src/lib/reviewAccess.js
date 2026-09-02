// The way into a course's reviews from the catalogue.
//
// The reviews feature is complete on the server and was all but unreachable in
// the browser. `<CourseReviews>` was rendered in exactly one place in the
// entire frontend — inside the certificate modal on the course player, which
// only opens once every section is complete (#136).
//
// Every catalogue card rendered a star average and a count and it was an inert
// div: no link, no button, no course detail page to navigate to. A prospective
// student saw "4.6 (23)" with no route to any of the 23, and the public
// `GET /api/reviews/:courseId` had no caller in the frontend at all.
//
// Whether a viewer may *write* one is `reviewEligibility.js`, which states the
// server's rule — enrolment, and not authorship of the course (#117, #122).
// Completion is not part of that rule and must not become part of it: that
// divergence is what this fix removes.

/**
 * The label for the control that opens a course's reviews.
 *
 * The catalogue badge is the entry point, so it has to say what it opens and
 * carry the numbers for a screen reader — "4.6 (23)" rendered as three
 * separate nodes is not a sentence.
 *
 * @param {object} summary
 * @param {number} [summary.averageRating]
 * @param {number} [summary.totalReviews]
 * @param {string} [courseTitle]
 * @returns {string}
 */
export function describeReviewsLink(summary = {}, courseTitle = '') {
  const total = Number(summary.totalReviews) || 0;
  const average = Number(summary.averageRating) || 0;
  const subject = courseTitle ? ` for ${courseTitle}` : '';

  if (total === 0) {
    return `No reviews yet${subject}. Open reviews`;
  }

  const noun = total === 1 ? 'review' : 'reviews';

  return `Rated ${average} out of 5 from ${total} ${noun}${subject}. Open reviews`;
}
