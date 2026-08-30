const mongoose = require("mongoose");
const RecentlyViewed = require("../schemas/recentlyViewedModel");
const Course = require("../schemas/courseModel");

const getUserId = (req) => req.user?._id?.toString() || req.body?.userId || null;

/**
 * Suggests courses based on the categories of recently viewed courses.
 * Finds the user's recently viewed courses, extracts unique categories,
 * then fetches popular courses in those categories that the user hasn't
 * viewed yet. Falls back to general popular courses if no history exists.
 */
exports.getSuggestedCourses = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).send({ success: false, message: "Authentication required." });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 12);

    const recentDocs = await RecentlyViewed.find({ userId })
      .populate({ path: "courseId", select: "C_categories" })
      .sort({ viewedAt: -1 })
      .limit(10)
      .lean();

    const recentCourseIds = recentDocs
      .filter((d) => d.courseId)
      .map((d) => d.courseId._id);

    const categories = [
      ...new Set(
        recentDocs
          .filter((d) => d.courseId?.C_categories)
          .map((d) => d.courseId.C_categories),
      ),
    ];

    let query = {};

    if (recentCourseIds.length > 0) {
      query._id = { $nin: recentCourseIds };
    }

    if (categories.length > 0) {
      query.C_categories = { $in: categories };
    }

    let courses = await Course.find(query)
      .select("C_title C_categories C_educator C_price enrolled userId")
      .sort({ enrolled: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (courses.length < limit && categories.length > 0) {
      const fillQuery = { _id: { $nin: [...recentCourseIds, ...courses.map((c) => c._id)] } };
      const fillers = await Course.find(fillQuery)
        .select("C_title C_categories C_educator C_price enrolled userId")
        .sort({ enrolled: -1 })
        .limit(limit - courses.length)
        .lean();
      courses = [...courses, ...fillers];
    }

    if (courses.length < limit) {
      const allIds = [
        ...recentCourseIds,
        ...courses.map((c) => c._id),
      ];
      const popular = await Course.find({ _id: { $nin: allIds } })
        .select("C_title C_categories C_educator C_price enrolled userId")
        .sort({ enrolled: -1 })
        .limit(limit - courses.length)
        .lean();
      courses = [...courses, ...popular];
    }

    const data = courses.map((c) => ({
      id: c._id,
      title: c.C_title,
      category: c.C_categories,
      educator: c.C_educator,
      price: c.C_price,
      enrolled: c.enrolled,
    }));

    return res.status(200).send({
      success: true,
      data,
      basedOn: categories.length > 0 ? categories : null,
    });
  } catch (err) {
    console.error("getSuggestedCourses:", err);
    return res.status(500).send({ success: false, message: "Unable to load suggestions." });
  }
};
