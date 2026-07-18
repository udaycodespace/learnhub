const mongoose = require("mongoose");
const coursePaymentSchema = require("../schemas/coursePaymentModel");

const ALLOWED_STATUSES = new Set([
  "successful",
  "pending",
  "failed",
]);

const ALLOWED_SORTS = new Set([
  "newest",
  "oldest",
  "amount-asc",
  "amount-desc",
]);

const escapeRegex = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parsePositiveInteger = (value, fallback, maximum) => {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
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

const parseAmount = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseFloat(
    String(value || "").replace(/[^0-9.-]/g, ""),
  );

  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeStatus = (status) => {
  const normalized = String(status || "").trim().toLowerCase();

  if (
    ["success", "successful", "completed", "paid", "enrolled"].includes(
      normalized,
    )
  ) {
    return "successful";
  }

  if (["failed", "declined", "rejected", "cancelled"].includes(normalized)) {
    return "failed";
  }

  return "pending";
};

const maskCardNumber = (cardNumber) => {
  const digits = String(cardNumber || "").replace(/\D/g, "");

  if (digits.length < 4) {
    return null;
  }

  return `•••• •••• •••• ${digits.slice(-4)}`;
};

const buildSanitizedPayment = (payment) => {
  const amount = parseAmount(payment.courseId?.C_price);
  const safeStatus = normalizeStatus(payment.status);

  return {
    id: String(payment._id),
    student: {
      id: payment.userId?._id ? String(payment.userId._id) : null,
      name: payment.userId?.name || null,
      email: payment.userId?.email || "Unknown",
    },
    course: {
      id: payment.courseId?._id ? String(payment.courseId._id) : null,
      title: payment.courseId?.C_title || "Deleted or unavailable course",
    },
    amount,
    currency: "INR",
    status: safeStatus,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null,
    maskedCard: maskCardNumber(payment.cardDetails?.cardnumber),
  };
};

const getAdminPaymentsController = async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1, 100000);
    const limit = parsePositiveInteger(req.query.limit, 10, 50);
    const search = String(req.query.search || "").trim().slice(0, 120);
    const status = String(req.query.status || "").trim().toLowerCase();
    const sort = String(req.query.sort || "newest").trim().toLowerCase();

    if (status && !ALLOWED_STATUSES.has(status)) {
      return res.status(400).send({
        success: false,
        message: "Invalid payment status filter.",
      });
    }

    if (!ALLOWED_SORTS.has(sort)) {
      return res.status(400).send({
        success: false,
        message: "Invalid payment sort option.",
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

    const match = {};

    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = startDate;
      if (endDate) match.createdAt.$lte = endDate;
    }

    const records = await coursePaymentSchema
      .find(match)
      .select(
        "_id userId courseId status createdAt updatedAt +cardDetails.cardnumber",
      )
      .populate("userId", "name email")
      .populate("courseId", "C_title C_price")
      .lean();

    let sanitizedPayments = records.map(buildSanitizedPayment);

    if (search) {
      const safeSearch = escapeRegex(search);
      const searchPattern = new RegExp(safeSearch, "i");

      sanitizedPayments = sanitizedPayments.filter((payment) =>
        [
          payment.id,
          payment.student.email,
          payment.student.name,
          payment.course.title,
        ].some((field) => searchPattern.test(String(field || ""))),
      );
    }

    if (status) {
      sanitizedPayments = sanitizedPayments.filter(
        (payment) => payment.status === status,
      );
    }

    const sorters = {
      newest: (a, b) =>
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      oldest: (a, b) =>
        new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
      "amount-asc": (a, b) => a.amount - b.amount,
      "amount-desc": (a, b) => b.amount - a.amount,
    };

    sanitizedPayments.sort(sorters[sort]);

    const summary = sanitizedPayments.reduce(
      (current, payment) => {
        current.totalTransactions += 1;
        current[payment.status] += 1;

        if (payment.status === "successful") {
          current.totalRevenue += payment.amount;
        }

        return current;
      },
      {
        totalTransactions: 0,
        successful: 0,
        pending: 0,
        failed: 0,
        totalRevenue: 0,
      },
    );

    const totalItems = sanitizedPayments.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);
    const startIndex = (safePage - 1) * limit;
    const paginatedPayments = sanitizedPayments.slice(
      startIndex,
      startIndex + limit,
    );

    return res.status(200).send({
      success: true,
      data: paginatedPayments,
      summary,
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
        status,
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
        sort,
      },
    });
  } catch (error) {
    console.error("Unable to retrieve payment records:", error);

    return res.status(500).send({
      success: false,
      message: "Unable to retrieve payment records.",
    });
  }
};

module.exports = {
  getAdminPaymentsController,
};
