const crypto = require("crypto");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const userSchema = require("../schemas/userModel");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");
const coursePaymentSchema = require("../schemas/coursePaymentModel");
const { ACTIONS, recordActivity } = require("../utils/activityLog");
const { removeUserDependents } = require("../utils/cascadeDelete");
const { buildAdminAccount } = require("../utils/adminAccount");
const { countSections } = require("../utils/courseSections");
const {
  buildCourseFilter,
  buildCourseSort,
} = require("../utils/courseListing");
const {
  ADMIN_COURSE_FIELDS,
  buildUserFilter,
  buildUserSort,
  toAdminCourseRow,
  toAdminEnrollmentRow,
} = require("../utils/adminListing");
const {
  buildPaginationMetadata,
  normalizePagination,
} = require("../utils/pagination");

// Fields that must never leave the server. password is a bcrypt hash, and otp
// and resetToken are live credentials: anything holding them can complete
// /verify-otp or /reset-password for that account.
const SENSITIVE_USER_FIELDS = [
  "password",
  "otp",
  "otpExpiry",
  "otpAttempts",
  "resetToken",
  "resetTokenExpiry",
  "resetTokenAttempts",
];

const PUBLIC_USER_PROJECTION = SENSITIVE_USER_FIELDS.map(
  (field) => `-${field}`,
).join(" ");

/**
 * Compares two strings without leaking length or content through timing.
 */
const safeEquals = (left, right) => {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
};

/**
 * Resolves the configured admin credentials.
 *
 * ADMIN_PASSWORD_HASH is preferred. ADMIN_PASSWORD is accepted so an existing
 * local setup keeps working, but it is only usable outside production.
 */
const getAdminCredentials = () => {
  const username = process.env.ADMIN_USERNAME;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const plaintextPassword = process.env.ADMIN_PASSWORD;

  if (!username || (!passwordHash && !plaintextPassword)) {
    return null;
  }

  if (!passwordHash && process.env.NODE_ENV === "production") {
    return null;
  }

  return { username, passwordHash, plaintextPassword };
};

const verifyAdminPassword = async (credentials, candidate) => {
  if (credentials.passwordHash) {
    return bcrypt.compare(String(candidate ?? ""), credentials.passwordHash);
  }

  return safeEquals(candidate, credentials.plaintextPassword);
};

const adminLoginController = async (req, res) => {
  try {
    const { username, password } = req.body || {};

    // Signing with an undefined secret throws inside this async handler, and
    // Express 4 does not forward the rejection, so the request used to hang.
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured; admin login is disabled.");
      return res.status(500).send({
        success: false,
        message: "Authentication is not configured on this server",
      });
    }

    const credentials = getAdminCredentials();

    if (!credentials) {
      console.error(
        "Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH.",
      );
      return res.status(500).send({
        success: false,
        message: "Admin access is not configured on this server",
      });
    }

    const usernameMatches = safeEquals(username, credentials.username);
    const passwordMatches = await verifyAdminPassword(credentials, password);

    if (!usernameMatches || !passwordMatches) {
      await recordActivity({
        action: ACTIONS.LOGIN_FAILED,
        req,
        role: "admin",
        email: typeof username === "string" ? username : "",
      });

      return res
        .status(401)
        .send({ success: false, message: "Invalid admin credentials" });
    }

    // Signed with JWT_SECRET so authMiddleware, which verifies with the same
    // variable, can actually accept the token.
    const token = jwt.sign({ id: "admin", role: "admin" }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    // Was `role: "Admin"` while userModel lowercases every other role, so the
    // collection held both spellings of the same value. recordActivity
    // normalises it, and carries the IP and User-Agent that were never stored.
    await recordActivity({
      action: ACTIONS.LOGIN,
      req,
      role: "admin",
      email: credentials.username,
    });

    // #125. The token used to travel alone. The browser's session layer needs
    // an account beside it — `parseStoredUser` requires an object with an id,
    // and `getUserRole` reads `type` — so a caller holding only a token could
    // not produce a signed-in session at all, and the four admin screens were
    // unreachable. This is the same shape `POST /api/user/login` returns under
    // `userData`, built from the object `authMiddleware` recognises.
    return res.status(200).send({
      success: true,
      token,
      userData: buildAdminAccount(credentials.username),
      message: "Admin login successful",
    });
  } catch (error) {
    console.error("Admin login failed:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Admin login failed" });
  }
};

