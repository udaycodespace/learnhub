const mongoose = require("mongoose");
const CourseForum = require("../schemas/courseForumModel");
const Course = require("../schemas/courseModel");
const EnrolledCourse = require("../schemas/enrolledCourseModel");

const ALLOWED_SORTS = new Set(["newest", "oldest", "unanswered", "popular"]);
const MAX_TAGS = 5;

const parsePositiveInteger = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const validateCourseId = (courseId) => mongoose.Types.ObjectId.isValid(courseId);

const getAuthenticatedUserId = (req) =>
  req.user?._id?.toString() || req.body?.userId || null;

const serializeQuestion = (question, currentUserId = null) => ({
  id: question._id.toString(),
  courseId: question.courseId?._id?.toString() || question.courseId?.toString(),
  title: question.title,
  body: question.body,
  tags: question.tags || [],
  isResolved: question.isResolved,
  viewCount: question.viewCount || 0,
  answerCount: (question.answers || []).length,
  lastActivityAt: question.lastActivityAt,
  createdAt: question.createdAt,
  user: {
    id: question.userId?._id?.toString() || question.userId?.toString(),
    name: question.userId?.name || "LearnHub student",
    type: question.userId?.type || "student",
  },
  isOwner:
    Boolean(currentUserId) &&
    String(question.userId?._id || question.userId) === String(currentUserId),
  answers: (question.answers || []).map((a) =>
    serializeAnswer(a, currentUserId),
  ),
});

const serializeAnswer = (answer, currentUserId = null) => ({
  id: answer._id?.toString(),
  body: answer.body,
  isAccepted: answer.isAccepted,
  upvotes: answer.upvotes || 0,
  createdAt: answer.createdAt,
  updatedAt: answer.updatedAt,
  user: {
    id: answer.userId?._id?.toString() || answer.userId?.toString(),
    name: answer.userId?.name || "LearnHub student",
    type: answer.userId?.type || "student",
  },
  isOwner:
    Boolean(currentUserId) &&
    String(answer.userId?._id || answer.userId) === String(currentUserId),
  hasUpvoted:
    Boolean(currentUserId) &&
    (answer.upvotedBy || []).some(
      (id) => String(id) === String(currentUserId),
    ),
});

const ensureCourseExists = async (courseId) =>
  Course.findById(courseId).select("_id C_title").lean();

const ensureEnrollment = async (userId, courseId) =>
  EnrolledCourse.findOne({ userId, courseId }).select("_id").lean();

// ─── Create Question ───────────────────────────────────────────────

const createQuestion = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const title = String(req.body.title || "").trim();
    const body = String(req.body.body || "").trim();
    const rawTags = Array.isArray(req.body.tags) ? req.body.tags : [];

    if (!userId || !validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "A valid course and authenticated user are required.",
      });
    }

    if (!title || title.length < 5) {
      return res.status(400).send({
        success: false,
        message: "Question title must be at least 5 characters.",
      });
    }

    if (title.length > 200) {
      return res.status(400).send({
        success: false,
        message: "Question title cannot exceed 200 characters.",
      });
    }

    if (!body || body.length < 10) {
      return res.status(400).send({
        success: false,
        message: "Question body must be at least 10 characters.",
      });
    }

    if (body.length > 5000) {
      return res.status(400).send({
        success: false,
        message: "Question body cannot exceed 5000 characters.",
      });
    }

    const course = await ensureCourseExists(courseId);
    if (!course) {
      return res.status(404).send({
        success: false,
        message: "Course not found.",
      });
    }

    const enrollment = await ensureEnrollment(userId, courseId);
    if (!enrollment) {
      return res.status(403).send({
        success: false,
        message: "Only enrolled students can post questions.",
      });
    }

    const tags = rawTags
      .slice(0, MAX_TAGS)
      .map((t) => String(t || "").trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= 30);

    const question = await CourseForum.create({
      courseId,
      userId,
      title,
      body,
      tags,
    });

    await question.populate("userId", "name type");

    return res.status(201).send({
      success: true,
      message: "Question posted successfully.",
      data: serializeQuestion(question, userId),
    });
  } catch (error) {
    console.error("Unable to create forum question:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to post the question.",
    });
  }
};

// ─── List Questions ────────────────────────────────────────────────

