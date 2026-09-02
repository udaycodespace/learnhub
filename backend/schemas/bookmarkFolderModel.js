const mongoose = require("mongoose");

const bookmarkFolderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Folder name is required."],
      trim: true,
      maxlength: 60,
    },
    courses: [
      {
        courseId: { type: mongoose.Schema.Types.ObjectId, ref: "course", required: true },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true, versionKey: false },
);

bookmarkFolderSchema.index({ userId: 1, name: 1 }, { unique: true });
bookmarkFolderSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("bookmarkFolder", bookmarkFolderSchema);