// Admin reset user password
const adminResetPasswordController = async (req, res) => {
  const { userid } = req.params;
  const { newPassword } = req.body || {};

  if (!newPassword || newPassword.length < 6) {
    return res
      .status(400)
      .send({ success: false, message: "Password must be at least 6 characters." });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    const user = await userSchema.findByIdAndUpdate(userid, {
      password: hashed,
      $unset: {
        resetToken: "",
        resetTokenExpiry: "",
        resetTokenAttempts: "",
      },
    });

    if (!user) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    return res
      .status(200)
      .send({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Admin password reset failed:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to reset password" });
  }
};

// Get all enrolled courses (for admin dashboard)
//
// Was an unbounded find() with two populate() calls on top. Paginated like the
// rest, and each row is shaped so a reference to a deleted user or course is
// flagged rather than rendered as two blank cells (#96).
const getAllEnrolledCoursesController = async (req, res) => {
  try {
    const { page, limit, skip } = normalizePagination(req.query || {});

    const [enrolled, totalItems] = await Promise.all([
      enrolledCourseSchema
        .find()
        .populate("userId", "name email")
        .populate("courseId", "C_title")
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      enrolledCourseSchema.countDocuments(),
    ]);

    return res.status(200).send({
      success: true,
      data: enrolled.map(toAdminEnrollmentRow),
      pagination: buildPaginationMetadata({ page, limit, totalItems }),
    });
  } catch (error) {
    console.error("Failed to fetch enrolled courses:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch enrolled courses" });
  }
};

// Get all course payments (for admin dashboard)
const getAllPaymentsController = async (req, res) => {
  try {
    const payments = await coursePaymentSchema
      .find()
      .populate("userId", "name email")
      .populate("courseId", "C_title");

    return res.status(200).send({ success: true, data: payments });
  } catch (error) {
    console.error("Failed to fetch payments:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch payments" });
  }
};

/**
 * Counts accounts per role across the whole filter, not just the page.
 *
 * The dashboard could not say how many educators or students there were
 * without loading every account and counting them in the browser, which is
 * exactly what it was doing.
 *
 * @param {object} filter
 * @returns {Promise<{total: number, student: number, teacher: number, admin: number}>}
 */
const summarizeUsersByRole = async (filter) => {
  const rows = await userSchema.aggregate([
    { $match: filter },
    { $group: { _id: "$type", count: { $sum: 1 } } },
  ]);

  const summary = { total: 0, student: 0, teacher: 0, admin: 0 };

  for (const row of rows) {
    const role = String(row._id || "").toLowerCase();

    summary.total += row.count;

    if (Object.hasOwn(summary, role)) {
      summary[role] = row.count;
    }
  }

  return summary;
};

const getAllUsersController = async (req, res) => {
  try {
    // Without an explicit projection this returned password hashes and live
    // OTP and reset tokens for every account. Without a limit it returned every
    // account, full stop — the whole collection serialised into one body on
    // every mount of the dashboard (#96).
    const { page, limit, skip } = normalizePagination(req.query || {});
    const filter = buildUserFilter(req.query || {});
    const sort = buildUserSort(req.query || {});

    const [allUsers, totalItems, roleCounts] = await Promise.all([
      userSchema
        .find(filter)
        .select(PUBLIC_USER_PROJECTION)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      userSchema.countDocuments(filter),
      summarizeUsersByRole(filter),
    ]);

    return res.status(200).send({
      success: true,
      data: allUsers,
      summary: roleCounts,
      pagination: buildPaginationMetadata({ page, limit, totalItems }),
    });
  } catch (error) {
    console.error("Failed to fetch users:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch users" });
  }
};

const getAllCoursesController = async (req, res) => {
  try {
    // The same search, filter and sort rules the public catalogue uses (#43),
    // so an admin looking for a course and a visitor looking for one get the
    // same answers rather than two implementations that drift.
    const { page, limit, skip } = normalizePagination(req.query || {});
    const filter = buildCourseFilter(req.query || {});
    const sort = buildCourseSort(req.query || {});

    const [allCourses, totalItems] = await Promise.all([
      courseSchema
        .find(filter)
        .select(ADMIN_COURSE_FIELDS)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      courseSchema.countDocuments(filter),
    ]);

    return res.status(200).send({
      success: true,
      // `sections` never reaches the client: the table renders a count, and
      // the raw field carries every section's S_content.path.
      data: allCourses.map((course) => toAdminCourseRow(course, countSections)),
      pagination: buildPaginationMetadata({ page, limit, totalItems }),
    });
  } catch (error) {
    console.error("Failed to fetch courses:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to fetch courses" });
  }
};

// DELETE /api/admin/deletecourse/:courseid is routed at courseDeletionController
// instead. That one already enforces ownership and removes the section videos,
// and it has always accepted an admin; this file held a second, weaker copy
// that skipped both.

const deleteUserController = async (req, res) => {
  const { userid } = req.params;

  try {
    const user = await userSchema.findByIdAndDelete(userid);

    if (!user) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    // Everything that referenced the account used to survive it: enrolments,
    // payments, reviews, bookmarks, activity logs, and — for a teacher — their
    // courses along with every section video on disk.
    const removed = await removeUserDependents(user._id);

    return res.status(200).send({
      success: true,
      message: "User deleted successfully",
      removed,
    });
  } catch (error) {
    console.error("Error in deleting user:", error.message);
    return res
      .status(500)
      .send({ success: false, message: "Failed to delete user" });
  }
};

module.exports = {
  getAllUsersController,
  getAllCoursesController,
  deleteUserController,
  adminLoginController,
  getAllEnrolledCoursesController,
  getAllPaymentsController,
  adminResetPasswordController,
  PUBLIC_USER_PROJECTION,
  SENSITIVE_USER_FIELDS,
  getAdminCredentials,
  safeEquals,
  summarizeUsersByRole,
};
