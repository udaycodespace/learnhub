const mongoose = require("mongoose");
const RecentlyViewed = require("../schemas/recentlyViewedModel");

const getUserId = (req) => req.user?._id?.toString() || req.body?.userId || null;
const MAX_RECENT = 20;

exports.recordView = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { courseId } = req.params;
    if (!userId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).send({ success: false, message: "Valid user and course required." });
    }
    await RecentlyViewed.findOneAndUpdate(
      { userId, courseId },
      { viewedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const count = await RecentlyViewed.countDocuments({ userId });
    if (count > MAX_RECENT) {
      const oldest = await RecentlyViewed.find({ userId }).sort({ viewedAt: 1 }).lean();
      const toRemove = oldest.slice(0, count - MAX_RECENT).map((d) => d._id);
      if (toRemove.length) await RecentlyViewed.deleteMany({ _id: { $in: toRemove } });
    }
    return res.status(200).send({ success: true });
  } catch (err) {
    console.error("recordView:", err);
    return res.status(500).send({ success: false, message: "Unable to record view." });
  }
};

exports.getRecent = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const limit = Math.min(Number(req.query.limit) || 10, MAX_RECENT);
    const docs = await RecentlyViewed.find({ userId })
      .populate({ path: "courseId", select: "C_title C_categories C_educator C_price enrolled" })
      .sort({ viewedAt: -1 })
      .limit(limit)
      .lean();
    const data = docs
      .filter((d) => d.courseId)
      .map((d) => ({
        id: d.courseId._id,
        title: d.courseId.C_title,
        category: d.courseId.C_categories,
        educator: d.courseId.C_educator,
        price: d.courseId.C_price,
        enrolled: d.courseId.enrolled,
        viewedAt: d.viewedAt,
      }));
    return res.status(200).send({ success: true, data });
  } catch (err) {
    console.error("getRecent:", err);
    return res.status(500).send({ success: false, message: "Unable to retrieve recent courses." });
  }
};

exports.clearRecent = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    await RecentlyViewed.deleteMany({ userId });
    return res.status(200).send({ success: true, message: "Recently viewed cleared." });
  } catch (err) {
    console.error("clearRecent:", err);
    return res.status(500).send({ success: false, message: "Unable to clear recent views." });
  }
};
