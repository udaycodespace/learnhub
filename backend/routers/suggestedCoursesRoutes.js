const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const { getSuggestedCourses } = require("../controllers/suggestedCoursesController");

const router = express.Router();

router.get("/", authMiddleware, getSuggestedCourses);

module.exports = router;
