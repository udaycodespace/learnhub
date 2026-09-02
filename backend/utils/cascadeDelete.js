const { removeCourseVideoFiles } = require("./courseFileCleanup");

// Deleting a user or a course was a single findByIdAndDelete with nothing after
// it. Everything pointing at the deleted row survived: enrolments, payments,
// reviews, bookmarks, activity logs, and every section video on disk.
//
// The symptoms show up all over the app. The admin dashboard populates
// userId/courseId on rows whose target is gone and renders blanks.
// getSummary() keeps counting reviews written by accounts that no longer
// exist. getEnrolledCoursesController has to defensively skip enrolments whose
// course is missing (#65) purely because nothing cleans them up.
//
// Both entry points go through here so the two cannot diverge again.
//
// #116 batched the writes. The rows removed, the counters written and the
// summary returned are all unchanged; what changed is how many round trips it
// takes to get there. Deleting an account used to cost one awaited write per
// enrolment and five per authored course, so a teacher with 40 courses and 300
// enrolments was ~500 sequential operations inside one HTTP request.

/**
 * Loads the models lazily. Requiring them at module scope would pull Mongoose
 * into every test that only wants the counting logic.
 */
function defaultModels() {
  return {
    Course: require("../schemas/courseModel"),
    EnrolledCourse: require("../schemas/enrolledCourseModel"),
    CoursePayment: require("../schemas/coursePaymentModel"),
    CourseReview: require("../schemas/courseReviewModel"),
    CourseBookmark: require("../schemas/courseBookmarkModel"),
    ActivityLog: require("../schemas/activityLogModel"),
  };
}

const deletedCount = (result) => Number(result?.deletedCount || 0);

const emptyFiles = () => ({ deleted: 0, failed: 0 });

const emptyCourseResult = () => ({
  enrolments: 0,
  payments: 0,
  reviews: 0,
  bookmarks: 0,
  files: emptyFiles(),
});

/**
 * The filter matching one course or many.
 *
 * A single id stays an equality match rather than becoming a one-element
 * `$in`. Both use the same index, but the common path — a teacher deleting one
 * course — should read in the profiler as the query it always was.
 *
 * @param {Array<string|object>} courseIds
 * @returns {object} a Mongo filter on `courseId`
 */
function buildCourseIdFilter(courseIds) {
  return courseIds.length === 1
    ? { courseId: courseIds[0] }
    : { courseId: { $in: courseIds } };
}

/**
 * Runs the per-course file cleanup and folds the results together.
 *
 * Sequential on purpose. This is the one part of a cascade that is genuinely
 * per-item — every section video is its own unlink — and running an unbounded
 * number of them at once trades a latency problem for a file-descriptor one.
 *
 * @param {object[]} courses
 * @param {Function} cleanupFiles
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
async function removeVideoFilesFor(courses, cleanupFiles) {
  const files = emptyFiles();

  for (const course of courses) {
    if (!course) continue;

    const result = await cleanupFiles(course);

    files.deleted += result.deleted.length;
    files.failed += result.failed.length;
  }

  return files;
}

/**
 * Removes everything that references any of these courses, except the courses
 * themselves.
 *
 * Four `deleteMany` calls in total, whatever the number of courses. The
 * previous shape called `removeCourseDependents` in a loop, which was four per
 * course plus a `deleteOne` — the same defect #96 and #104 fixed on the read
 * path, on the write path.
 *
 * @param {Array<string|object>} courseIds
 * @param {object} [options]
 * @param {object} [options.models]
 * @param {object[]} [options.courses] the deleted documents, for video cleanup
 * @param {Function} [options.cleanupFiles]
 * @returns {Promise<{ enrolments: number, payments: number, reviews: number, bookmarks: number, files: { deleted: number, failed: number } }>}
 */
