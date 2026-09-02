const { issuePlaybackToken } = require("../utils/playbackTokens");

// GET /api/user/playbacktoken/:courseid
//
// #124. The playback token is good for half an hour, on purpose: it rides in a
// query string, and query strings land in browser history, in Referer headers
// and in every access log between the client and the server. Widening it to a
// day to keep long courses playing would give that lifetime to a credential
// that leaks by design.
//
// The right answer is to renew it, and until now there was nothing to renew it
// with. `/coursecontent/:courseid` minted one as a side effect of returning the
// whole course, so the only way to get a fresh token was to re-fetch every
// section — and the course player asked for that exactly once, when it mounted.
// Thirty minutes later the token in its state was refused and the `<video>`
// element, which does not go through the axios interceptor, failed with nothing
// on screen.
//
// This route mints one and nothing else. The enrolment check is the same check
// `/coursecontent` makes, because it is the same claim: this viewer may watch
// this course.

/**
 * Resolves the caller from the middleware object first.
 *
 * `authMiddleware` also copies the id to `req.body.userId` for the older
 * controllers, and that copy is readable by anything that can write a body.
 * `req.user` cannot be influenced by the request.
 *
 * @param {object} req
 * @returns {string|null}
 */
function getViewerId(req) {
  const user = req.user || {};
  const fromMiddleware = user._id || user.id;

  return fromMiddleware ? String(fromMiddleware) : null;
}

/**
 * Builds the handler with injectable models, matching the pattern the rest of
 * the controllers in this directory already use.
 *
 * @param {object} [dependencies]
 */
function createPlaybackTokenController({
  EnrolledCourse,
  isValidObjectId,
  issueToken = issuePlaybackToken,
  logger = console,
} = {}) {
  return async function playbackTokenController(req, res) {
    const EnrolledCourseModel =
      EnrolledCourse || require("../schemas/enrolledCourseModel");
    const validateObjectId =
      isValidObjectId || require("mongoose").isValidObjectId;

    const { courseid } = req.params || {};
    const userId = getViewerId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    // A malformed id reaches Mongoose as a CastError and surfaces as a 500.
    if (!validateObjectId(courseid)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID",
      });
    }

    try {
      const enrollment = await EnrolledCourseModel.findOne({
        userId,
        courseId: courseid,
      })
        .select("_id")
        .lean();

      // Enrolment is the only thing that authorises playback, and it is what
      // this route exists to re-assert: a token is not renewed for somebody
      // whose enrolment went away while the page was open.
      if (!enrollment) {
        return res.status(403).send({
          success: false,
          message: "You are not enrolled in this course",
        });
      }

      const { token, expiresAt, expiresInSeconds } = issueToken({
        userId,
        courseId: courseid,
      });

      return res.status(200).send({
        success: true,
        playbackToken: token,
        playbackTokenExpiresAt: expiresAt,
        playbackTokenExpiresIn: expiresInSeconds,
      });
    } catch (error) {
      logger.error("Failed to issue a playback token", {
        courseId: courseid,
        message: error instanceof Error ? error.message : String(error),
      });

      return res.status(500).send({
        success: false,
        message: "Failed to refresh video access",
      });
    }
  };
}

const playbackTokenController = (req, res) =>
  createPlaybackTokenController()(req, res);

module.exports = {
  createPlaybackTokenController,
  getViewerId,
  playbackTokenController,
};
