const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

const { buildCorsOptions } = require("./config/cors");
const {
  createSecurityHeaders,
  securityHeaderSettingsFromEnv,
} = require("./middlewares/securityHeaders");
const { createNotFoundHandler } = require("./middlewares/notFoundHandler");
const { createErrorHandler } = require("./middlewares/errorHandler");
const { createHealthRouter } = require("./routers/healthRoutes");

dotenv.config();

const app = express();

// Behind a proxy or load balancer, req.ip and req.secure are only meaningful
// once Express is told to read the forwarded headers. The rate limiter and the
// HSTS check both depend on this.
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

// Hide the framework banner; it tells an attacker what to target and nothing
// useful to anybody else.
app.disable("x-powered-by");

app.use(createSecurityHeaders(securityHeaderSettingsFromEnv()));

// An explicit, configurable body limit. Oversized and malformed bodies raise
// typed errors that the error handler below turns into 413 and 400.
const jsonBodyLimit = process.env.JSON_BODY_LIMIT || "1mb";
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }));

// Only the origins listed in FRONTEND_URL, instead of reflecting every caller.
app.use(cors(buildCorsOptions()));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// The upload directory is deliberately not served. It used to be
// `app.use("/uploads", express.static(uploadsDir))`, which handed every course
// video to anyone who asked for it — and the public catalogue endpoint
// published the filenames, so no guessing was involved. Section videos are
// served by GET /api/user/coursevideo/:courseid/:sectionIndex, which checks a
// playback token minted only after the enrolment check in /coursecontent.

app.use("/api/health", createHealthRouter());

app.get("/api/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/api/admin/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "admin-dashboard.html"));
});

app.use("/api/admin", require("./routers/adminRoutes"));
app.use("/api/user", require("./routers/userRoutes"));
app.use("/api/bookmarks", require("./routers/courseBookmarkRoutes"));
app.use("/api/bookmark-folders", require("./routers/bookmarkFolderRoutes"));
app.use("/api/reviews", require("./routers/courseReviewRoutes"));
app.use("/api/goals", require("./routers/learningGoalRoutes"));
app.use("/api/forum", require("./routers/courseForumRoutes"));

// Unmatched /api routes answer with the project's JSON envelope rather than
// Express's default HTML page.
app.use(createNotFoundHandler());

app.use(createErrorHandler());

module.exports = app;
