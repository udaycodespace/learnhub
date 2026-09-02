const { countSections, hasReadableSections } = require("../utils/courseSections");
const {
  buildPaymentSummary,
  formatPaymentMessage,
  isFreeCourse,
} = require("../utils/paymentDetails");
const { withdrawEnrolment } = require("../utils/enrolmentWithdrawal");

const DUPLICATE_KEY_ERROR = 11000;

// The auth middleware writes the caller onto `req.user` and also copies the id
// into `req.body.userId` for the older controllers. Prefer the middleware
// object so a client cannot influence which account it enrols.
function getEnrollingUserId(req) {
  const user = req.user || {};
  const fromMiddleware = user._id || user.id;

  if (fromMiddleware) {
    return String(fromMiddleware);
  }

  return null;
}

function isDuplicateKeyError(error) {
  if (!error) return false;

  return (
    error.code === DUPLICATE_KEY_ERROR ||
    error.codeName === "DuplicateKey" ||
    (error.name === "MongoServerError" && error.code === DUPLICATE_KEY_ERROR)
  );
}

function coursePayload(course) {
  return {
    id: course._id,
    Title: course.C_title,
  };
}

/**
 * Builds the POST /api/user/enrolledcourse/:courseid handler.
 *
 * Models are injectable so the enrolment rules can be unit tested without a
 * live database, matching the pattern already used by courseDeletionController
 * and progressController.
 */
function createEnrollCourseController({
  Course,
  EnrolledCourse,
  CoursePayment,
  isValidObjectId,
  logger = console,
} = {}) {
  return async function enrollCourseController(req, res) {
    // Resolve production dependencies lazily so injected mocks win in tests.
    const CourseModel = Course || require("../schemas/courseModel");
    const EnrolledCourseModel =
      EnrolledCourse || require("../schemas/enrolledCourseModel");
    const CoursePaymentModel =
      CoursePayment || require("../schemas/coursePaymentModel");
    const validateObjectId =
      isValidObjectId || require("mongoose").isValidObjectId;

    const { courseid } = req.params || {};
    const userId = getEnrollingUserId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    // A malformed id used to reach Mongoose and surface as a 500 CastError.
    if (!validateObjectId(courseid)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID",
      });
    }

    try {
      const course = await CourseModel.findById(courseid);

      if (!course) {
        return res.status(404).send({
          success: false,
          message: "Course Not Found!",
        });
      }

      if (!hasReadableSections(course.sections)) {
        logger.error("Course has an unreadable sections field", {
          courseId: courseid,
        });

        return res.status(422).send({
          success: false,
          message: "This course is not ready for enrolment yet",
        });
      }

      // `course.sections` may be an array, an object map, or missing entirely.
      // Counting through the helper keeps course_Length a valid Number in all
      // three cases instead of throwing or storing undefined.
      const courseLength = countSections(course.sections);

      // Deliberately keyed on { userId, courseId } only. The previous filter
      // also matched course_Length, so editing a course made an existing
      // enrolment invisible and the insert below hit the unique index.
      const existingEnrollment = await EnrolledCourseModel.findOne({
        courseId: courseid,
        userId,
      });

      if (existingEnrollment) {
        // Keep the stored length in step with the course as sections are added
        // or removed, otherwise progress percentages drift over time.
        if (existingEnrollment.course_Length !== courseLength) {
          await EnrolledCourseModel.updateOne(
            { _id: existingEnrollment._id },
            { $set: { course_Length: courseLength } },
          );
        }

        return res.status(200).send({
          success: false,
          alreadyEnrolled: true,
          message: "You are already enrolled in this Course!",
          course: coursePayload(course),
        });
      }

      // Paid courses must present valid card details, and only the safe
      // summary of those details is ever persisted (#55). Validated before the
      // enrolment is written so a rejected payment leaves nothing behind.
      const requiresPayment = !isFreeCourse(course.C_price);
      let paymentSummary = null;

      if (requiresPayment) {
        const payment = buildPaymentSummary(req.body?.cardDetails || req.body);

        if (!payment.valid) {
          return res.status(400).send({
            success: false,
            message: formatPaymentMessage(payment.errors),
            errors: payment.errors,
          });
        }

        paymentSummary = payment.value;
      }

      try {
        await EnrolledCourseModel.create({
          courseId: courseid,
          userId,
          course_Length: courseLength,
        });
      } catch (error) {
        // Two parallel enrolment requests both miss the findOne above and both
        // try to insert. The unique { userId, courseId } index makes the loser
        // fail with E11000, which is the same outcome as "already enrolled"
        // rather than a server fault.
        if (isDuplicateKeyError(error)) {
          return res.status(200).send({
            success: false,
            alreadyEnrolled: true,
            message: "You are already enrolled in this Course!",
            course: coursePayload(course),
          });
        }

        throw error;
      }

      // Only recorded once the enrolment actually exists, so a failed enrolment
      // no longer leaves an orphan payment row behind.
      await CoursePaymentModel.create({
        userId,
        courseId: courseid,
        amount: requiresPayment ? String(course.C_price) : "free",
        status: "enrolled",
        ...(paymentSummary ? { cardDetails: paymentSummary } : {}),
      });

      // Atomic increment. `course.enrolled += 1; course.save()` was a
      // read-modify-write and lost updates under concurrency.
      await CourseModel.updateOne({ _id: courseid }, { $inc: { enrolled: 1 } });

      return res.status(200).send({
        success: true,
        alreadyEnrolled: false,
        message: "Enroll Successfully",
        course: coursePayload(course),
      });
    } catch (error) {
      logger.error("Error enrolling in course", {
        courseId: courseid,
        message: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).send({
        success: false,
        message: "Failed to enroll in the course",
      });
    }
  };
}

