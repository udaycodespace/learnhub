const mongoose = require("mongoose");
const CourseBookmark = require("../schemas/courseBookmarkModel");
const Course = require("../schemas/courseModel");

const ALLOWED_SORTS = new Set([
  "recent",
  "title-asc",
  "title-desc",
  "price-asc",
  "price-desc",
]);

const parsePositiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
};

const getUserId = (req) =>
  req.user?._id?.toString() || req.body?.userId || null;

const isPaidCourse = (price) => /\d/.test(String(price || ""));

const parsePrice = (price) => {
  const parsed = Number.parseFloat(
    String(price || "").replace(/[^0-9.-]/g, ""),
  );

  return Number.isFinite(parsed) ? parsed : 0;
};

const serializeCourse = (course) => {
  if (!course) {
    return {
      id: null,
      title: "Course unavailable",
      category: "Unavailable",
      educator: "Unknown",
      description:
        "This saved course is no longer available in the catalog.",
      price: null,
      numericPrice: 0,
      accessType: "unavailable",
      availability: "deleted",
      enrolled: 0,
    };
  }

  const paid = isPaidCourse(course.C_price);

  return {
    id: course._id.toString(),
    title: course.C_title,
    category: course.C_categories,
    educator: course.C_educator,
    description: course.C_description,
    price: course.C_price || "Free",
    numericPrice: paid ? parsePrice(course.C_price) : 0,
    accessType: paid ? "paid" : "free",
    availability: "available",
    enrolled: course.enrolled || 0,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
};

const addBookmark = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { courseId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({
        success: false,
        message: "A valid course and authenticated user are required.",
      });
    }

    const course = await Course.findById(courseId)
      .select("_id C_title")
      .lean();

    if (!course) {
      return res.status(404).send({
        success: false,
        message: "Course not found.",
      });
    }

    const result = await CourseBookmark.findOneAndUpdate(
      { userId, courseId },
      { $setOnInsert: { userId, courseId } },
      { upsert: true, new: true, rawResult: true },
    );

    const created = Boolean(result?.lastErrorObject?.upserted);

    return res.status(created ? 201 : 200).send({
      success: true,
      created,
      bookmarked: true,
      courseId,
      message: created
        ? "Course saved successfully."
        : "Course was already saved.",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(200).send({
        success: true,
        created: false,
        bookmarked: true,
        courseId: req.params.courseId,
        message: "Course was already saved.",
      });
    }

    console.error("Unable to save course bookmark:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to save this course.",
    });
  }
};

const removeBookmark = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const result = await CourseBookmark.deleteOne({ userId, courseId });

    return res.status(200).send({
      success: true,
      bookmarked: false,
      removed: result.deletedCount > 0,
      courseId,
      message:
        result.deletedCount > 0
          ? "Course removed from saved courses."
          : "Course was not in your saved courses.",
    });
  } catch (error) {
    console.error("Unable to remove course bookmark:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to remove this saved course.",
    });
  }
};

const getBookmarkStatus = async (req, res) => {
  try {
    const userId = getUserId(req);
    const rawIds = [
      ...String(req.query.courseIds || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
      ...(Array.isArray(req.query.courseId)
        ? req.query.courseId
        : req.query.courseId
          ? [req.query.courseId]
          : []),
    ];

    const courseIds = [...new Set(rawIds)].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );

    if (courseIds.length > 100) {
      return res.status(400).send({
        success: false,
        message: "A maximum of 100 course IDs can be checked at once.",
      });
    }

    const bookmarks = await CourseBookmark.find({
      userId,
      courseId: { $in: courseIds },
    })
      .select("courseId")
      .lean();

    return res.status(200).send({
      success: true,
      data: bookmarks.map((bookmark) =>
        bookmark.courseId.toString(),
      ),
      count: bookmarks.length,
    });
  } catch (error) {
    console.error("Unable to retrieve bookmark status:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to retrieve bookmark status.",
    });
  }
};

const getSavedCourses = async (req, res) => {
  try {
    const userId = getUserId(req);
    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const limit = parsePositiveInteger(req.query.limit, 12, 50);
    const category = String(req.query.category || "").trim();
    const access = String(req.query.access || "").trim().toLowerCase();
    const availability = String(
      req.query.availability || "",
    ).trim().toLowerCase();
    const search = String(req.query.search || "")
      .trim()
      .toLowerCase()
      .slice(0, 120);
    const sort = String(req.query.sort || "recent").trim().toLowerCase();

    if (access && !["free", "paid"].includes(access)) {
      return res.status(400).send({
        success: false,
        message: "Invalid access filter.",
      });
    }

    if (
      availability &&
      !["available", "deleted"].includes(availability)
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid availability filter.",
      });
    }

    if (!ALLOWED_SORTS.has(sort)) {
      return res.status(400).send({
        success: false,
        message: "Invalid saved-course sort option.",
      });
    }

    const bookmarkDocs = await CourseBookmark.find({ userId })
      .populate({
        path: "courseId",
        select:
          "C_title C_categories C_educator C_description C_price enrolled createdAt updatedAt",
      })
      .sort({ createdAt: -1 })
      .lean();

    let items = bookmarkDocs.map((bookmark) => ({
      bookmarkId: bookmark._id.toString(),
      savedAt: bookmark.createdAt,
      course: serializeCourse(bookmark.courseId),
    }));

    if (search) {
      items = items.filter(({ course }) =>
        [
          course.title,
          course.category,
          course.educator,
          course.description,
        ].some((field) =>
          String(field || "").toLowerCase().includes(search),
        ),
      );
    }

    if (category) {
      items = items.filter(
        ({ course }) =>
          String(course.category || "").toLowerCase() ===
          category.toLowerCase(),
      );
    }

    if (access) {
      items = items.filter(
        ({ course }) => course.accessType === access,
      );
    }

    if (availability) {
      items = items.filter(
        ({ course }) => course.availability === availability,
      );
    }

    const sorters = {
      recent: (a, b) =>
        new Date(b.savedAt || 0) - new Date(a.savedAt || 0),
      "title-asc": (a, b) =>
        a.course.title.localeCompare(b.course.title),
      "title-desc": (a, b) =>
        b.course.title.localeCompare(a.course.title),
      "price-asc": (a, b) =>
        a.course.numericPrice - b.course.numericPrice,
      "price-desc": (a, b) =>
        b.course.numericPrice - a.course.numericPrice,
    };

    items.sort(sorters[sort]);

    const categories = [
      ...new Set(
        bookmarkDocs
          .map((bookmark) => bookmark.courseId?.C_categories)
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));

    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;

    return res.status(200).send({
      success: true,
      data: items.slice(start, start + limit),
      categories,
      pagination: {
        page: safePage,
        limit,
        totalItems,
        totalPages,
        hasPreviousPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      },
      filters: {
        search,
        category,
        access,
        availability,
        sort,
      },
    });
  } catch (error) {
    console.error("Unable to retrieve saved courses:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to retrieve saved courses.",
    });
  }
};

const clearBookmarks = async (req, res) => {
  try {
    const userId = getUserId(req);
    const result = await CourseBookmark.deleteMany({ userId });

    return res.status(200).send({
      success: true,
      removedCount: result.deletedCount,
      message: "Saved courses cleared successfully.",
    });
  } catch (error) {
    console.error("Unable to clear saved courses:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to clear saved courses.",
    });
  }
};

module.exports = {
  addBookmark,
  removeBookmark,
  getBookmarkStatus,
  getSavedCourses,
  clearBookmarks,
};
