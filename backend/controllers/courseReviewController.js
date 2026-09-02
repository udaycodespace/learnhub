const mongoose = require("mongoose");
const CourseReview = require("../schemas/courseReviewModel");
const Course = require("../schemas/courseModel");
const EnrolledCourse = require("../schemas/enrolledCourseModel");
const {
  AUTHOR_REVIEW_MESSAGE,
  REVIEW_DENIAL,
  isCourseAuthor,
} = require("../utils/courseAuthorship");
const {
  MAX_SUMMARY_IDS,
  buildSummaryMap,
  buildSummaryPipeline,
  emptySummary,
  formatSummaryRow,
  normalizeCourseIds,
} = require("../utils/reviewSummaries");

const ALLOWED_SORTS = new Set(["newest", "oldest", "highest", "lowest"]);

const parsePositiveInteger = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const validateCourseId = (courseId) => mongoose.Types.ObjectId.isValid(courseId);

const getAuthenticatedUserId = (req) =>
  req.user?._id?.toString() || req.body?.userId || null;

// `verifiedEnrollment` used to be the literal `true` on every row, and the
// review card rendered its "✓ Verified enrollment" badge without reading the
// field at all. Every review does come from an enrolment — createReview checks
// — but the badge is a claim about independence, and an author reviewing their
// own course satisfied the enrolment check while making the badge a lie (#117).
//
// It is a real value now, so a self-review already in the data is not badged as
// something it is not. New ones cannot be written.
const serializeReview = (review, currentUserId = null, options = {}) => ({
  id: review._id.toString(),
  rating: review.rating,
  reviewText: review.reviewText || "",
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
  verifiedEnrollment: options.authorId
    ? !isCourseAuthor({ userId: options.authorId }, review.userId?._id || review.userId)
    : true,
  user: {
    id: review.userId?._id?.toString() || review.userId?.toString() || null,
    name: review.userId?.name || "LearnHub student",
  },
  isOwner:
    Boolean(currentUserId) &&
    String(review.userId?._id || review.userId) === String(currentUserId),
});

// One course. Same pipeline as the batch path, so the two cannot drift apart.
const getSummary = async (courseId) => {
  const [summary] = await CourseReview.aggregate(
    buildSummaryPipeline([String(courseId)]),
  );

  return summary ? formatSummaryRow(summary) : emptySummary();
};

// Many courses, one indexed pass. CourseRatingBadge used to call the single
// endpoint once per card, so a twelve-card catalogue page ran twelve of these.
const getSummariesFor = async (courseIds) => {
  if (courseIds.length === 0) return {};

  const rows = await CourseReview.aggregate(buildSummaryPipeline(courseIds));

  return buildSummaryMap(courseIds, rows);
};

// `userId` is selected because it is the course's author, and an author may
// not review their own course. It is one more field on a projection that was
// already being fetched, not another query.
const ensureCourseExists = async (courseId) => {
  const course = await Course.findById(courseId)
    .select("_id C_title userId")
    .lean();
  return course;
};

const ensureEnrollment = async (userId, courseId) => {
  return EnrolledCourse.findOne({ userId, courseId }).select("_id").lean();
};

const createReview = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const rating = Number(req.body.rating);
    const reviewText = String(req.body.reviewText || "").trim();

    if (!userId || !validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "A valid course and authenticated user are required.",
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).send({
        success: false,
        message: "Rating must be an integer from 1 to 5.",
      });
    }

    if (reviewText.length > 1000) {
      return res.status(400).send({
        success: false,
        message: "Review text cannot exceed 1000 characters.",
      });
    }

    const course = await ensureCourseExists(courseId);
    if (!course) {
      return res.status(404).send({
        success: false,
        message: "Course not found.",
      });
    }

    // Checked before the enrolment, because an author can enrol in their own
    // course — nothing stops them, and nothing should: previewing it requires
    // an enrolment, since sendCourseContentController will not serve the
    // sections without one. So the enrolment is not the thing that is wrong,
    // and "you are not enrolled" would be the wrong answer to give them.
    if (isCourseAuthor(course, userId)) {
      return res.status(403).send({
        success: false,
        message: AUTHOR_REVIEW_MESSAGE,
        reason: REVIEW_DENIAL.OWN_COURSE,
      });
    }

    const enrollment = await ensureEnrollment(userId, courseId);
    if (!enrollment) {
      return res.status(403).send({
        success: false,
        message: "Only enrolled students can review this course.",
        reason: REVIEW_DENIAL.NOT_ENROLLED,
      });
    }

    const review = await CourseReview.create({
      userId,
      courseId,
      rating,
      reviewText,
    });

    await review.populate("userId", "name");

    return res.status(201).send({
      success: true,
      message: "Review submitted successfully.",
      data: serializeReview(review, userId, { authorId: course.userId }),
      summary: await getSummary(courseId),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).send({
        success: false,
        message: "You have already reviewed this course.",
      });
    }

    console.error("Unable to create course review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to submit the review.",
    });
  }
};

