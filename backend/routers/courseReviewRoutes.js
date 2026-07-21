const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createReview,
  listReviews,
  getRatingSummary,
  updateReview,
  deleteReview,
  getMyReview,
} = require("../controllers/courseReviewController");

const router = express.Router();

router.get("/:courseId", listReviews);
router.get("/:courseId/summary", getRatingSummary);
router.get("/:courseId/mine", authMiddleware, getMyReview);
router.post("/:courseId", authMiddleware, createReview);
router.put("/review/:reviewId", authMiddleware, updateReview);
router.delete("/review/:reviewId", authMiddleware, deleteReview);

module.exports = router;
