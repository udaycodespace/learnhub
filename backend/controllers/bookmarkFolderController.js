const mongoose = require("mongoose");
const BookmarkFolder = require("../schemas/bookmarkFolderModel");
const Course = require("../schemas/courseModel");

const getUserId = (req) => req.user?._id?.toString() || req.body?.userId || null;

exports.createFolder = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).send({ success: false, message: "Folder name is required." });
    if (name.length > 60) return res.status(400).send({ success: false, message: "Name cannot exceed 60 characters." });
    const folder = await BookmarkFolder.create({ userId, name });
    return res.status(201).send({ success: true, data: folder });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).send({ success: false, message: "A folder with that name already exists." });
    console.error("createFolder:", err);
    return res.status(500).send({ success: false, message: "Unable to create folder." });
  }
};

exports.listFolders = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const folders = await BookmarkFolder.find({ userId })
      .populate("courses.courseId", "C_title C_categories C_educator C_price")
      .sort({ createdAt: -1 })
      .lean();
    const data = folders.map((f) => ({
      id: f._id,
      name: f.name,
      courseCount: f.courses.length,
      courses: f.courses
        .filter((c) => c.courseId)
        .map((c) => ({
          id: c.courseId._id,
          title: c.courseId.C_title,
          category: c.courseId.C_categories,
          educator: c.courseId.C_educator,
          price: c.courseId.C_price,
          addedAt: c.addedAt,
        })),
      createdAt: f.createdAt,
    }));
    return res.status(200).send({ success: true, data });
  } catch (err) {
    console.error("listFolders:", err);
    return res.status(500).send({ success: false, message: "Unable to list folders." });
  }
};

exports.renameFolder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { folderId } = req.params;
    const name = String(req.body.name || "").trim();
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    if (!name || name.length > 60) return res.status(400).send({ success: false, message: "Valid name (1–60 chars) required." });
    const folder = await BookmarkFolder.findOneAndUpdate(
      { _id: folderId, userId },
      { name },
      { new: true, runValidators: true },
    );
    if (!folder) return res.status(404).send({ success: false, message: "Folder not found." });
    return res.status(200).send({ success: true, data: folder });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).send({ success: false, message: "A folder with that name already exists." });
    console.error("renameFolder:", err);
    return res.status(500).send({ success: false, message: "Unable to rename folder." });
  }
};

exports.deleteFolder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { folderId } = req.params;
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const folder = await BookmarkFolder.findOneAndDelete({ _id: folderId, userId });
    if (!folder) return res.status(404).send({ success: false, message: "Folder not found." });
    return res.status(200).send({ success: true, message: "Folder deleted." });
  } catch (err) {
    console.error("deleteFolder:", err);
    return res.status(500).send({ success: false, message: "Unable to delete folder." });
  }
};

exports.addCourseToFolder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { folderId } = req.params;
    const { courseId } = req.body;
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) return res.status(400).send({ success: false, message: "Valid courseId required." });
    const course = await Course.findById(courseId).select("_id").lean();
    if (!course) return res.status(404).send({ success: false, message: "Course not found." });
    const folder = await BookmarkFolder.findOne({ _id: folderId, userId });
    if (!folder) return res.status(404).send({ success: false, message: "Folder not found." });
    const already = folder.courses.some((c) => c.courseId.toString() === courseId);
    if (already) return res.status(200).send({ success: true, message: "Course already in folder." });
    folder.courses.push({ courseId });
    await folder.save();
    return res.status(201).send({ success: true, message: "Course added to folder." });
  } catch (err) {
    console.error("addCourseToFolder:", err);
    return res.status(500).send({ success: false, message: "Unable to add course." });
  }
};

exports.removeCourseFromFolder = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { folderId, courseId } = req.params;
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const folder = await BookmarkFolder.findOne({ _id: folderId, userId });
    if (!folder) return res.status(404).send({ success: false, message: "Folder not found." });
    const before = folder.courses.length;
    folder.courses = folder.courses.filter((c) => c.courseId.toString() !== courseId);
    if (folder.courses.length === before) return res.status(404).send({ success: false, message: "Course not in folder." });
    await folder.save();
    return res.status(200).send({ success: true, message: "Course removed from folder." });
  } catch (err) {
    console.error("removeCourseFromFolder:", err);
    return res.status(500).send({ success: false, message: "Unable to remove course." });
  }
};
