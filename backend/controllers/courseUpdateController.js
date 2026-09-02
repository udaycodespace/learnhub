const { formatCourseMessage } = require("../utils/courseInput");
const {
  toEditableCourse,
  validateCourseEdit,
} = require("../utils/courseEdit");

// GET  /api/user/editcourse/:courseid — the course, as an edit form needs it
// PUT  /api/user/editcourse/:courseid — the change
//
// #127. Neither existed. A course could be created and deleted and nothing
// else, so correcting a typo meant deleting it — and that cascade takes every
// enrolment, payment, review, bookmark and uploaded video with it.
//
// Ownership is decided exactly the way `courseDeletionController` decides it:
// a teacher may act on a course they own, an admin on any course. Written out
// here rather than shared, because the two answer differently on one point —
// deletion needs the document first, to collect filenames, and this needs it
// to know how many sections there are.

function getAuthenticatedIdentity(req) {
  const user = req.user || {};

  return {
    role: String(user.role || user.type || "").toLowerCase(),
    userId: String(user._id || user.id || ""),
    name: typeof user.name === "string" ? user.name.trim() : "",
  };
}

/**
 * Whether this caller may edit this course.
 *
 * @param {object} course
 * @param {{ role: string, userId: string }} identity
 * @returns {boolean}
 */
function canEditCourse(course, { role, userId }) {
  if (!userId) return false;
  if (role === "admin") return true;
  if (role !== "teacher") return false;

  return String(course.userId || "") === userId;
}

function createCourseUpdateControllers({
  Course,
  isValidObjectId,
  logger = console,
} = {}) {
  const resolve = () => ({
    CourseModel: Course || require("../schemas/courseModel"),
    validateObjectId: isValidObjectId || require("mongoose").isValidObjectId,
  });

  /**
   * Reads the editable shape of a course.
   *
   * The educator's list endpoint deliberately does not carry section text
   * (#94 projected it away along with the stored file paths), so an edit form
   * has nowhere else to get the section titles it is about to let somebody
   * change.
   */
  async function getCourseForEditController(req, res) {
    const { CourseModel, validateObjectId } = resolve();
    const { courseid } = req.params || {};
    const identity = getAuthenticatedIdentity(req);

    if (!validateObjectId(courseid)) {
      return res
        .status(400)
        .send({ success: false, message: "Invalid course ID" });
    }

    if (!identity.userId || !["teacher", "admin"].includes(identity.role)) {
      return res
        .status(403)
        .send({ success: false, message: "Forbidden: Access denied" });
    }

    try {
      const course = await CourseModel.findById(courseid).lean();

      if (!course) {
        return res
          .status(404)
          .send({ success: false, message: "Course not found" });
      }

      if (!canEditCourse(course, identity)) {
        return res.status(403).send({
          success: false,
          message: "You can only edit courses you own",
        });
      }

      return res
        .status(200)
        .send({ success: true, data: toEditableCourse(course) });
    } catch (error) {
      logger.error("Error reading a course for editing", {
        courseId: courseid,
        message: error instanceof Error ? error.message : String(error),
      });

      return res
        .status(500)
        .send({ success: false, message: "Failed to load the course" });
    }
  }

  async function updateCourseController(req, res) {
    const { CourseModel, validateObjectId } = resolve();
    const { courseid } = req.params || {};
    const identity = getAuthenticatedIdentity(req);

    if (!validateObjectId(courseid)) {
      return res
        .status(400)
        .send({ success: false, message: "Invalid course ID" });
    }

    if (!identity.userId || !["teacher", "admin"].includes(identity.role)) {
      return res
        .status(403)
        .send({ success: false, message: "Forbidden: Access denied" });
    }

    try {
      const course = await CourseModel.findById(courseid).lean();

      if (!course) {
        return res
          .status(404)
          .send({ success: false, message: "Course not found" });
      }

      if (!canEditCourse(course, identity)) {
        return res.status(403).send({
          success: false,
          message: "You can only edit courses you own",
        });
      }

      // The stored sections are needed before the body is read: the section
      // count is fixed by the uploads, and the submitted text is matched to
      // them by position.
      const { valid, errors, changes, empty } = validateCourseEdit({
        body: req.body || {},
        course,
      });

      if (!valid) {
        return res.status(400).send({
          success: false,
          message: formatCourseMessage(errors),
          errors,
          // A body carrying nothing editable is a different mistake from a
          // body carrying something invalid, and a client that pre-fills a
          // form should be told which one it made.
          ...(empty ? { empty: true } : {}),
        });
      }

      // The owner's display name, re-read from the token on every edit by the
      // owner. `C_educator` is written once at creation from the same source
      // (#83), so a teacher who later corrects their name left a stale byline
      // on every course they had already published. An admin editing somebody
      // else's course is not the educator, so their name is not written.
      if (identity.role === "teacher" && identity.name) {
        changes.C_educator = identity.name;
      }

      const updated = await CourseModel.findOneAndUpdate(
        { _id: courseid },
        { $set: changes },
        { new: true, runValidators: true },
      ).lean();

      if (!updated) {
        return res
          .status(404)
          .send({ success: false, message: "Course not found" });
      }

      return res.status(200).send({
        success: true,
        message: "Course updated successfully",
        data: toEditableCourse(updated),
        // Named so a client can say what it changed, and so a reviewer reading
        // a log can see that an edit never touches sections' S_content,
        // userId, or enrolled.
        changed: Object.keys(changes),
      });
    } catch (error) {
      logger.error("Error updating course", {
        courseId: courseid,
        message: error instanceof Error ? error.message : String(error),
      });

      return res
        .status(500)
        .send({ success: false, message: "Failed to update the course" });
    }
  }

  return { getCourseForEditController, updateCourseController };
}

const controllers = createCourseUpdateControllers();

module.exports = {
  canEditCourse,
  createCourseUpdateControllers,
  getAuthenticatedIdentity,
  getCourseForEditController: (req, res) =>
    controllers.getCourseForEditController(req, res),
  updateCourseController: (req, res) =>
    controllers.updateCourseController(req, res),
};
