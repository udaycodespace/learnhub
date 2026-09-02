const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  createFolder, listFolders, renameFolder, deleteFolder,
  addCourseToFolder, removeCourseFromFolder,
} = require("../controllers/bookmarkFolderController");

const router = express.Router();

router.get("/", authMiddleware, listFolders);
router.post("/", authMiddleware, createFolder);
router.put("/:folderId", authMiddleware, renameFolder);
router.delete("/:folderId", authMiddleware, deleteFolder);
router.post("/:folderId/courses", authMiddleware, addCourseToFolder);
router.delete("/:folderId/courses/:courseId", authMiddleware, removeCourseFromFolder);

module.exports = router;
