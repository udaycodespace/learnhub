const ActivityLog = require("../schemas/activityLogModel");

const ALLOWED_ACTIONS = new Set(["login", "logout"]);
const ALLOWED_ROLES = new Set(["admin", "student", "teacher"]);
const ALLOWED_SORTS = new Set(["newest", "oldest"]);

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePositiveInteger = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const parseDateBoundary = (value, endOfDay = false) => {
  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed.setHours(23, 59, 59, 999);
  }

  return parsed;
};

const getActivityLogsController = async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const limit = parsePositiveInteger(req.query.limit, 10, 50);

    const search = String(req.query.search || "").trim().slice(0, 120);
    const action = String(req.query.activity || "").trim().toLowerCase();
    const role = String(req.query.role || "").trim().toLowerCase();
    const sort = String(req.query.sort || "newest").trim().toLowerCase();

    if (action && !ALLOWED_ACTIONS.has(action)) {
      return res.status(400).send({
        success: false,
        message: "Invalid activity filter.",
      });
    }

    if (role && !ALLOWED_ROLES.has(role)) {
      return res.status(400).send({
        success: false,
        message: "Invalid role filter.",
      });
    }

    if (!ALLOWED_SORTS.has(sort)) {
      return res.status(400).send({
        success: false,
        message: "Invalid sort option.",
      });
    }

    const startDate = parseDateBoundary(req.query.startDate);
    const endDate = parseDateBoundary(req.query.endDate, true);

    if (req.query.startDate && !startDate) {
      return res.status(400).send({
        success: false,
        message: "Invalid start date.",
      });
    }

    if (req.query.endDate && !endDate) {
      return res.status(400).send({
        success: false,
        message: "Invalid end date.",
      });
    }

    if (startDate && endDate && startDate > endDate) {
      return res.status(400).send({
        success: false,
        message: "Start date cannot be after end date.",
      });
    }

    const query = {};

    if (action) {
      query.action = action;
    }

    if (role) {
      query.role = new RegExp(`^${escapeRegex(role)}$`, "i");
    }

    if (startDate || endDate) {
      query.timestamp = {};

      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), "i");

      query.$or = [
        { email: searchRegex },
        { role: searchRegex },
        { action: searchRegex },
        { ipAddress: searchRegex },
        { userAgent: searchRegex },
      ];
    }

    const totalItems = await ActivityLog.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;

    const logs = await ActivityLog.find(query)
      .select(
        "userId action timestamp role email ipAddress userAgent createdAt",
      )
      .populate("userId", "name email type")
      .sort({ timestamp: sort === "oldest" ? 1 : -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const sanitizedLogs = logs.map((log) => ({
      id: String(log._id),
      user: {
        id: log.userId?._id ? String(log.userId._id) : null,
        name: log.userId?.name || null,
        email: log.email || log.userId?.email || "Unknown",
        role: log.role || log.userId?.type || "Unknown",
      },
      activity: log.action,
      timestamp: log.timestamp || log.createdAt,
      ipAddress: log.ipAddress || null,
      userAgent: log.userAgent || null,
    }));

    return res.status(200).send({
      success: true,
      data: sanitizedLogs,
      pagination: {
        page: safePage,
        limit,
        totalItems,
        totalPages,
        hasPreviousPage: safePage > 1,
        hasNextPage: safePage < totalPages,
      },
      filters: {
        search,
        activity: action,
        role,
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
        sort,
      },
    });
  } catch (error) {
    console.error("Unable to retrieve activity logs:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to retrieve activity logs.",
    });
  }
};

module.exports = {
  getActivityLogsController,
};
