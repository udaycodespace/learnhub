const mongoose = require("mongoose");
const LearningGoal = require("../schemas/learningGoalModel");

const getUserId = (req) => req.user?._id?.toString() || req.body?.userId || null;

const DAY_MS = 86400000;

function isSameDay(d1, d2) {
  const a = new Date(d1), b = new Date(d2);
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isYesterday(d1, d2) {
  return isSameDay(d1, new Date(new Date(d2).getTime() + DAY_MS));
}

function recalcStreak(goal) {
  if (!goal.sessions.length) { goal.streakDays = 0; return; }
  const dates = [...new Set(goal.sessions.map(s => new Date(s.date).toDateString()))].sort((a, b) => new Date(b) - new Date(a));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(dates[0]); last.setHours(0, 0, 0, 0);
  if (!isSameDay(last, today) && !isYesterday(last, today)) { goal.streakDays = 0; return; }
  let streak = 1;
  for (let i = 0; i < dates.length - 1; i++) {
    const curr = new Date(dates[i]), prev = new Date(dates[i + 1]);
    if (isSameDay(curr, prev)) continue;
    if ((curr - prev) / DAY_MS === 1) streak++;
    else break;
  }
  goal.streakDays = streak;
}

exports.getGoal = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const goal = await LearningGoal.findOne({ userId, isActive: true }).lean();
    return res.status(200).send({ success: true, data: goal || null });
  } catch (err) {
    console.error("getGoal:", err);
    return res.status(500).send({ success: false, message: "Unable to retrieve goal." });
  }
};

exports.setGoal = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const minutes = Number(req.body.weeklyMinutesTarget);
    if (!Number.isFinite(minutes) || minutes < 15 || minutes > 2100) {
      return res.status(400).send({ success: false, message: "Target must be 15–2100 minutes." });
    }
    await LearningGoal.updateMany({ userId, isActive: true }, { isActive: false });
    const goal = await LearningGoal.create({ userId, weeklyMinutesTarget: minutes });
    return res.status(201).send({ success: true, data: goal });
  } catch (err) {
    console.error("setGoal:", err);
    return res.status(500).send({ success: false, message: "Unable to save goal." });
  }
};

exports.logSession = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const duration = Number(req.body.durationMinutes);
    if (!Number.isFinite(duration) || duration < 1 || duration > 480) {
      return res.status(400).send({ success: false, message: "Duration must be 1–480 minutes." });
    }
    const goal = await LearningGoal.findOne({ userId, isActive: true });
    if (!goal) return res.status(404).send({ success: false, message: "No active goal. Set one first." });
    goal.sessions.push({ durationMinutes: duration, courseId: req.body.courseId || undefined, note: req.body.note || "" });
    recalcStreak(goal);
    goal.lastLoggedDate = new Date();
    await goal.save();
    return res.status(201).send({ success: true, data: goal });
  } catch (err) {
    console.error("logSession:", err);
    return res.status(500).send({ success: false, message: "Unable to log session." });
  }
};

exports.getWeeklyStats = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const goal = await LearningGoal.findOne({ userId, isActive: true }).lean();
    if (!goal) return res.status(200).send({ success: true, data: { goal: null, weekMinutes: 0, weekSessions: 0, dailyBreakdown: [] } });
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
    const weekSessions = (goal.sessions || []).filter(s => new Date(s.date) >= weekStart);
    const weekMinutes = weekSessions.reduce((sum, s) => sum + s.durationMinutes, 0);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dailyBreakdown = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(weekStart); day.setDate(weekStart.getDate() + i);
      const mins = weekSessions.filter(s => isSameDay(s.date, day)).reduce((sum, s) => sum + s.durationMinutes, 0);
      return { day: dayNames[i], minutes: mins };
    });
    return res.status(200).send({
      success: true,
      data: { goal: { weeklyMinutesTarget: goal.weeklyMinutesTarget, streakDays: goal.streakDays }, weekMinutes, weekSessions: weekSessions.length, dailyBreakdown },
    });
  } catch (err) {
    console.error("getWeeklyStats:", err);
    return res.status(500).send({ success: false, message: "Unable to retrieve stats." });
  }
};

exports.deleteGoal = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).send({ success: false, message: "Authentication required." });
    const goal = await LearningGoal.findOneAndUpdate({ userId, isActive: true }, { isActive: false }, { new: true });
    if (!goal) return res.status(404).send({ success: false, message: "No active goal found." });
    return res.status(200).send({ success: true, message: "Goal deactivated." });
  } catch (err) {
    console.error("deleteGoal:", err);
    return res.status(500).send({ success: false, message: "Unable to delete goal." });
  }
};
