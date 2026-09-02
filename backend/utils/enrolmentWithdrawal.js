// Leaving a course.
//
// #128. An enrolment row was only ever created. The only deletes in the project
// are in the cascade:
//
//   $ grep -rn "EnrolledCourse.*delete" backend --exclude-dir=node_modules
//   backend/utils/cascadeDelete.js:  models.EnrolledCourse.deleteMany(filter),
//   backend/utils/cascadeDelete.js:  models.EnrolledCourse.deleteMany({ userId }),
//
// — one for a deleted course, one for a deleted account. There was no way for a
// student to leave one, and a free course enrols on a single click with no
// confirmation step, because `handleEnroll` skips the payment modal entirely
// for a free course. A mis-click was permanent.
//
// It also inflated `course.enrolled` for good. That counter is incremented on
// enrolment and decremented in exactly one place, `decrementEnrolledCounts`,
// which only the delete cascade calls — and the catalogue sorts "popular" by
// it while the educator dashboard reports it as reach.

// The payment row is kept and marked, never deleted. A financial record must
// not disappear because somebody changed their mind, and the admin ledger
// should be able to say which enrolments were withdrawn.
const WITHDRAWN_STATUS = "withdrawn";

/**
 * Loads the models lazily, the way cascadeDelete does — requiring them at
 * module scope would pull Mongoose into every test that only wants the rules.
 */
function defaultModels() {
  return {
    Course: require("../schemas/courseModel"),
    EnrolledCourse: require("../schemas/enrolledCourseModel"),
    CoursePayment: require("../schemas/coursePaymentModel"),
    CourseReview: require("../schemas/courseReviewModel"),
  };
}

const countOf = (result, key) => Number(result?.[key] || 0);

/**
 * Withdraws one student from one course.
 *
 * The enrolment is read first, then removed, and only then is anything else
 * touched: if the delete matches nothing — two tabs, two clicks — the caller
 * finds out before the learner count has been decremented twice.
 *
 * @param {object} options
 * @param {string} options.userId
 * @param {string} options.courseId
 * @param {object} [options.models]
 * @returns {Promise<{ withdrawn: boolean, enrolment: object|null,
 *   reviews: number, payments: number, learnerCountAdjusted: boolean }>}
 */
async function withdrawEnrolment({
  userId,
  courseId,
  models = defaultModels(),
} = {}) {
  const filter = { userId, courseId };

  // Removing the row removes the `progress` array with it — progress is stored
  // on the enrolment, not separately — which is the right outcome: it is
  // progress through a course this account is no longer taking.
  const enrolment = await models.EnrolledCourse.findOneAndDelete(filter);

  if (!enrolment) {
    return {
      withdrawn: false,
      enrolment: null,
      reviews: 0,
      payments: 0,
      learnerCountAdjusted: false,
    };
  }

  // The same guarded decrement `decrementEnrolledCounts` uses. `enrolled` has
  // drifted on existing data because it was only ever incremented, so the
  // guard rather than a recount: a recount would silently rewrite history the
  // admin has been looking at, and `{ $gt: 0 }` is what stops it going
  // negative.
  const decrement = await models.Course.updateOne(
    { _id: courseId, enrolled: { $gt: 0 } },
    { $inc: { enrolled: -1 } },
  );

  // A review is only allowed to exist alongside an enrolment — `createReview`
  // refuses without one, and every review is serialised with
  // `verifiedEnrollment: true`. Leaving it behind would make that claim false.
  const reviews = await models.CourseReview.deleteMany(filter);

  // Marked, not deleted. Only rows that still describe a live enrolment are
  // touched, so a row already marked withdrawn from an earlier cycle is left
  // as it is.
  const payments = await models.CoursePayment.updateMany(
    { ...filter, status: { $ne: WITHDRAWN_STATUS } },
    { $set: { status: WITHDRAWN_STATUS } },
  );

  return {
    withdrawn: true,
    enrolment,
    reviews: countOf(reviews, "deletedCount"),
    payments: countOf(payments, "modifiedCount"),
    learnerCountAdjusted: countOf(decrement, "modifiedCount") > 0,
  };
}

module.exports = {
  WITHDRAWN_STATUS,
  defaultModels,
  withdrawEnrolment,
};
