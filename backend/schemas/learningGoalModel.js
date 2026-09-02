const mongoose = require("mongoose");

const studySessionSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    durationMinutes: { type: Number, required: true, min: 1, max: 480 },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "course" },
    note: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { _id: false, versionKey: false },
);

const learningGoalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    weeklyMinutesTarget: {
      type: Number,
      required: true,
      min: 15,
      max: 2100,
    },
    streakDays: { type: Number, default: 0 },
    lastLoggedDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    sessions: [studySessionSchema],
  },
  { timestamps: true, versionKey: false },
);

learningGoalSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model("learningGoal", learningGoalSchema);