const listReviews = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const limit = parsePositiveInteger(req.query.limit, 5, 25);
    const sort = String(req.query.sort || "newest").toLowerCase();

    if (!ALLOWED_SORTS.has(sort)) {
      return res.status(400).send({
        success: false,
        message: "Invalid review sort option.",
      });
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      highest: { rating: -1, createdAt: -1 },
      lowest: { rating: 1, createdAt: -1 },
    };

    // One extra projected read, so `verifiedEnrollment` can be a fact rather
    // than the literal `true` it used to be. A self-review already in the data
    // is reported as one instead of being badged as independent (#117).
    const [totalItems, course] = await Promise.all([
      CourseReview.countDocuments({ courseId }),
      Course.findById(courseId).select("userId").lean(),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    const currentUserId = req.user?._id?.toString() || null;

    const reviews = await CourseReview.find({ courseId })
      .populate("userId", "name")
      .sort(sortMap[sort])
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).send({
      success: true,
      data: reviews.map((review) =>
        serializeReview(review, currentUserId, { authorId: course?.userId }),
      ),
      summary: await getSummary(courseId),
      pagination: {
        page: safePage,
        limit,
        totalItems,
        totalPages,
        hasPreviousPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      },
      sort,
    });
  } catch (error) {
    console.error("Unable to retrieve course reviews:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve course reviews.",
    });
  }
};

/**
 * GET /api/reviews/summaries?courseIds=a,b,c
 *
 * Registered before GET /:courseId in the router, or "summaries" would match
 * the parameter and this route would never be reached — the same shadowing
 * that made DELETE /api/admin/deleteuser unauthenticated in #53.
 */
const getRatingSummaries = async (req, res) => {
  try {
    const courseIds = normalizeCourseIds(req.query.courseIds);

    // An empty or entirely unusable list is not an error: the client asked
    // about no courses and gets summaries for no courses.
    return res.status(200).send({
      success: true,
      data: await getSummariesFor(courseIds),
      requested: courseIds.length,
      limit: MAX_SUMMARY_IDS,
    });
  } catch (error) {
    console.error("Unable to retrieve rating summaries:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve rating summaries.",
    });
  }
};

const getRatingSummary = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    return res.status(200).send({
      success: true,
      data: await getSummary(courseId),
    });
  } catch (error) {
    console.error("Unable to retrieve rating summary:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve rating summary.",
    });
  }
};

const updateReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const rating = Number(req.body.rating);
    const reviewText = String(req.body.reviewText || "").trim();

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid review ID.",
      });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).send({
        success: false,
        message: "Rating must be an integer from 1 to 5.",
      });
    }

    if (reviewText.length > 1000) {
      return res.status(400).send({
        success: false,
        message: "Review text cannot exceed 1000 characters.",
      });
    }

    // Read before writing, rather than findOneAndUpdate in one call. Creating
    // a self-review is blocked, but a row written before that guard existed is
    // still owned by its author, and findOneAndUpdate would let them edit it —
    // reintroducing by the back door exactly what the create path refuses.
    const existing = await CourseReview.findOne({ _id: reviewId, userId })
      .select("courseId")
      .lean();

    if (!existing) {
      return res.status(404).send({
        success: false,
        message: "Review not found or you do not own it.",
      });
    }

    const course = await Course.findById(existing.courseId)
      .select("userId")
      .lean();

    if (isCourseAuthor(course, userId)) {
      return res.status(403).send({
        success: false,
        message: AUTHOR_REVIEW_MESSAGE,
        reason: REVIEW_DENIAL.OWN_COURSE,
      });
    }

    const review = await CourseReview.findOneAndUpdate(
      { _id: reviewId, userId },
      { rating, reviewText },
      { new: true, runValidators: true },
    ).populate("userId", "name");

    if (!review) {
      return res.status(404).send({
        success: false,
        message: "Review not found or you do not own it.",
      });
    }

    return res.status(200).send({
      success: true,
      message: "Review updated successfully.",
      data: serializeReview(review, userId, { authorId: course?.userId }),
      summary: await getSummary(review.courseId.toString()),
    });
  } catch (error) {
    console.error("Unable to update course review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to update the review.",
    });
  }
};

const deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid review ID.",
      });
    }

    const review = await CourseReview.findOneAndDelete({
      _id: reviewId,
      userId,
    });

    if (!review) {
      return res.status(404).send({
        success: false,
        message: "Review not found or you do not own it.",
      });
    }

    return res.status(200).send({
      success: true,
      message: "Review deleted successfully.",
      summary: await getSummary(review.courseId.toString()),
    });
  } catch (error) {
    console.error("Unable to delete course review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to delete the review.",
    });
  }
};

const getMyReview = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const [review, enrollment, course] = await Promise.all([
      CourseReview.findOne({ courseId, userId })
        .populate("userId", "name")
        .lean(),
      ensureEnrollment(userId, courseId),
      Course.findById(courseId).select("userId").lean(),
    ]);

    // The client renders the review form on `canReview` alone, so an author
    // used to be shown a form that answers 403. `reason` is what lets it say
    // something true instead: enrolling is the answer to one of these and not
    // to the other.
    const isAuthor = isCourseAuthor(course, userId);
    const canReview = !isAuthor && Boolean(enrollment);

    let reason = null;
    if (isAuthor) reason = REVIEW_DENIAL.OWN_COURSE;
    else if (!enrollment) reason = REVIEW_DENIAL.NOT_ENROLLED;

    return res.status(200).send({
      success: true,
      data: review
        ? serializeReview(review, userId, { authorId: course?.userId })
        : null,
      canReview,
      reason,
      // The enrolment on its own, kept separate from whether a review is
      // possible: an author previewing their own course is enrolled.
      isEnrolled: Boolean(enrollment),
      isAuthor,
    });
  } catch (error) {
    console.error("Unable to retrieve current review:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve your review.",
    });
  }
};

module.exports = {
  createReview,
  listReviews,
  getRatingSummaries,
  getRatingSummary,
  updateReview,
  deleteReview,
  getMyReview,
};