async function removeCoursesDependents(
  courseIds,
  {
    models = defaultModels(),
    courses = [],
    cleanupFiles = removeCourseVideoFiles,
  } = {},
) {
  if (courseIds.length === 0) {
    // Still run the cleanup: removeCourseDependents can be handed a course
    // document without there being anything else to delete.
    return {
      ...emptyCourseResult(),
      files: await removeVideoFilesFor(courses, cleanupFiles),
    };
  }

  const filter = buildCourseIdFilter(courseIds);

  const [enrolments, payments, reviews, bookmarks] = await Promise.all([
    models.EnrolledCourse.deleteMany(filter),
    models.CoursePayment.deleteMany(filter),
    models.CourseReview.deleteMany(filter),
    models.CourseBookmark.deleteMany(filter),
  ]);

  // Only the teacher-facing route used to do this. The admin route deleted the
  // row and left the .mp4 behind forever.
  const files = await removeVideoFilesFor(courses, cleanupFiles);

  return {
    enrolments: deletedCount(enrolments),
    payments: deletedCount(payments),
    reviews: deletedCount(reviews),
    bookmarks: deletedCount(bookmarks),
    files,
  };
}

/**
 * Removes everything that references a course, except the course itself.
 *
 * The caller deletes the course document — it may need the document first, to
 * check ownership or to collect filenames — and calls this afterwards.
 *
 * Kept as the single-course form of the above, unchanged in signature and in
 * what it returns, because `courseDeletionController` calls it directly.
 *
 * @param {string|object} courseId
 * @param {object} [options]
 * @param {object} [options.models]
 * @param {object} [options.course] the deleted document, for video cleanup
 * @param {Function} [options.cleanupFiles]
 * @returns {Promise<{ enrolments: number, payments: number, reviews: number, bookmarks: number, files: { deleted: number, failed: number } }>}
 */
async function removeCourseDependents(
  courseId,
  { models = defaultModels(), course = null, cleanupFiles = removeCourseVideoFiles } = {},
) {
  return removeCoursesDependents([courseId], {
    models,
    courses: course ? [course] : [],
    cleanupFiles,
  });
}

/**
 * The bulk operations that take `count` learners off each course.
 *
 * Written as one guarded `$inc: -1` per enrolment rather than a single
 * `$inc: -count`, because `enrolled` has drifted on existing data — it was only
 * ever incremented, and nothing decremented it before #74 — so a course can
 * hold fewer enrolments than its counter claims. `enrolled: { $gt: 0 }` is
 * re-evaluated per operation, which is what stops the counter going negative
 * and rendering `LEARNERS: -3` on a catalogue card. A single `$inc: -count`
 * would have no such guard.
 *
 * Exposed so a test can assert the shape without a database.
 *
 * @param {Map<string, number>} countsByCourse
 * @returns {object[]} operations for `bulkWrite`
 */
function buildEnrolledDecrementOperations(countsByCourse) {
  const operations = [];

  for (const [courseId, count] of countsByCourse) {
    for (let step = 0; step < count; step += 1) {
      operations.push({
        updateOne: {
          filter: { _id: courseId, enrolled: { $gt: 0 } },
          update: { $inc: { enrolled: -1 } },
        },
      });
    }
  }

  return operations;
}

/**
 * Gives back the learner count a course loses when `count` enrolments go away.
 *
 * Was a nested loop of awaited `updateOne` calls — one round trip per
 * enrolment, not per course. Same operations, same guard, one round trip.
 *
 * `ordered: true` is deliberate. The guard only does its job if the operations
 * are applied one after another: two unordered decrements against a course
 * whose counter is already at 1 could both see `enrolled > 0`.
 *
 * @param {Map<string, number>} countsByCourse
 * @param {object} CourseModel
 * @returns {Promise<number>} how many operations were issued
 */
async function decrementEnrolledCounts(countsByCourse, CourseModel) {
  const operations = buildEnrolledDecrementOperations(countsByCourse);

  if (operations.length === 0) return 0;

  await CourseModel.bulkWrite(operations, { ordered: true });

  return operations.length;
}

