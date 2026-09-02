const mongoose = require("mongoose");

const recentlyViewedSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "course",
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { versionKey: false },
);

recentlyViewedSchema.index({ userId: 1, viewedAt: -1 });
recentlyViewedSchema.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model("recentlyViewed", recentlyViewedSchema);
