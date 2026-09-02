const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    body: {
      type: String,
      required: [true, "Answer body is required."],
      trim: true,
      maxlength: 2000,
    },
    isAccepted: {
      type: Boolean,
      default: false,
    },
    upvotes: {
      type: Number,
      default: 0,
    },
    upvotedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
      },
    ],
  },
  { timestamps: true, versionKey: false },
);

const courseForumSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "course",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Question title is required."],
      trim: true,
      maxlength: 200,
    },
    body: {
      type: String,
      required: [true, "Question body is required."],
      trim: true,
      maxlength: 5000,
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 30,
      },
    ],
    isResolved: {
      type: Boolean,
      default: false,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    answers: [answerSchema],
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

courseForumSchema.index({ courseId: 1, createdAt: -1 });
courseForumSchema.index({ courseId: 1, isResolved: 1 });
courseForumSchema.index({ courseId: 1, lastActivityAt: -1 });
courseForumSchema.index({ "answers.userId": 1 });

module.exports = mongoose.model("courseForum", courseForumSchema);
