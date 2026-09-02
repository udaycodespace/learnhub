const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createQuestion,
  listQuestions,
  getQuestion,
  deleteQuestion,
  addAnswer,
  deleteAnswer,
  toggleAcceptAnswer,
  toggleUpvoteAnswer,
  getForumStats,
} = require("../controllers/courseForumController");

const router = express.Router();

router.get("/stats/:courseId", getForumStats);
router.get("/:courseId", listQuestions);
router.post("/:courseId", authMiddleware, createQuestion);
router.get("/q/:questionId", getQuestion);
router.delete("/q/:questionId", authMiddleware, deleteQuestion);
router.post("/q/:questionId/answers", authMiddleware, addAnswer);
router.delete(
  "/q/:questionId/answers/:answerId",
  authMiddleware,
  deleteAnswer,
);
router.put(
  "/q/:questionId/answers/:answerId/accept",
  authMiddleware,
  toggleAcceptAnswer,
);
router.post(
  "/q/:questionId/answers/:answerId/upvote",
  authMiddleware,
  toggleUpvoteAnswer,
);

module.exports = router;
