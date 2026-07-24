const mongoose = require("mongoose");

const courseBookmarkSchema = new mongoose.Schema(
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
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

courseBookmarkSchema.index(
  { userId: 1, courseId: 1 },
  { unique: true },
);
courseBookmarkSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("courseBookmark", courseBookmarkSchema);
