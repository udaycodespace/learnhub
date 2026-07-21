const mongoose = require("mongoose");

const courseReviewSchema = new mongoose.Schema(
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
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    reviewText: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
  },
  { timestamps: true, versionKey: false },
);

courseReviewSchema.index({ userId: 1, courseId: 1 }, { unique: true });
courseReviewSchema.index({ courseId: 1, createdAt: -1 });

module.exports = mongoose.model("courseReview", courseReviewSchema);
