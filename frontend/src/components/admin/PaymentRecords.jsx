import React, { useCallback, useEffect, useMemo, useState } from "react";
import axiosInstance from "../common/AxiosInstance";
import "./PaymentRecords.css";

const initialFilters = {
  search: "",
  status: "",
  startDate: "",
  endDate: "",
  sort: "newest",
  limit: "10",
};

const formatCurrency = (amount, currency = "INR") =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));

const formatDateTime = (value) => {
  if (!value) return "Not recorded";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatStatus = (status) => {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
};

const PaymentRecords = () => {
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState({
    totalTransactions: 0,
    successful: 0,
    pending: 0,
    failed: 0,
    totalRevenue: 0,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  const [page, setPage] = useState(1);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: appliedFilters.limit,
      sort: appliedFilters.sort,
    });

    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (value && !["limit", "sort"].includes(key)) {
        params.set(key, value);
      }
    });

    return params.toString();
  }, [appliedFilters, page]);

  const loadPayments = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError("");

      try {
        const response = await axiosInstance.get(
          `api/admin/payments?${queryString}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
        );

        if (!response.data.success) {
          throw new Error(response.data.message);
        }

        setPayments(response.data.data || []);
        setSummary(response.data.summary);
        setPagination(response.data.pagination);
      } catch (requestError) {
        setError(
          requestError.response?.data?.message ||
            "Payment records could not be loaded. Please try again.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [queryString],
  );

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    if (!selectedPayment) return undefined;

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setSelectedPayment(null);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedPayment]);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;

    setDraftFilters((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const applyFilters = (event) => {
    event.preventDefault();

    if (
      draftFilters.startDate &&
      draftFilters.endDate &&
      draftFilters.startDate > draftFilters.endDate
    ) {
      setError("Start date cannot be after end date.");
      return;
    }

    setError("");
    setPage(1);
    setAppliedFilters(draftFilters);
  };

  const clearFilters = () => {
    setDraftFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setPage(1);
  };

  const startItem =
    pagination.totalItems === 0
      ? 0
      : (pagination.page - 1) * pagination.limit + 1;
  const endItem = Math.min(
    pagination.page * pagination.limit,
    pagination.totalItems,
  );

  const summaryCards = [
    {
      label: "Transactions",
      value: summary.totalTransactions,
      hint: "Filtered records",
      tone: "ink",
    },
    {
      label: "Successful",
      value: summary.successful,
      hint: "Completed mock payments",
      tone: "green",
    },
    {
      label: "Pending / failed",
      value: `${summary.pending} / ${summary.failed}`,
      hint: "Needs attention",
      tone: "orange",
    },
    {
      label: "Mock revenue",
      value: formatCurrency(summary.totalRevenue),
      hint: "Successful transactions only",
      tone: "blue",
    },
  ];

  return (
    <section className="payments-page" aria-labelledby="payments-title">
      <header className="payments-header">
        <div>
          <p className="payments-eyebrow">ADMIN FINANCE</p>
          <h1 id="payments-title">Payment records</h1>
          <p>
            Review mock course transactions through sanitized records. Full
            card numbers and CVV values never appear in this interface.
          </p>
        </div>

        <button
          type="button"
          className="payments-refresh"
          onClick={() => loadPayments(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="payments-summary-grid">
        {summaryCards.map((card) => (
          <article
            key={card.label}
            className={`payments-summary-card payments-summary-${card.tone}`}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.hint}</small>
          </article>
        ))}
      </div>

      <form className="payments-filters" onSubmit={applyFilters}>
        <label className="payments-search">
          <span>Search</span>
          <input
            type="search"
            name="search"
            value={draftFilters.search}
            onChange={handleFilterChange}
            placeholder="Email, transaction ID, or course"
          />
        </label>

        <label>
          <span>Status</span>
          <select
            name="status"
            value={draftFilters.status}
            onChange={handleFilterChange}
          >
            <option value="">All statuses</option>
            <option value="successful">Successful</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </label>

        <label>
          <span>From</span>
          <input
            type="date"
            name="startDate"
            value={draftFilters.startDate}
            onChange={handleFilterChange}
          />
        </label>

        <label>
          <span>To</span>
          <input
            type="date"
            name="endDate"
            value={draftFilters.endDate}
            onChange={handleFilterChange}
          />
        </label>

        <label>
          <span>Sort</span>
          <select
            name="sort"
            value={draftFilters.sort}
            onChange={handleFilterChange}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="amount-desc">Amount: high to low</option>
            <option value="amount-asc">Amount: low to high</option>
          </select>
        </label>

        <label>
          <span>Rows</span>
          <select
            name="limit"
            value={draftFilters.limit}
            onChange={handleFilterChange}
          >
            <option value="10">10 rows</option>
            <option value="20">20 rows</option>
            <option value="50">50 rows</option>
          </select>
        </label>

        <div className="payments-filter-actions">
          <button type="submit" className="payments-primary">
            Apply filters
          </button>
          <button
            type="button"
            className="payments-secondary"
            onClick={clearFilters}
          >
            Clear
          </button>
        </div>
      </form>

      {error ? (
        <div className="payments-error" role="alert">
          <strong>Unable to show payment records</strong>
          <p>{error}</p>
          <button type="button" onClick={() => loadPayments(true)}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="payments-skeleton" role="status">
          <span className="sr-only">Loading payment records</span>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} />
          ))}
        </div>
      ) : payments.length === 0 && !error ? (
        <div className="payments-empty">
          <span aria-hidden="true">₹</span>
          <h2>No payment records found</h2>
          <p>Try clearing the filters or enrolling in a paid demo course.</p>
        </div>
      ) : !error ? (
        <>
          <div className="payments-table-summary" aria-live="polite">
            <span>
              Showing <strong>{startItem}</strong>–<strong>{endItem}</strong>{" "}
              of <strong>{pagination.totalItems}</strong>
            </span>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
          </div>

          <div className="payments-table-wrapper">
            <table className="payments-table">
              <caption className="sr-only">
                Sanitized mock payment transactions
              </caption>
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Student</th>
                  <th>Course</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Transaction">
                      <code>{payment.id.slice(-10)}</code>
                    </td>
                    <td data-label="Student">
                      <strong>
                        {payment.student.name || payment.student.email}
                      </strong>
                      {payment.student.name ? (
                        <small>{payment.student.email}</small>
                      ) : null}
                    </td>
                    <td data-label="Course">{payment.course.title}</td>
                    <td data-label="Amount">
                      {formatCurrency(payment.amount, payment.currency)}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`payment-status payment-status-${payment.status}`}
                      >
                        {formatStatus(payment.status)}
                      </span>
                    </td>
                    <td data-label="Created">
                      {formatDateTime(payment.createdAt)}
                    </td>
                    <td data-label="Details">
                      <button
                        type="button"
                        className="payment-details-button"
                        onClick={() => setSelectedPayment(payment)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="payments-pagination" aria-label="Payment pages">
            <button
              type="button"
              disabled={!pagination.hasPreviousPage}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              ← Previous
            </button>
            <span>
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={!pagination.hasNextPage}
              onClick={() => setPage((current) => current + 1)}
            >
              Next →
            </button>
          </nav>
        </>
      ) : null}

      {selectedPayment ? (
        <div
          className="payment-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedPayment(null);
            }
          }}
        >
          <section
            className="payment-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-dialog-title"
          >
            <div className="payment-dialog-header">
              <div>
                <p>SAFE TRANSACTION DETAILS</p>
                <h2 id="payment-dialog-title">
                  {selectedPayment.course.title}
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close transaction details"
                onClick={() => setSelectedPayment(null)}
              >
                ×
              </button>
            </div>

            <dl>
              <div>
                <dt>Transaction ID</dt>
                <dd>{selectedPayment.id}</dd>
              </div>
              <div>
                <dt>Student</dt>
                <dd>{selectedPayment.student.email}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>
                  {formatCurrency(
                    selectedPayment.amount,
                    selectedPayment.currency,
                  )}
                </dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{formatStatus(selectedPayment.status)}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDateTime(selectedPayment.createdAt)}</dd>
              </div>
              <div>
                <dt>Card identifier</dt>
                <dd>{selectedPayment.maskedCard || "Not available"}</dd>
              </div>
            </dl>

            <p className="payment-security-note">
              Full card numbers, CVV values, expiry values, passwords, and
              authentication tokens are intentionally excluded.
            </p>
          </section>
        </div>
      ) : null}
    </section>
  );
};

export default PaymentRecords;
