const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");

const userSchema = require("../schemas/userModel");
const courseSchema = require("../schemas/courseModel");
const enrolledCourseSchema = require("../schemas/enrolledCourseModel");
const { ACTIONS, recordActivity } = require("../utils/activityLog");
const {
  formatValidationMessage,
  validateRegistration,
} = require("../utils/registrationValidation");
const {
  VERIFICATION,
  burnComparison,
  issueCredential,
  verifyCredential,
} = require("../utils/otpCredentials");
const {
  buildEmailFilter,
  isDuplicateOn,
} = require("../utils/accountIdentity");
const {
  postCourseController,
} = require("./courseCreationController");
const {
  getTeacherCoursesController,
} = require("./teacherCoursesController");

// The route wiring imports this from teacherCoursesController directly. The
// aggregator keeps re-exporting it under its original name so nothing that
// still reads it from here has to change.
const getAllCoursesUserController = getTeacherCoursesController;
const {
  getAllCoursesController,
} = require("./courseListingController");
const {
  getCourseContentController,
} = require("./courseContentController");
const {
  issueVerificationOtp,
} = require("./emailVerificationController");
const {
  canResend,
  isOtpExpired,
} = require("../utils/otpCodes");

// The route wiring imports this from courseContentController directly. The
// aggregator keeps re-exporting it under its original name so nothing that
// still reads it from here has to change. The playback token and the stream
// URLs main added moved into that controller along with the handler, so the
// two imports that used to sit here now live there.
const sendCourseContentController = getCourseContentController;
//////////for registering/////////////////////////////
const registerController = async (req, res) => {
  try {
    // The document used to be built from { ...req.body }, which let a client
    // set `type` and register itself as a teacher or an admin. Only the
    // validated allow-list is used now.
    const { valid, errors, value } = validateRegistration(req.body);

    if (!valid) {
      return res.status(400).send({
        success: false,
        message: formatValidationMessage(errors),
        errors,
      });
    }

    // Normalised so a differently cased address resolves to the same row, and
    // with the OTP fields selected because an unverified registration is
    // re-issued a code below rather than being turned away.
    const existsUser = await userSchema
      .findOne(buildEmailFilter(value.email))
      .select("+otp +otpExpiry +otpLastSentAt");

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(value.password, salt);

    if (existsUser) {
      // A verified account is a real account. Nothing about it changes here.
      if (existsUser.isVerified) {
        return res
          .status(200)
          .send({ message: "User already exists", success: false });
      }

      // An unverified row is a registration that was never completed, and the
      // address is not owned by anyone yet. Answering "User already exists"
      // for it stranded the address permanently: the code had expired, there
      // was no resend, and logging in only reported that the email was not
      // verified. Treat this as the same person retrying, and take the details
      // from the new attempt — they may be retrying because they mistyped
      // something the first time.
      existsUser.name = value.name;
      existsUser.password = hashedPassword;
      existsUser.type = value.type;

      const reissued = await issueVerificationOtp({ user: existsUser });

      if (!reissued.sent) {
        return res.status(429).send({
          success: false,
          message: `A code was just sent. Please wait ${reissued.retryAfterSeconds}s before trying again.`,
          retryAfterSeconds: reissued.retryAfterSeconds,
          needsVerification: true,
        });
      }

      return res.status(200).send({
        message:
          "That address already has an unverified registration. A new OTP has been sent to it.",
        success: true,
        needsVerification: true,
      });
    }

    const newUser = new userSchema({
      name: value.name,
      email: value.email,
      password: hashedPassword,
      type: value.type,
      isVerified: false,
    });

    try {
      // Saves the document and mails the code. Kept in one helper so the
      // resend route and this path cannot drift apart on code length or
      // lifetime.
      await issueVerificationOtp({ user: newUser });
    } catch (writeError) {
      // The findOne above is a read and the write happens here, so two
      // requests for the same address both get past that check and the unique
      // index is what actually stops the second one. Answer it the same way
      // the pre-check does rather than surfacing an opaque 500. The document
      // is saved before the mail goes out, so a rejected insert sends nothing.
      if (isDuplicateOn(writeError, "email")) {
        return res
          .status(200)
          .send({ message: "User already exists", success: false });
      }

      throw writeError;
    }

    return res.status(201).send({
      message: "Registration initiated. Please verify the OTP sent to your email.",
      success: true,
      needsVerification: true,
    });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .send({ success: false, message: `${error.message}` });
  }
};