/**
 * Counts a user's enrolments per course, so the learner count on each affected
 * course can be corrected.
 *
 * @param {object[]} enrolments
 * @returns {Map<string, number>}
 */
function groupByCourse(enrolments) {
  const counts = new Map();

  for (const enrolment of enrolments) {
    if (!enrolment?.courseId) continue;

    const key = String(enrolment.courseId);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

// The only fields the authored-course pass reads: the id, to delete by and to
// cascade on, and `sections`, which is where removeCourseVideoFiles finds the
// filenames. `find()` used to return whole documents — and `sections` carries
// every section's S_title, S_description and S_content.path, so on a course
// with twenty sections that is the largest field in the document, fetched to
// be thrown away.
const AUTHORED_COURSE_FIELDS = "_id sections";

/**
 * Removes everything that references a user, including courses they authored.
 *
 * The caller deletes the user document. This handles the rest.
 *
 * @param {string|object} userId
 * @param {object} [options]
 * @returns {Promise<object>} a summary suitable for the API response
 */
async function removeUserDependents(
  userId,
  { models = defaultModels(), cleanupFiles = removeCourseVideoFiles } = {},
) {
  const summary = {
    authoredCourses: 0,
    enrolments: 0,
    payments: 0,
    reviews: 0,
    bookmarks: 0,
    activityLogs: 0,
    files: { deleted: 0, failed: 0 },
  };

  // courseModel.userId is a String while every other reference is an ObjectId,
  // so authored courses are matched on the string form. Passing an ObjectId
  // here silently matches nothing.
  const authored = await models.Course.find({ userId: String(userId) })
    .select(AUTHORED_COURSE_FIELDS)
    .lean();

  if (authored.length > 0) {
    const authoredIds = authored.map((course) => course._id);

    // One pass for every authored course, rather than a full cascade each.
    const courseResult = await removeCoursesDependents(authoredIds, {
      models,
      courses: authored,
      cleanupFiles,
    });

    summary.enrolments += courseResult.enrolments;
    summary.payments += courseResult.payments;
    summary.reviews += courseResult.reviews;
    summary.bookmarks += courseResult.bookmarks;
    summary.files.deleted += courseResult.files.deleted;
    summary.files.failed += courseResult.files.failed;

    const removedCourses = await models.Course.deleteMany({
      _id: { $in: authoredIds },
    });

    // The delete is what is counted, not the read: a course removed between
    // the find and the delete should not be reported as deleted here.
    summary.authoredCourses = deletedCount(removedCourses);
  }

  // The user's own enrolments, in courses somebody else owns. Read before
  // deleting so the learner count on each course can be corrected.
  const ownEnrolments = await models.EnrolledCourse.find({ userId })
    .select("courseId")
    .lean();

  const [enrolments, payments, reviews, bookmarks, logs] = await Promise.all([
    models.EnrolledCourse.deleteMany({ userId }),
    models.CoursePayment.deleteMany({ userId }),
    models.CourseReview.deleteMany({ userId }),
    models.CourseBookmark.deleteMany({ userId }),
    models.ActivityLog.deleteMany({ userId }),
  ]);

  await decrementEnrolledCounts(groupByCourse(ownEnrolments), models.Course);

  summary.enrolments += deletedCount(enrolments);
  summary.payments += deletedCount(payments);
  summary.reviews += deletedCount(reviews);
  summary.bookmarks += deletedCount(bookmarks);
  summary.activityLogs = deletedCount(logs);

  return summary;
}

module.exports = {
  AUTHORED_COURSE_FIELDS,
  buildCourseIdFilter,
  buildEnrolledDecrementOperations,
  decrementEnrolledCounts,
  defaultModels,
  groupByCourse,
  removeCourseDependents,
  removeCoursesDependents,
  removeUserDependents,
};