const listQuestions = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const limit = parsePositiveInteger(req.query.limit, 10, 25);
    const sort = String(req.query.sort || "newest").toLowerCase();
    const search = String(req.query.search || "").trim().slice(0, 120);

    if (!ALLOWED_SORTS.has(sort)) {
      return res.status(400).send({
        success: false,
        message: "Invalid sort option.",
      });
    }

    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      unanswered: { "answers.0": 1, createdAt: -1 },
      popular: { viewCount: -1, createdAt: -1 },
    };

    const query = { courseId };
    if (search) {
      const searchRegex = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      query.$or = [{ title: searchRegex }, { body: searchRegex }];
    }

    const totalItems = await CourseForum.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    const currentUserId = getAuthenticatedUserId(req);

    const questions = await CourseForum.find(query)
      .populate("userId", "name type")
      .sort(sortMap[sort])
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).send({
      success: true,
      data: questions.map((q) => ({
        ...serializeQuestion(q, currentUserId),
        answers: undefined,
      })),
      pagination: {
        page: safePage,
        limit,
        totalItems,
        totalPages,
        hasPreviousPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      },
      sort,
    });
  } catch (error) {
    console.error("Unable to retrieve forum questions:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve questions.",
    });
  }
};

// ─── Get Single Question (with answers) ────────────────────────────

const getQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const currentUserId = getAuthenticatedUserId(req);

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid question ID.",
      });
    }

    const question = await CourseForum.findByIdAndUpdate(
      questionId,
      { $inc: { viewCount: 1 } },
      { new: true },
    )
      .populate("userId", "name type")
      .populate("answers.userId", "name type")
      .lean();

    if (!question) {
      return res.status(404).send({
        success: false,
        message: "Question not found.",
      });
    }

    question.answers.sort((a, b) => {
      if (a.isAccepted && !b.isAccepted) return -1;
      if (!a.isAccepted && b.isAccepted) return 1;
      return (b.upvotes || 0) - (a.upvotes || 0);
    });

    return res.status(200).send({
      success: true,
      data: serializeQuestion(question, currentUserId),
    });
  } catch (error) {
    console.error("Unable to retrieve forum question:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve the question.",
    });
  }
};

// ─── Delete Question ───────────────────────────────────────────────

const deleteQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid question ID.",
      });
    }

    const question = await CourseForum.findOneAndDelete({
      _id: questionId,
      userId,
    });

    if (!question) {
      return res.status(404).send({
        success: false,
        message: "Question not found or you do not own it.",
      });
    }

    return res.status(200).send({
      success: true,
      message: "Question deleted successfully.",
    });
  } catch (error) {
    console.error("Unable to delete forum question:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to delete the question.",
    });
  }
};

// ─── Add Answer ────────────────────────────────────────────────────

const addAnswer = async (req, res) => {
  try {
    const { questionId } = req.params;
    const userId = getAuthenticatedUserId(req);
    const body = String(req.body.body || "").trim();

    if (!userId) {
      return res.status(400).send({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid question ID.",
      });
    }

    if (!body || body.length < 5) {
      return res.status(400).send({
        success: false,
        message: "Answer must be at least 5 characters.",
      });
    }

    if (body.length > 2000) {
      return res.status(400).send({
        success: false,
        message: "Answer cannot exceed 2000 characters.",
      });
    }

    const question = await CourseForum.findById(questionId);
    if (!question) {
      return res.status(404).send({
        success: false,
        message: "Question not found.",
      });
    }

    question.answers.push({ userId, body });
    question.lastActivityAt = new Date();
    await question.save();

    await question.populate("userId", "name type");
    await question.populate("answers.userId", "name type");

    const addedAnswer = question.answers[question.answers.length - 1];

    return res.status(201).send({
      success: true,
      message: "Answer posted successfully.",
      data: serializeAnswer(addedAnswer, userId),
    });
  } catch (error) {
    console.error("Unable to add answer:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to post the answer.",
    });
  }
};

// ─── Delete Answer ─────────────────────────────────────────────────

const deleteAnswer = async (req, res) => {
  try {
    const { questionId, answerId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (
      !mongoose.Types.ObjectId.isValid(questionId) ||
      !mongoose.Types.ObjectId.isValid(answerId)
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid question or answer ID.",
      });
    }

    const question = await CourseForum.findById(questionId);
    if (!question) {
      return res.status(404).send({
        success: false,
        message: "Question not found.",
      });
    }

    const answer = question.answers.id(answerId);
    if (!answer) {
      return res.status(404).send({
        success: false,
        message: "Answer not found.",
      });
    }

    if (String(answer.userId) !== String(userId)) {
      return res.status(403).send({
        success: false,
        message: "You can only delete your own answers.",
      });
    }

    answer.deleteOne();
    await question.save();

    return res.status(200).send({
      success: true,
      message: "Answer deleted successfully.",
    });
  } catch (error) {
    console.error("Unable to delete answer:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to delete the answer.",
    });
  }
};

// ─── Toggle Answer Accept ──────────────────────────────────────────

