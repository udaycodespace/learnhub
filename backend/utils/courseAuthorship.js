// Who wrote a course.
//
// `courseModel.userId` is declared `type: String` while every other reference
// in the project is an `ObjectId`. That mismatch is why this is a helper rather
// than a `===`: comparing a review's `ObjectId` author against a course's
// `String` owner without coercing both sides is always false, silently, and
// silently-false is exactly how #117 reads if you get it wrong.
//
// `courseDeletionController` already does this by hand for its ownership check
// (`const ownerId = String(course.userId || "")`) and `cascadeDelete` carries a
// comment about the same trap. This is that comparison, in one place.

/**
 * Whether an account authored a course.
 *
 * Both sides are stringified. An absent owner or an absent account is not a
 * match — a course with no `userId` is not owned by everybody.
 *
 * @param {object|null|undefined} course a course document, lean or hydrated
 * @param {string|object|null|undefined} userId
 * @returns {boolean}
 */
function isCourseAuthor(course, userId) {
  const owner = course?.userId;

  if (owner === undefined || owner === null) return false;
  if (userId === undefined || userId === null) return false;

  const ownerId = String(owner).trim();
  const candidate = String(userId).trim();

  if (!ownerId || !candidate) return false;

  return ownerId === candidate;
}

// What the API says, and what the review form shows in its place.
const AUTHOR_REVIEW_MESSAGE =
  "You cannot review a course you created.";

// The reasons `GET /api/reviews/:courseId/mine` gives for `canReview: false`.
//
// The client used to have one: not enrolled. An educator looking at their own
// course is a different situation and needs a different sentence, because
// enrolling — which they can do, and may already have done — will not help.
const REVIEW_DENIAL = Object.freeze({
  NOT_ENROLLED: "not-enrolled",
  OWN_COURSE: "own-course",
});

module.exports = {
  AUTHOR_REVIEW_MESSAGE,
  REVIEW_DENIAL,
  isCourseAuthor,
};
