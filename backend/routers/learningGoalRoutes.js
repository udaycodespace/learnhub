const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const { getGoal, setGoal, logSession, getWeeklyStats, deleteGoal } = require("../controllers/learningGoalController");

const router = express.Router();

router.get("/", authMiddleware, getGoal);
router.post("/", authMiddleware, setGoal);
router.delete("/", authMiddleware, deleteGoal);
router.post("/log", authMiddleware, logSession);
router.get("/stats", authMiddleware, getWeeklyStats);

module.exports = router;
