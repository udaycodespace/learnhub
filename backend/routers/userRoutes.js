const express = require("express");
const multer = require("multer");

const authMiddleware = require("../middlewares/authMiddleware");
const {
  registerController,
  loginController,
  logoutController,
  postCourseController,
  getAllCoursesController,
  verifyOtpController,
  forgotPasswordController,
  resetPasswordController,
} = require("../controllers/userControllers");

// Course deletion and progress tracking are imported from their own modules
// rather than through the userControllers aggregator. Both enforce checks that
// the request body cannot influence, so the wiring is kept explicit here.
const {
  deleteCourseController,
} = require("../controllers/courseDeletionController");
// Beside the deletion controller deliberately: the two share their ownership
// rule, and editing exists so that correcting a title no longer has to go
// through deleting (#127).
const {
  getCourseForEditController,
  updateCourseController,
} = require("../controllers/courseUpdateController");
const {
  completeSectionController,
} = require("../controllers/progressController");
const {
  getCourseContentController,
} = require("../controllers/courseContentController");
const {
  resendOtpController,
} = require("../controllers/emailVerificationController");
const {
  courseVideoController,
} = require("../controllers/courseVideoController");
const {
  playbackTokenController,
} = require("../controllers/playbackAccessController");

const checkRole = require("../middlewares/roleMiddleware");
const {
  getEnrolledCoursesController,
} = require("../controllers/enrolledCoursesController");
const {
  getTeacherCoursesController,
} = require("../controllers/teacherCoursesController");
const {
  enrollCourseController,
  withdrawEnrollmentController,
} = require("../controllers/enrollmentController");
const {
  createRateLimiter,
  rateLimitSettingsFromEnv,
} = require("../middlewares/rateLimiter");
const {
  createVerificationThrottle,
  throttleSettingsFromEnv,
} = require("../middlewares/verificationThrottle");
const {
  createCourseVideoUpload,
} = require("../utils/videoUpload");
const {
  createCourseVideoUploadMiddleware,
} = require("../utils/courseVideoUploadMiddleware");
const {
  preserveAuthIdentity,
} = require("../middlewares/preserveAuthIdentity");
const {
  changePasswordController,
  getAccountController,
  updateAccountController,
} = require("../controllers/accountController");

const router = express.Router();

const upload = createCourseVideoUpload({
  multerLib: multer,
});

const courseVideoUpload = createCourseVideoUploadMiddleware({
  upload,
});

// Two layers guard every credential endpoint: a per-client rate limit that caps
// request volume, and a per-account failure throttle that locks the targeted
// email address so rotating source addresses does not help.
const rateLimitSettings = rateLimitSettingsFromEnv();
const throttleSettings = throttleSettingsFromEnv();

const credentialRateLimiter = (scope) =>
  createRateLimiter({ ...rateLimitSettings, scope });

const credentialThrottle = (scope) =>
  createVerificationThrottle({ ...throttleSettings, scope });

router.post("/register", credentialRateLimiter("register"), registerController);

router.post(
  "/login",
  credentialRateLimiter("login"),
  credentialThrottle("login"),
  loginController,
);

// Multer replaces req.body, so the userId authMiddleware wrote there does not
// survive the upload. preserveAuthIdentity puts the token's id back before the
// controller runs; the controller itself reads req.user and does not depend on
// it, but nothing mounted after an upload should see a client-supplied userId.
router.post(
  "/addcourse",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  courseVideoUpload,
  preserveAuthIdentity,
  postCourseController
);

router.get("/getallcourses", getAllCoursesController);

router.get(
  "/getallcoursesteacher",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  getTeacherCoursesController
);

// #127. A course could be created and deleted and nothing else, so correcting
// a typo in a title meant deleting it — and that cascade removes every
// enrolment, payment, review, bookmark and uploaded video.
//
// JSON, not multipart: none of the editable fields is a file, so there is no
// Multer here and none of the identity trouble that comes with it. The GET
// exists because the educator list endpoint deliberately projects section text
// away (#94), so an edit form has nowhere else to read it from.
router.get(
  "/editcourse/:courseid",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  getCourseForEditController,
);

router.put(
  "/editcourse/:courseid",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  updateCourseController,
);

router.delete(
  "/deletecourse/:courseid",
  authMiddleware,
  checkRole(["teacher", "admin"]),
  deleteCourseController
);