////for the login
const loginController = async (req, res) => {
  const attemptedEmail =
    typeof req.body?.email === "string" ? req.body.email : "";

  try {
    // Addresses are stored lowercase, so the lookup has to be normalised too.
    // Signing in as "User@Example.com" used to miss the row entirely and
    // report "User not found" for an account that exists.
    const emailFilter = buildEmailFilter(req.body?.email);

    // password is select: false on the schema, so ask for it explicitly.
    const user = await userSchema.findOne(emailFilter).select("+password");
    if (!user) {
      // A failed attempt used to leave no trace at all, so the log could not
      // answer the one question an audit log exists for. The attempted address
      // is recorded; the attempted password is not, and never should be.
      await recordActivity({
        action: ACTIONS.LOGIN_FAILED,
        req,
        email: attemptedEmail,
      });

      return res
        .status(200)
        .send({ message: "User not found", success: false });
    }
    const isMatch = await bcrypt.compare(req.body.password, user.password);
    if (!isMatch) {
      await recordActivity({
        action: ACTIONS.LOGIN_FAILED,
        req,
        userId: user._id,
        role: user.type,
        email: user.email,
      });

      return res
        .status(200)
        .send({ message: "Invalid email or password", success: false });
    }

    if (!user.isVerified) {
      return res
        .status(200)
        .send({ message: "Email is not verified. Please verify your email first.", success: false, notVerified: true });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });
    user.password = undefined;

    // Best effort: recordActivity swallows its own failures, so an unwritable
    // audit row can no longer turn a successful sign-in into a 500.
    await recordActivity({
      action: ACTIONS.LOGIN,
      req,
      userId: user._id,
      role: user.type,
      email: user.email,
    });

    return res.status(200).send({
      message: "Login success successfully",
      success: true,
      token,
      userData: user,
    });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .send({ success: false, message: `${error.message}` });
  }
};

/**
 * POST /api/user/logout
 *
 * The activity log has always accepted a "logout" action and the admin table
 * has always offered a Logout filter, but signing out was client-only —
 * `clearSession()` and a redirect — so the filter matched nothing, ever.
 *
 * Authenticated, because an open endpoint would let anyone write log rows for
 * any account. There is no server-side session to destroy: the token is
 * stateless and the client discards it.
 */
const logoutController = async (req, res) => {
  const user = req.user || {};

  await recordActivity({
    action: ACTIONS.LOGOUT,
    req,
    userId: user._id && user._id !== "admin" ? user._id : undefined,
    role: user.type || user.role,
    email: user.email,
  });

  return res
    .status(200)
    .send({ success: true, message: "Signed out" });
};

//get all courses
// Implemented in courseListingController for isolated query validation and tests.

////////posting course////////////
// Implemented in courseCreationController so upload cleanup is testable.

///all courses for the teacher
// Implemented in teacherCoursesController so the list is paginated and
// projected like every other list endpoint, the owner is resolved from
// req.user rather than req.body.userId, and the section count is computed
// server-side for all three shapes `sections` takes (#94).

///delete courses by the teacher
// Implemented in courseDeletionController so ownership is enforced against the
// authenticated identity and orphaned section videos are cleaned up (#40).

////enrolled course by the student
// Implemented in enrollmentController so section counting, idempotency and the
// enrolled counter can be unit tested with injected models.

/////sending the course content for learning to student
// Implemented in courseContentController so the enrolment is resolved from the
// authenticated identity, a caller who is not enrolled gets a 403 rather than
// "User not found", and the progress summary comes from the same helpers My
// Courses uses instead of being recomputed in the browser (#93). The playback
// token minted after the enrolment check (#76) moved there with it.

//////////////completing module////////
// Implemented in progressController so the section is validated against the
// course and repeated calls cannot duplicate progress entries (#39).

////////////get all courses for paricular user
// Implemented in enrolledCoursesController so the batched lookup, the
// deleted-course filtering and the progress summary are unit testable.

// One answer for every way verification can fail: no such address, no pending
// code, the wrong code, an expired code, too many attempts. Distinguishing them
// is what let an unauthenticated caller confirm or deny any email address in a
// single request — forgotPasswordController in this same file already answers
// uniformly, and these two did not (#95).
const OTP_FAILURE_MESSAGE = "Invalid or expired OTP";
const RESET_FAILURE_MESSAGE = "Invalid or expired reset token/OTP";

/**
 * Clears a credential and its attempt counter.
 *
 * Used on every terminal outcome — spent, expired, or locked out — so a code
 * cannot be worked on after it has stopped being usable.
 */
const clearCredential = async (user, prefix) => {
  await userSchema.updateOne(
    { _id: user._id },
    {
      $unset: {
        [prefix]: "",
        [`${prefix}Expiry`]: "",
        [`${prefix}Attempts`]: "",
      },
    },
  );
};

