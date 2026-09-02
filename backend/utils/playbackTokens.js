const jwt = require("jsonwebtoken");

// A `<video>` element sets its own src, so ReactPlayer cannot attach an
// Authorization header to the request for the file. A guarded stream route
// therefore needs a credential it can carry in the URL.
//
// Putting the session JWT there would be the obvious shortcut and the wrong
// one: URLs land in browser history, in Referer headers, and in every access
// log between the client and the server, and that token is good for a day
// against every endpoint in the app. This is a separate token that is good for
// half an hour, for one course, for reading video only.

const PLAYBACK_SCOPE = "course-video";
const PLAYBACK_TTL_SECONDS = 30 * 60;

/**
 * Mints a token for one viewer and one course.
 *
 * Only called after the caller's enrolment (or ownership) has already been
 * checked, by /api/user/coursecontent/:courseid.
 *
 * @param {object} claims
 * @param {string} claims.userId
 * @param {string} claims.courseId
 * @param {string} [secret]
 * @returns {string}
 */
function signPlaybackToken({ userId, courseId }, secret = process.env.JWT_SECRET) {
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    {
      sub: String(userId),
      courseId: String(courseId),
      scope: PLAYBACK_SCOPE,
    },
    secret,
    { expiresIn: PLAYBACK_TTL_SECONDS },
  );
}

/**
 * Mints a token and says when it stops working.
 *
 * The client used to receive the token alone, so the only way it could learn
 * the expiry was to decode a credential it has no business parsing — and it
 * did not, which is why playback died silently half an hour into a course
 * (#124). Stating the deadline is what lets the page renew the token before it
 * lapses instead of after.
 *
 * `expiresAt` is epoch milliseconds so `new Date(expiresAt)` works in the
 * browser without a conversion step.
 *
 * @param {object} claims
 * @param {string} claims.userId
 * @param {string} claims.courseId
 * @param {object} [options]
 * @param {number} [options.now] injectable clock, in ms, for tests
 * @param {string} [options.secret]
 * @returns {{ token: string, expiresAt: number, expiresInSeconds: number }}
 */
function issuePlaybackToken(
  { userId, courseId },
  { now = Date.now(), secret = process.env.JWT_SECRET } = {},
) {
  const token = signPlaybackToken({ userId, courseId }, secret);

  return {
    token,
    expiresAt: now + PLAYBACK_TTL_SECONDS * 1000,
    expiresInSeconds: PLAYBACK_TTL_SECONDS,
  };
}

/**
 * Reads a playback token.
 *
 * The scope check is the important line. Without it any session JWT signed with
 * the same secret would satisfy this route, and the whole point is that a
 * playback URL is not a session.
 *
 * @param {string} token
 * @param {string} [secret]
 * @returns {{ userId: string, courseId: string }|null} null if unusable
 */
function verifyPlaybackToken(token, secret = process.env.JWT_SECRET) {
  if (!token || typeof token !== "string" || !secret) return null;

  try {
    const payload = jwt.verify(token, secret);

    if (!payload || payload.scope !== PLAYBACK_SCOPE) return null;
    if (!payload.sub || !payload.courseId) return null;

    return {
      userId: String(payload.sub),
      courseId: String(payload.courseId),
    };
  } catch {
    // Expired, tampered with, or signed with something else. All the same
    // answer: the caller does not get the file.
    return null;
  }
}

/**
 * Confirms that a token was minted for the course being requested.
 *
 * A token for a free course must not open a paid one.
 *
 * @param {{ courseId: string }|null} claims
 * @param {string} courseId
 * @returns {boolean}
 */
function tokenCoversCourse(claims, courseId) {
  return Boolean(claims) && claims.courseId === String(courseId);
}

module.exports = {
  PLAYBACK_SCOPE,
  PLAYBACK_TTL_SECONDS,
  issuePlaybackToken,
  signPlaybackToken,
  tokenCoversCourse,
  verifyPlaybackToken,
};
