const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: false,
      index: true,
    },
    action: {
      type: String,
      // login_failed is what lets the log answer the question an audit log
      // exists for: was there a burst of attempts against this account. The
      // account events (#126) are the same question asked of a session that is
      // already signed in.
      enum: [
        "login",
        "logout",
        "login_failed",
        "password_changed",
        "password_change_failed",
        "profile_updated",
      ],
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    role: {
      type: String,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    ipAddress: {
      type: String,
      trim: true,
      default: null,
    },
    userAgent: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    // getActivityLogsController falls back to `log.createdAt` when `timestamp`
    // is absent, and without this that fallback was always undefined.
    timestamps: true,
    versionKey: false,
  },
);

activityLogSchema.index({ timestamp: -1, role: 1, action: 1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