const verifyOtpController = async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).send({ message: "Email and OTP are required", success: false });
    }

    const user = await userSchema
      .findOne(buildEmailFilter(email))
      .select("+otp +otpExpiry +otpAttempts +otpLastSentAt");


    if (!user) {
      // Same status, same message, and one bcrypt comparison's worth of time —
      // otherwise the absence of a comparison is the new oracle.
      await burnComparison();

      // Byte-identical to the failure below, `canResend` included. A field
      // present for a real address and absent for an unknown one would be the
      // oracle the uniform message exists to remove.
      return res.status(400).send({
        message: OTP_FAILURE_MESSAGE,
        success: false,
        canResend: true,
      });
    }

    if (user.isVerified) {
      // Verified accounts should not be carrying a live code around.
      if (user.otp) {
        await clearCredential(user, "otp");
      }

      return res.status(200).send({ message: "User already verified", success: true });
    }

    const result = await verifyCredential(
      { hash: user.otp, expiresAt: user.otpExpiry, attempts: user.otpAttempts },
      otp,
    );

    if (result.status !== VERIFICATION.OK) {
      if (result.shouldClear) {
        await clearCredential(user, "otp");
      } else {
        await userSchema.updateOne(
          { _id: user._id },
          { $set: { otpAttempts: result.attempts } },
        );
      }

      // `canResend` keeps the "send a new code" button on screen (#73), and is
      // deliberately constant rather than derived from user.otpLastSentAt.
      //
      // Deriving it would put the enumeration oracle straight back: an unknown
      // address has no send time, so it would answer differently from a real
      // one on cooldown, and this response is uniform on purpose (#95). The
      // cooldown is still enforced and still reported — by /resend-otp, which
      // owns it and answers 429 with the exact wait. VerifyEmailPanel already
      // reads `retryAfterSeconds` off that response.
      return res.status(400).send({
        message: OTP_FAILURE_MESSAGE,
        success: false,
        canResend: true,
      });
    }

    await userSchema.updateOne(
      { _id: user._id },
      {
        $set: { isVerified: true },
        $unset: { otp: "", otpExpiry: "", otpAttempts: "", otpLastSentAt: "" },
      },
    );

    return res.status(200).send({ message: "Email verified successfully", success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ success: false, message: "Unable to verify the code" });
  }
};

const forgotPasswordController = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).send({ message: "Email is required", success: false });
    }
    const user = await userSchema.findOne(buildEmailFilter(email));
    if (!user) {
      return res.status(200).send({ message: "If that email exists, an OTP/reset token has been sent.", success: true });
    }
    
    // Issuing a new code supersedes any previous one, and resets the attempt
    // counter with it — otherwise a locked-out account could never recover.
    const credential = await issueCredential();

    await userSchema.updateOne(
      { _id: user._id },
      {
        $set: {
          resetToken: credential.hash,
          resetTokenExpiry: credential.expiresAt,
          resetTokenAttempts: 0,
        },
      },
    );

    await sendEmail({
      to: email,
      subject: "LearnHub Password Reset Request",
      text: `Your password reset code is: ${credential.code}. This code is valid for 10 minutes.`,
      html: `<p>Your password reset code is: <strong>${credential.code}</strong>.</p><p>This code is valid for 10 minutes.</p>`,
    });

    return res.status(200).send({ message: "If that email exists, an OTP/reset token has been sent.", success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

const resetPasswordController = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) {
      return res.status(400).send({ message: "Email, token, and newPassword are required", success: false });
    }
    if (newPassword.length < 6) {
      return res.status(400).send({ message: "Password must be at least 6 characters.", success: false });
    }
    const user = await userSchema
      .findOne(buildEmailFilter(email))
      .select("+resetToken +resetTokenExpiry +resetTokenAttempts");

    if (!user) {
      // 404 "User not found" here confirmed the address to anyone who asked.
      await burnComparison();

      return res
        .status(400)
        .send({ message: RESET_FAILURE_MESSAGE, success: false });
    }

    const result = await verifyCredential(
      {
        hash: user.resetToken,
        expiresAt: user.resetTokenExpiry,
        attempts: user.resetTokenAttempts,
      },
      token,
    );

    if (result.status !== VERIFICATION.OK) {
      if (result.shouldClear) {
        await clearCredential(user, "resetToken");
      } else {
        await userSchema.updateOne(
          { _id: user._id },
          { $set: { resetTokenAttempts: result.attempts } },
        );
      }

      return res
        .status(400)
        .send({ message: RESET_FAILURE_MESSAGE, success: false });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Holding the code proves control of the mailbox, so the address is marked
    // verified here. This was already the behaviour; it is stated now rather
    // than left as an unexplained side effect.
    await userSchema.updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword, isVerified: true },
        $unset: {
          resetToken: "",
          resetTokenExpiry: "",
          resetTokenAttempts: "",
          // A password change ends any pending verification code too.
          otp: "",
          otpExpiry: "",
          otpAttempts: "",
        },
      },
    );

    return res.status(200).send({ message: "Password has been successfully updated", success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send({ success: false, message: error.message });
  }
};

module.exports = {
  registerController,
  loginController,
  logoutController,
  getAllCoursesController,
  postCourseController,
  getAllCoursesUserController,
  sendCourseContentController,
  verifyOtpController,
  forgotPasswordController,
  resetPasswordController,
};