const enrollCourseController = (req, res) =>
  createEnrollCourseController()(req, res);

/**
 * Builds the DELETE /api/user/enrolledcourse/:courseid handler.
 *
 * #128. There was no counterpart to the POST above. An enrolment row was only
 * ever created, and the only deletes in the project are in the cascade — one
 * for a deleted course, one for a deleted account. A free course enrols on a
 * single click with no confirmation, because `handleEnroll` skips the payment
 * modal entirely for a free course, so a mis-click was permanent.
 *
 * Scoped to the caller's own enrolment. The course id names the course; the
 * account comes from the token, so there is no way to spell a request that
 * withdraws somebody else.
 */
function createWithdrawEnrollmentController({
  isValidObjectId,
  withdraw = withdrawEnrolment,
  logger = console,
} = {}) {
  return async function withdrawEnrollmentController(req, res) {
    const validateObjectId =
      isValidObjectId || require("mongoose").isValidObjectId;

    const { courseid } = req.params || {};
    const userId = getEnrollingUserId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    if (!validateObjectId(courseid)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID",
      });
    }

    try {
      const result = await withdraw({ userId, courseId: courseid });

      // Not enrolled, or already withdrawn in another tab. 404 rather than an
      // error: there is nothing to undo and nothing went wrong.
      if (!result.withdrawn) {
        return res.status(404).send({
          success: false,
          message: "You are not enrolled in this course",
        });
      }

      return res.status(200).send({
        success: true,
        message: "You have left the course",
        removed: {
          progress: Array.isArray(result.enrolment?.progress)
            ? result.enrolment.progress.length
            : 0,
          reviews: result.reviews,
        },
        // Marked, not deleted: a financial record must not disappear because
        // somebody changed their mind.
        payments: { markedWithdrawn: result.payments },
      });
    } catch (error) {
      logger.error("Error withdrawing from course", {
        courseId: courseid,
        message: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).send({
        success: false,
        message: "Failed to leave the course",
      });
    }
  };
}

const withdrawEnrollmentController = (req, res) =>
  createWithdrawEnrollmentController()(req, res);

module.exports = {
  createEnrollCourseController,
  createWithdrawEnrollmentController,
  enrollCourseController,
  getEnrollingUserId,
  isDuplicateKeyError,
  withdrawEnrollmentController,
};
