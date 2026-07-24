const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const checkRole = require("../middlewares/roleMiddleware");
const {
  addBookmark,
  removeBookmark,
  getBookmarkStatus,
  getSavedCourses,
  clearBookmarks,
} = require("../controllers/courseBookmarkController");

const router = express.Router();

router.use(authMiddleware);
router.use(checkRole(["student", "Student"]));

router.get("/", getSavedCourses);
router.get("/status", getBookmarkStatus);
router.post("/:courseId", addBookmark);
router.delete("/:courseId", removeBookmark);
router.delete("/", clearBookmarks);

module.exports = router;
