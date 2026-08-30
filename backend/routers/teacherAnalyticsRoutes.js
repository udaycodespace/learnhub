const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const { getTeacherAnalytics, getCourseDetail } = require("../controllers/teacherAnalyticsController");
const checkRole = require("../middlewares/roleMiddleware");

const router = express.Router();

router.get("/", authMiddleware, checkRole(["teacher", "admin"]), getTeacherAnalytics);
router.get("/course/:courseId", authMiddleware, checkRole(["teacher", "admin"]), getCourseDetail);

module.exports = router;
