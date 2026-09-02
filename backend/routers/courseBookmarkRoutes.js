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

// The roles that have a wishlist, declared once for every route below.
//
// Exported because the client mirrors this list — `frontend/src/lib/
// bookmarkAccess.js` gates the navbar link, the provider's fetch and the save
// button on the same rule, after the navbar spent a while offering educators
// and admins a link this router answers 403 for (#115).
//
// `"Student"` used to be listed alongside `"student"`. checkRole lowercases
// both sides before comparing, so the second spelling never did anything, and
// carrying it suggested the rule was fuzzier than it is.
const BOOKMARK_ROLES = ["student"];

router.use(authMiddleware);
router.use(checkRole(BOOKMARK_ROLES));

router.get("/", getSavedCourses);
router.get("/status", getBookmarkStatus);
router.post("/:courseId", addBookmark);
router.delete("/:courseId", removeBookmark);
router.delete("/", clearBookmarks);

module.exports = router;
module.exports.BOOKMARK_ROLES = BOOKMARK_ROLES;
