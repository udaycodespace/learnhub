// Writing to the activity log.
//
// Three rules, none of which the two inline `ActivityLog.create(...)` calls
// followed:
//
//   1. Never fail the request. A login that succeeded must not turn into a 500
//      because an audit row could not be written. Both existing call sites were
//      awaited bare inside the controller's try block, so a write error was
//      reported to the user as a failed login.
//   2. Always carry the request context. `ipAddress` and `userAgent` are
//      declared, selected, rendered and searched, and were never written.
//   3. Store the role the way the schema stores everything else. The admin
//      login wrote `role: "Admin"` while `userModel` lowercases every other
//      role, so the collection held both spellings.

const { getRequestContext } = require("./requestContext");

const ACTIONS = Object.freeze({
  LOGIN: "login",
  LOGOUT: "logout",
  LOGIN_FAILED: "login_failed",
  // #126. An account can be edited by its owner now, and the log is the only
  // place that can answer "was this account's password changed, and from
  // where" — the successor to the question #87 added login_failed for.
  // password_change_failed is the one that matters most: a run of them against
  // a signed-in account is somebody working on a session they should not have.
  PASSWORD_CHANGED: "password_changed",
  PASSWORD_CHANGE_FAILED: "password_change_failed",
  PROFILE_UPDATED: "profile_updated",
});

const normalizeRole = (role) =>
  typeof role === "string" ? role.trim().toLowerCase() : undefined;

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : undefined;

/**
 * Records one authentication event. Best effort by design.
 *
 * @param {object} options
 * @param {string} options.action one of ACTIONS
 * @param {object} [options.req] the request, for IP and User-Agent
 * @param {string|object} [options.userId] absent for a failed login or the admin
 * @param {string} [options.role]
 * @param {string} [options.email]
 * @param {object} [options.ActivityLog] injectable model, for tests
 * @param {object} [options.logger]
 * @returns {Promise<object|null>} the created document, or null if it could not
 *   be written
 */
async function recordActivity({
  action,
  req,
  userId,
  role,
  email,
  ActivityLog,
  logger = console,
} = {}) {
  const Model = ActivityLog || require("../schemas/activityLogModel");

  try {
    const context = req ? getRequestContext(req) : {};

    return await Model.create({
      ...(userId ? { userId } : {}),
      action,
      role: normalizeRole(role),
      email: normalizeEmail(email),
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });
  } catch (error) {
    // Deliberately swallowed. An unwritable audit row is worth a server-side
    // warning, not a failed sign-in.
    logger.warn("Could not write an activity log entry", {
      action,
      message: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

module.exports = {
  ACTIONS,
  recordActivity,
};