const toggleAcceptAnswer = async (req, res) => {
  try {
    const { questionId, answerId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (
      !mongoose.Types.ObjectId.isValid(questionId) ||
      !mongoose.Types.ObjectId.isValid(answerId)
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid question or answer ID.",
      });
    }

    const question = await CourseForum.findById(questionId)
      .populate("userId", "name type");

    if (!question) {
      return res.status(404).send({
        success: false,
        message: "Question not found.",
      });
    }

    if (String(question.userId._id || question.userId) !== String(userId)) {
      return res.status(403).send({
        success: false,
        message: "Only the question author can accept an answer.",
      });
    }

    const answer = question.answers.id(answerId);
    if (!answer) {
      return res.status(404).send({
        success: false,
        message: "Answer not found.",
      });
    }

    question.answers.forEach((a) => {
      a.isAccepted = false;
    });

    answer.isAccepted = !answer.isAccepted;
    question.isResolved = question.answers.some((a) => a.isAccepted);
    await question.save();

    await question.populate("answers.userId", "name type");

    return res.status(200).send({
      success: true,
      message: answer.isAccepted
        ? "Answer accepted."
        : "Acceptance removed.",
      data: {
        isResolved: question.isResolved,
        acceptedAnswerId: answer.isAccepted ? answerId : null,
      },
    });
  } catch (error) {
    console.error("Unable to toggle answer acceptance:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to update answer acceptance.",
    });
  }
};

// ─── Toggle Upvote Answer ──────────────────────────────────────────

const toggleUpvoteAnswer = async (req, res) => {
  try {
    const { questionId, answerId } = req.params;
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return res.status(400).send({
        success: false,
        message: "Authentication required.",
      });
    }

    if (
      !mongoose.Types.ObjectId.isValid(questionId) ||
      !mongoose.Types.ObjectId.isValid(answerId)
    ) {
      return res.status(400).send({
        success: false,
        message: "Invalid question or answer ID.",
      });
    }

    const question = await CourseForum.findById(questionId);
    if (!question) {
      return res.status(404).send({
        success: false,
        message: "Question not found.",
      });
    }

    const answer = question.answers.id(answerId);
    if (!answer) {
      return res.status(404).send({
        success: false,
        message: "Answer not found.",
      });
    }

    if (String(answer.userId) === String(userId)) {
      return res.status(400).send({
        success: false,
        message: "You cannot upvote your own answer.",
      });
    }

    const alreadyUpvoted = (answer.upvotedBy || []).some(
      (id) => String(id) === String(userId),
    );

    if (alreadyUpvoted) {
      answer.upvotedBy = answer.upvotedBy.filter(
        (id) => String(id) !== String(userId),
      );
      answer.upvotes = Math.max(0, (answer.upvotes || 0) - 1);
    } else {
      answer.upvotedBy.push(userId);
      answer.upvotes = (answer.upvotes || 0) + 1;
    }

    await question.save();

    return res.status(200).send({
      success: true,
      data: {
        upvotes: answer.upvotes,
        hasUpvoted: !alreadyUpvoted,
      },
    });
  } catch (error) {
    console.error("Unable to toggle upvote:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to update upvote.",
    });
  }
};

// ─── Get Forum Stats ───────────────────────────────────────────────

const getForumStats = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!validateCourseId(courseId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid course ID.",
      });
    }

    const [stats] = await CourseForum.aggregate([
      { $match: { courseId: new mongoose.Types.ObjectId(courseId) } },
      {
        $group: {
          _id: null,
          totalQuestions: { $sum: 1 },
          resolved: {
            $sum: { $cond: ["$isResolved", 1, 0] },
          },
          totalAnswers: { $sum: { $size: "$answers" } },
          totalViews: { $sum: "$viewCount" },
        },
      },
    ]);

    return res.status(200).send({
      success: true,
      data: stats
        ? {
            totalQuestions: stats.totalQuestions,
            resolved: stats.resolved,
            unanswered: stats.totalQuestions - stats.resolved,
            totalAnswers: stats.totalAnswers,
            totalViews: stats.totalViews,
          }
        : {
            totalQuestions: 0,
            resolved: 0,
            unanswered: 0,
            totalAnswers: 0,
            totalViews: 0,
          },
    });
  } catch (error) {
    console.error("Unable to retrieve forum stats:", error);
    return res.status(500).send({
      success: false,
      message: "Unable to retrieve forum statistics.",
    });
  }
};

module.exports = {
  createQuestion,
  listQuestions,
  getQuestion,
  deleteQuestion,
  addAnswer,
  deleteAnswer,
  toggleAcceptAnswer,
  toggleUpvoteAnswer,
  getForumStats,
};
