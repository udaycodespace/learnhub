const {
  buildPaginationMetadata,
  normalizePagination,
} = require("../utils/pagination");
// Moved to utils/courseProgress so the course player reads the same rule (#93).
// Re-exported below, unchanged, for the tests and callers that import them
// from this module.
const {
  buildProgressSummary,
  countCompletedSections,
} = require("../utils/courseProgress");

/**
 * GET /api/user/getallcoursesuser — the student "My courses" list.
 *
 * The previous implementation issued one findOne per enrolment and pushed the
 * raw result (including `null` for deleted courses) straight into the response.
 * This version does two queries regardless of how many enrolments there are,
 * drops enrolments whose course no longer exists, and carries the progress
 * context the client would otherwise have to fetch separately.
 */

function getRequestingUserId(req) {
  const user = req.user || {};
  const fromMiddleware = user._id || user.id;

  if (fromMiddleware) {
    return String(fromMiddleware);
  }

  // The auth middleware also copies the id into the body for the older
  // controllers; keep reading it so behaviour does not change for any caller
  // that still relies on it.
  return req.body?.userId ? String(req.body.userId) : null;
}

function createGetEnrolledCoursesController({
  Course,
  EnrolledCourse,
  logger = console,
} = {}) {
  return async function getEnrolledCoursesController(req, res) {
    const CourseModel = Course || require("../schemas/courseModel");
    const EnrolledCourseModel =
      EnrolledCourse || require("../schemas/enrolledCourseModel");

    const userId = getRequestingUserId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    try {
      const { page, limit, skip } = normalizePagination(req.query || {});

      // Newest enrolment first, so the list has a stable order instead of
      // whatever the collection happens to return.
      const [enrollments, totalItems] = await Promise.all([
        EnrolledCourseModel.find({ userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        EnrolledCourseModel.countDocuments({ userId }),
      ]);

      if (enrollments.length === 0) {
        return res.status(200).send({
          success: true,
          data: [],
          pagination: buildPaginationMetadata({ page, limit, totalItems }),
        });
      }

      // One query for the whole page, instead of one per enrolment.
      const courseIds = enrollments.map((enrollment) => enrollment.courseId);
      const courses = await CourseModel.find({ _id: { $in: courseIds } }).lean();

      const coursesById = new Map(
        courses.map((course) => [String(course._id), course]),
      );

      const data = [];

      for (const enrollment of enrollments) {
        const course = coursesById.get(String(enrollment.courseId));

        // A teacher can delete a course without the enrolment rows being
        // touched. Those enrolments used to come back as `null` and crash the
        // client; drop them instead.
        if (!course) {
          continue;
        }

        data.push({
          ...course,
          enrollmentId: enrollment._id,
          enrolledAt: enrollment.createdAt,
          courseLength: enrollment.course_Length,
          certificateDate: enrollment.certificateDate || null,
          progress: buildProgressSummary(enrollment),
        });
      }

      return res.status(200).send({
        success: true,
        data,
        pagination: buildPaginationMetadata({ page, limit, totalItems }),
      });
    } catch (error) {
      logger.error("Error fetching enrolled courses", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).send({
        success: false,
        message: "Failed to fetch enrolled courses",
      });
    }
  };
}

const getEnrolledCoursesController = (req, res) =>
  createGetEnrolledCoursesController()(req, res);

module.exports = {
  buildProgressSummary,
  countCompletedSections,
  createGetEnrolledCoursesController,
  getEnrolledCoursesController,
  getRequestingUserId,
};
