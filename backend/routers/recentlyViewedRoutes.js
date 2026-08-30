const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const { recordView, getRecent, clearRecent } = require("../controllers/recentlyViewController");

const router = express.Router();

router.get("/", authMiddleware, getRecent);
router.post("/:courseId", authMiddleware, recordView);
router.delete("/", authMiddleware, clearRecent);

module.exports = router;
