const mongoose = require("mongoose");
const Course = require("../schemas/courseModel");
const EnrolledCourse = require("../schemas/enrolledCourseModel");
const CourseReview = require("../schemas/courseReviewModel");

const getUserId = (req) => req.user?._id?.toString() || req.body?.userId || null;

exports.getTeacherAnalytics = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).send({ success: false, message: "Authentication required." });
    }

    const courses = await Course.find({ userId })
      .select("C_title C_categories C_price enrolled createdAt")
      .sort({ createdAt: -1 })
      .lean();

    if (courses.length === 0) {
      return res.status(200).send({
        success: true,
        data: {
          summary: { totalCourses: 0, totalEnrollments: 0, averageRating: 0, totalReviews: 0 },
          courses: [],
        },
      });
    }

    const courseIds = courses.map((c) => c._id);

    const [enrollmentCounts, reviewAggregates] = await Promise.all([
      EnrolledCourse.aggregate([
        { $match: { courseId: { $in: courseIds } } },
        { $group: { _id: "$courseId", count: { $sum: 1 } } },
      ]),
      CourseReview.aggregate([
        { $match: { courseId: { $in: courseIds } } },
        {
          $group: {
            _id: "$courseId",
            avgRating: { $avg: "$rating" },
            totalReviews: { $sum: 1 },
          },
        },
      ]),
    ]);

    const enrollmentMap = new Map(enrollmentCounts.map((e) => [e._id.toString(), e.count]));
    const reviewMap = new Map(reviewAggregates.map((r) => [r._id.toString(), r]));

    let totalEnrollments = 0;
    let totalReviews = 0;
    let ratingSum = 0;
    let ratedCourseCount = 0;

    const courseData = courses.map((c) => {
      const enrollments = enrollmentMap.get(c._id.toString()) || 0;
      const reviewData = reviewMap.get(c._id.toString());
      const avgRating = reviewData ? Number(reviewData.avgRating.toFixed(1)) : 0;
      const reviews = reviewData?.totalReviews || 0;

      totalEnrollments += enrollments;
      totalReviews += reviews;
      if (reviews > 0) { ratingSum += avgRating; ratedCourseCount++; }

      return {
        id: c._id,
        title: c.C_title,
        category: c.C_categories,
        price: c.C_price,
        enrollments,
        averageRating: avgRating,
        totalReviews: reviews,
        createdAt: c.createdAt,
      };
    });

    return res.status(200).send({
      success: true,
      data: {
        summary: {
          totalCourses: courses.length,
          totalEnrollments,
          averageRating: ratedCourseCount > 0 ? Number((ratingSum / ratedCourseCount).toFixed(1)) : 0,
          totalReviews,
        },
        courses: courseData,
      },
    });
  } catch (err) {
    console.error("getTeacherAnalytics:", err);
    return res.status(500).send({ success: false, message: "Unable to load analytics." });
  }
};

exports.getCourseDetail = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { courseId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({ success: false, message: "Valid user and course required." });
    }

    const course = await Course.findOne({ _id: courseId, userId })
      .select("C_title C_categories C_price enrolled sections createdAt")
      .lean();

    if (!course) {
      return res.status(404).send({ success: false, message: "Course not found or access denied." });
    }

    const [enrollmentData, reviewData, recentEnrollments] = await Promise.all([
      EnrolledCourse.aggregate([
        { $match: { courseId: course._id } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completedCount: {
              $sum: { $cond: [{ $gte: [{ $size: "$progress" }, { $size: "$course_Length" }] }, 1, 0] },
            },
            avgProgress: { $avg: { $size: "$progress" } },
          },
        },
      ]),
      CourseReview.aggregate([
        { $match: { courseId: course._id } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: "$rating" },
            total: { $sum: 1 },
            distribution: {
              $push: "$rating",
            },
          },
        },
      ]),
      EnrolledCourse.find({ courseId: course._id })
        .populate("userId", "name email")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    const enroll = enrollmentData[0] || { total: 0, completedCount: 0, avgProgress: 0 };
    const review = reviewData[0] || { avgRating: 0, total: 0, distribution: [] };

    const ratingDist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    (review.distribution || []).forEach((r) => { ratingDist[r] = (ratingDist[r] || 0) + 1; });

    return res.status(200).send({
      success: true,
      data: {
        course: { id: course._id, title: course.C_title, category: course.C_categories, sections: (course.sections || []).length },
        enrollments: { total: enroll.total, completed: enroll.completedCount, averageProgress: Math.round(enroll.avgProgress || 0) },
        reviews: { average: Number(review.avgRating.toFixed(1)), total: review.total, distribution: ratingDist },
        recentEnrollments: recentEnrollments.map((e) => ({
          user: { name: e.userId?.name || "Student", email: e.userId?.email },
          enrolledAt: e.createdAt,
          progress: e.progress?.length || 0,
        })),
      },
    });
  } catch (err) {
    console.error("getCourseDetail:", err);
    return res.status(500).send({ success: false, message: "Unable to load course analytics." });
  }
};