router.post(
  "/enrolledcourse/:courseid",
  authMiddleware,
  enrollCourseController
);

// #128. The counterpart that did not exist. An enrolment row was only ever
// created; the only deletes are in the cascade, for a deleted course or a
// deleted account. So a course joined by mistake stayed on My Courses for the
// life of the account and kept inflating `course.enrolled`, which the
// catalogue sorts "popular" by.
//
// No role check: whoever is enrolled may leave, and the account comes from the
// token, so there is no way to spell a request that withdraws somebody else.
router.delete(
  "/enrolledcourse/:courseid",
  authMiddleware,
  withdrawEnrollmentController
);

router.get(
  "/coursecontent/:courseid",
  authMiddleware,
  getCourseContentController
);

// #124. Renews the playback token without re-fetching the whole course.
//
// The token is deliberately short-lived, and nothing renewed it: the player
// received one when it mounted and was still holding it half an hour later,
// when the stream route began refusing it. The <video> element's 401 does not
// pass through the axios interceptor, so the failure was silent.
//
// Authenticated and enrolment-checked, exactly like /coursecontent — this is
// the same claim, asked again, so an enrolment that has since been removed
// does not get a fresh half hour.
router.get(
  "/playbacktoken/:courseid",
  authMiddleware,
  playbackTokenController,
);

// No authMiddleware: a <video> element cannot send an Authorization header, so
// this route authenticates on the short-lived, course-scoped playback token
// that /coursecontent hands out after checking enrolment. It replaces the
// public express.static handler on /uploads.
router.get("/coursevideo/:courseid/:sectionIndex", courseVideoController);

router.post("/completemodule", authMiddleware, completeSectionController);

router.get("/getallcoursesuser", authMiddleware, getEnrolledCoursesController);

// Authenticated, unlike the rest of this group: an open endpoint would let
// anyone write activity log rows for any account. There is no server-side
// session to destroy — the token is stateless — so this exists purely so
// signing out is recorded.
//
// Not rate limited either: it needs a valid token to reach, which is the
// bound that matters, and throttling it would only make signing out fail.
router.post("/logout", authMiddleware, logoutController);

// #126. The account a signed-in user owns. There was no route that read or
// wrote it: no /me, no /profile, no /change-password, so the only way to set a
// new password was to sign out and complete the emailed reset flow — trading
// "I hold a valid session for this account" for "I can read this mailbox",
// which is the weaker claim of the two and the one #95 had to harden against
// strangers.
router.get("/account", authMiddleware, getAccountController);

router.put("/account", authMiddleware, updateAccountController);

// Rate limited like every other credential endpoint. It is guarded by a valid
// token, which is the bound that matters, but it also takes a password and
// compares it — and an endpoint that tells you whether a guess was right is
// exactly the kind that should not accept unlimited requests.
//
// No failure throttle: that locks an email address, and locking the owner of a
// live session out of the rest of the app because somebody mistyped their
// current password twice would be worse than the thing it prevents. The
// failures are recorded in the activity log instead.
router.post(
  "/change-password",
  authMiddleware,
  credentialRateLimiter("change-password"),
  changePasswordController,
);

router.post(
  "/verify-otp",
  credentialRateLimiter("verify-otp"),
  credentialThrottle("verify-otp"),
  verifyOtpController,
);

// Without this an account whose OTP expired had no route back: registering
// again answered "User already exists" and logging in answered "Email is not
// verified". The cooldown lives in the controller, not here, so it applies
// however the code is requested.
//
// Rate limited like every other credential endpoint — it sends mail, so it is
// exactly the kind of route that should not accept unlimited requests. No
// failure throttle, for the same reason /forgot-password has none: it answers
// the same way for known and unknown addresses, so there is no failure to count.
router.post(
  "/resend-otp",
  credentialRateLimiter("resend-otp"),
  resendOtpController,
);

// No failure throttle here: this endpoint answers the same way for known and
// unknown addresses on purpose, so there is no failure to count. The rate limit
// is what stops it being used as a mail bomb.
router.post(
  "/forgot-password",
  credentialRateLimiter("forgot-password"),
  forgotPasswordController,
);

router.post(
  "/reset-password",
  credentialRateLimiter("reset-password"),
  credentialThrottle("reset-password"),
  resetPasswordController,
);

module.exports = router;
