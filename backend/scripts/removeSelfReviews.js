// Removes reviews an educator wrote on a course they authored.
//
// `createReview` only ever checked that the reviewer was enrolled, and nothing
// stops an author enrolling in their own course — nor should it, since
// previewing the sections requires an enrolment. Two requests were enough to
// put a five-star review on your own course, badged "✓ Verified enrollment",
// counted in the average the catalogue badge renders and the summary the
// rating sorts on (#117).
//
// The controller refuses to write new ones now. This clears the ones already
// written, because guarding the write leaves the existing rows in the average
// exactly where they were.
//
// The match is the same comparison the controller makes: `courseModel.userId`
// is a String while `courseReview.userId` is an ObjectId, so both sides are
// stringified rather than compared directly — which is silently false, always,
// if you forget.
//
// Usage:
//   npm run db:remove-self-reviews -- --dry-run
//   npm run db:remove-self-reviews

const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const Course = require("../schemas/courseModel");
const CourseReview = require("../schemas/courseReviewModel");

/**
 * Finds every review whose author is the course's author.
 *
 * Done as an aggregation rather than by walking reviews and loading a course
 * each time: a review collection of any size would otherwise be one query per
 * row. The `$lookup` runs on `courseId`, which `courseReviewSchema` indexes.
 *
 * `$toString` on the review's ObjectId is what bridges the two field types.
 *
 * @param {object} [options]
 * @param {object} [options.ReviewModel]
 * @returns {Promise<object[]>} the offending reviews, with course context
 */
async function findSelfReviews({ ReviewModel = CourseReview } = {}) {
  return ReviewModel.aggregate([
    {
      $lookup: {
        from: Course.collection.name,
        localField: "courseId",
        foreignField: "_id",
        as: "course",
      },
    },
    { $unwind: "$course" },
    {
      $match: {
        $expr: { $eq: [{ $toString: "$userId" }, "$course.userId"] },
      },
    },
    {
      $project: {
        _id: 1,
        rating: 1,
        userId: 1,
        courseId: 1,
        courseTitle: "$course.C_title",
      },
    },
  ]);
}

/**
 * @param {object} [options]
 * @param {boolean} [options.apply] false for a dry run
 * @param {object} [options.ReviewModel]
 * @param {object} [options.logger]
 * @returns {Promise<{ found: number, removed: number, details: object[] }>}
 */
async function removeSelfReviews({
  apply = true,
  ReviewModel = CourseReview,
  logger = console,
} = {}) {
  const offending = await findSelfReviews({ ReviewModel });

  if (offending.length === 0) {
    logger.log("No self-reviews found.");
    return { found: 0, removed: 0, details: [] };
  }

  logger.log(`Found ${offending.length} review(s) written by a course's own author:`);

  for (const review of offending) {
    logger.log(
      `  ${review.rating}★ on "${review.courseTitle}" (course ${review.courseId}) ` +
        `by its author ${review.userId}`,
    );
  }

  if (!apply) {
    logger.log(
      `Dry run complete. ${offending.length} review(s) would be removed.`,
    );
    return { found: offending.length, removed: 0, details: offending };
  }

  const result = await ReviewModel.deleteMany({
    _id: { $in: offending.map((review) => review._id) },
  });

  const removed = Number(result?.deletedCount || 0);

  logger.log(`Done. ${removed} review(s) removed.`);

  return { found: offending.length, removed, details: offending };
}

async function main() {
  const apply = !process.argv.includes("--dry-run");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is required");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB_NAME || "video-course-application",
  });

  try {
    await removeSelfReviews({ apply });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Removing self-reviews failed:", error);
    process.exit(1);
  });
}

module.exports = {
  findSelfReviews,
  removeSelfReviews,
};
