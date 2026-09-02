const mongoose = require("mongoose");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");
const {
  buildProgressSummary,
  completedSectionIds,
} = require("../utils/courseProgress");

function normalizeSectionId(sections, sectionId) {
  const normalizedSections = Array.isArray(sections) ? sections : [];

  if (
    typeof sectionId === "number" ||
    (typeof sectionId === "string" && /^\d+$/.test(sectionId.trim()))
  ) {
    const sectionIndex = Number(sectionId);

    if (
      Number.isSafeInteger(sectionIndex) &&
      sectionIndex >= 0 &&
      sectionIndex < normalizedSections.length
    ) {
      return sectionIndex;
    }
  }

  if (typeof sectionId === "string" && sectionId.trim()) {
    const requestedId = sectionId.trim();
    const matchingSection = normalizedSections.find((section) => {
      if (!section || typeof section !== "object") return false;

      const candidateId = section._id || section.id;
      return candidateId && String(candidateId) === requestedId;
    });

    if (matchingSection) {
      return requestedId;
    }
  }

  return null;
}

/**
 * The progress array as it stands after this request, given the array that was
 * read and the id `$addToSet` has just written (or null when it wrote nothing).
 *
 * @param {unknown} progress
 * @param {string|number|null} addedSectionId
 * @returns {Array<{sectionId: string|number}>}
 */
function projectProgress(progress, addedSectionId) {
  const entries = Array.isArray(progress) ? [...progress] : [];

  if (addedSectionId === null || addedSectionId === undefined) {
    return entries;
  }

  const existing = completedSectionIds(entries);

  if (!existing.has(String(addedSectionId))) {
    entries.push({ sectionId: addedSectionId });
  }

  return entries;
}

// Injectable clock, so a test can assert the stamped date without racing it.
let now = () => new Date();

function setClock(clock) {
  now = typeof clock === "function" ? clock : () => new Date();
}

function getAuthenticatedUserId(req) {
  return req.user?._id || req.user?.id || req.body?.userId || null;
}

function createCompleteSectionController({
  CourseModel = courseSchema,
  EnrolledCourseModel = enrolledCourseSchema,
} = {}) {
  return async function completeSectionController(req, res) {
    const { courseId, sectionId } = req.body || {};
    const userId = getAuthenticatedUserId(req);

    if (!courseId || sectionId === undefined || sectionId === null) {
      return res.status(400).send({
        success: false,
        message: "courseId and sectionId are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid courseId",
      });
    }

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    try {
      const course = await CourseModel.findById(courseId);

      if (!course) {
        return res.status(404).send({
          success: false,
          message: "Course not found",
        });
      }

      const normalizedSectionId = normalizeSectionId(
        course.sections,
        sectionId,
      );

      if (normalizedSectionId === null) {
        return res.status(404).send({
          success: false,
          message: "Section not found in this course",
        });
      }

      const enrollment = await EnrolledCourseModel.findOne({
        courseId,
        userId,
      });

      if (!enrollment) {
        return res.status(403).send({
          success: false,
          message: "User is not enrolled in this course",
        });
      }

      const updateResult = await EnrolledCourseModel.updateOne(
        {
          _id: enrollment._id,
          "progress.sectionId": { $ne: normalizedSectionId },
        },
        {
          $addToSet: {
            progress: { sectionId: normalizedSectionId },
          },
        },
      );

      const alreadyCompleted = updateResult.modifiedCount === 0;

      // The stored progress plus the id this call just added, without a second
      // read. `$addToSet` is a no-op when the id was already there, and so is
      // adding it to the set here.
      const progressAfter = projectProgress(
        enrollment.progress,
        alreadyCompleted ? null : normalizedSectionId,
      );

      const progress = buildProgressSummary({
        course_Length: enrollment.course_Length,
        progress: progressAfter,
      });

      // The certificate is dated the moment the last section is completed, and
      // only then. The player used to read `enrollment.updatedAt` — Mongoose's
      // last-write timestamp, which moves every time progress is added and
      // again when enrollmentController corrects course_Length after a course
      // is edited. `certificateDate` has been declared on the schema since the
      // model was written and nothing ever wrote it (#93).
      let certificateDate = enrollment.certificateDate || null;
      const isComplete = progress.total > 0 && progress.completed >= progress.total;

      if (isComplete && !certificateDate) {
        certificateDate = now();

        // Guarded on the field still being unset, so two requests completing
        // the last section at once cannot overwrite each other's date.
        await EnrolledCourseModel.updateOne(
          {
            _id: enrollment._id,
            $or: [
              { certificateDate: { $exists: false } },
              { certificateDate: null },
            ],
          },
          { $set: { certificateDate } },
        );
      }

      return res.status(200).send({
        success: true,
        alreadyCompleted,
        message: alreadyCompleted
          ? "Section was already completed"
          : "Section completed successfully",
        // Returned so the player can advance without re-fetching the course,
        // and so it stops deciding completion for itself.
        progress,
        isComplete,
        certificateDate,
      });
    } catch (error) {
      console.error("Error completing section:", error);
      return res.status(500).send({
        success: false,
        message: "Internal server error",
      });
    }
  };
}

const completeSectionController = createCompleteSectionController();

module.exports = {
  completeSectionController,
  createCompleteSectionController,
  getAuthenticatedUserId,
  normalizeSectionId,
  projectProgress,
  setClock,
};
