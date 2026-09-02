const bcrypt = require("bcryptjs");

const userSchema = require("../schemas/userModel");
const { ACTIONS, recordActivity } = require("../utils/activityLog");
const {
  formatAccountMessage,
  toAccountView,
  validatePasswordChange,
  validateProfileUpdate,
} = require("../utils/accountUpdates");

// The account a signed-in user owns (#126).
//
// Until now there was no route that read or wrote it. Changing a password meant
// signing out and completing the emailed reset flow — swapping "I am holding a
// valid session for this account" for "I can read this mailbox", which is a
// weaker claim, and one that also marks the address verified and discards any
// pending OTP as a side effect:
//
//   $set: { password: hashedPassword, isVerified: true },
//   $unset: { resetToken: "", ..., otp: "", otpExpiry: "", otpAttempts: "" },
//
// Correct for a reset. Not something a routine password rotation should do.

/**
 * The signed-in account, from the middleware rather than the body.
 *
 * @param {object} req
 * @returns {string|null}
 */
function getAccountId(req) {
  const user = req.user || {};
  const fromMiddleware = user._id || user.id;

  return fromMiddleware ? String(fromMiddleware) : null;
}

// The configured admin has no `users` row. It is a credential pair in the
// environment, and `authMiddleware` recognises the reserved id without a
// lookup:
//
//   if (decode.id === "admin") {
//     req.user = { _id: "admin", id: "admin", role: "admin", type: "admin" };
//
// Every route below would otherwise hand "admin" to `findById`, which casts it
// to an ObjectId and throws.
const ADMIN_ID = "admin";

const isAdminId = (id) => String(id ?? "") === ADMIN_ID;

/**
 * There is nothing here for the admin to edit: the credentials live in
 * ADMIN_USERNAME and ADMIN_PASSWORD_HASH, and changing them means changing the
 * environment.
 */
const ADMIN_MESSAGE =
  "The administrator account is configured on the server and cannot be edited here.";

function createAccountControllers({
  User = userSchema,
  compare = bcrypt.compare,
  hash = bcrypt.hash,
  logActivity = recordActivity,
  logger = console,
} = {}) {
  /**
   * GET /api/user/account
   *
   * There was no way for anyone to see what the application stores about them.
   */
  async function getAccountController(req, res) {
    const userId = getAccountId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    if (isAdminId(userId)) {
      // Answer with what the middleware already knows rather than 404ing on a
      // row that does not exist.
      return res.status(200).send({
        success: true,
        data: { ...req.user, editable: false },
      });
    }

    try {
      const user = await User.findById(userId).lean();

      if (!user) {
        return res
          .status(404)
          .send({ success: false, message: "Account not found" });
      }

      return res
        .status(200)
        .send({ success: true, data: { ...toAccountView(user), editable: true } });
    } catch (error) {
      logger.error("Failed to read the account", {
        message: error instanceof Error ? error.message : String(error),
      });

      return res
        .status(500)
        .send({ success: false, message: "Failed to load your account" });
    }
  }

  /**
   * PUT /api/user/account
   *
   * `name` only. The address is the account's identity — unique-indexed since
   * #72 — and moving it has to be proved against the new mailbox first, which
   * is a flow of its own rather than a text input. `type` is the field #55
   * stopped clients writing.
   */
  async function updateAccountController(req, res) {
    const userId = getAccountId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    if (isAdminId(userId)) {
      return res.status(403).send({ success: false, message: ADMIN_MESSAGE });
    }

    const { valid, errors, value } = validateProfileUpdate(req.body);

    if (!valid) {
      return res.status(400).send({
        success: false,
        message: formatAccountMessage(errors),
        errors,
      });
    }

    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { name: value.name } },
        { new: true, runValidators: true },
      ).lean();

      if (!user) {
        return res
          .status(404)
          .send({ success: false, message: "Account not found" });
      }

      await logActivity({
        action: ACTIONS.PROFILE_UPDATED,
        req,
        userId: user._id,
        role: user.type,
        email: user.email,
      });

      return res.status(200).send({
        success: true,
        message: "Your details were updated.",
        // Returned so the client can replace the stored session user instead of
        // rendering a stale name until the next sign-in.
        data: { ...toAccountView(user), editable: true },
      });
    } catch (error) {
      logger.error("Failed to update the account", {
        message: error instanceof Error ? error.message : String(error),
      });

      return res
        .status(500)
        .send({ success: false, message: "Failed to update your details" });
    }
  }

  /**
   * POST /api/user/change-password
   *
   * Requires the current password. That requirement is the whole point:
   * possession of an unattended tab must not be enough to lock the owner out.
   */
  async function changePasswordController(req, res) {
    const userId = getAccountId(req);

    if (!userId) {
      return res.status(401).send({
        success: false,
        message: "Authenticated user is required",
      });
    }

    if (isAdminId(userId)) {
      return res.status(403).send({ success: false, message: ADMIN_MESSAGE });
    }

    const { valid, errors, value } = validatePasswordChange(req.body);

    if (!valid) {
      return res.status(400).send({
        success: false,
        message: formatAccountMessage(errors),
        errors,
      });
    }

    try {
      // `password` is select: false on the schema.
      const user = await User.findById(userId).select("+password");

      if (!user) {
        return res
          .status(404)
          .send({ success: false, message: "Account not found" });
      }

      const matches = await compare(value.currentPassword, user.password);

      if (!matches) {
        // Recorded. A run of these against a signed-in account is exactly the
        // kind of thing an audit log exists to show, and it is the same reason
        // #87 added login_failed.
        await logActivity({
          action: ACTIONS.PASSWORD_CHANGE_FAILED,
          req,
          userId: user._id,
          role: user.type,
          email: user.email,
        });

        return res.status(400).send({
          success: false,
          message: "Your current password is not correct",
          errors: { currentPassword: "Your current password is not correct" },
        });
      }

      const hashed = await hash(value.newPassword, 10);

      await User.updateOne(
        { _id: user._id },
        {
          $set: { password: hashed },
          // A password change ends any credential that was in flight for this
          // account. A reset code somebody else requested must not still work
          // afterwards.
          $unset: {
            resetToken: "",
            resetTokenExpiry: "",
            resetTokenAttempts: "",
          },
        },
      );

      // Deliberately does not touch isVerified or the OTP fields. The reset
      // flow sets isVerified because holding the emailed code proves the
      // mailbox; this route proves nothing about the mailbox, so it must not
      // claim to, and an unverified account stays unverified with its pending
      // code intact.

      await logActivity({
        action: ACTIONS.PASSWORD_CHANGED,
        req,
        userId: user._id,
        role: user.type,
        email: user.email,
      });

      return res.status(200).send({
        success: true,
        // Said plainly, because it is true: the token is stateless and there is
        // no server-side session to revoke. Anything else would be a promise
        // the application cannot keep.
        message:
          "Your password was changed. Sessions already signed in elsewhere stay signed in until their token expires.",
      });
    } catch (error) {
      logger.error("Failed to change the password", {
        message: error instanceof Error ? error.message : String(error),
      });

      return res
        .status(500)
        .send({ success: false, message: "Failed to change your password" });
    }
  }

  return {
    changePasswordController,
    getAccountController,
    updateAccountController,
  };
}

const controllers = createAccountControllers();

module.exports = {
  createAccountControllers,
  getAccountId,
  changePasswordController: (req, res) =>
    controllers.changePasswordController(req, res),
  getAccountController: (req, res) => controllers.getAccountController(req, res),
  updateAccountController: (req, res) =>
    controllers.updateAccountController(req, res),
};
