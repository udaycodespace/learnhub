import React, { useCallback, useEffect, useMemo, useState } from "react";
import axiosInstance from "../common/AxiosInstance";
import "./ActivityLogs.css";

const initialFilters = {
  search: "",
  role: "",
  activity: "",
  startDate: "",
  endDate: "",
  sort: "newest",
  limit: "10",
};

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

const formatRole = (role) => {
  if (!role) return "Unknown";
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
};

const deviceLabel = (userAgent) => {
  if (!userAgent) return "Not recorded";

  if (/mobile|android|iphone|ipad/i.test(userAgent)) {
    return "Mobile device";
  }

  if (/windows/i.test(userAgent)) return "Windows device";
  if (/macintosh|mac os/i.test(userAgent)) return "macOS device";
  if (/linux/i.test(userAgent)) return "Linux device";

  return "Web browser";
};

const ActivityLogs = () => {
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 1,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  const [page, setPage] = useState(1);
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

  const loadLogs = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError("");

      try {
        const response = await axiosInstance.get(
          `api/admin/activity-logs?${queryString}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          },
        );

        if (!response.data.success) {
          throw new Error(response.data.message);
        }

        setLogs(response.data.data || []);
        setPagination(response.data.pagination);
      } catch (requestError) {
        const message =
          requestError.response?.data?.message ||
          "Activity logs could not be loaded. Please try again.";

        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [queryString],
  );

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

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

  return (
    <section className="activity-log-page" aria-labelledby="activity-log-title">
      <header className="activity-log-header">
        <div>
          <p className="activity-log-eyebrow">ADMIN SECURITY</p>
          <h1 id="activity-log-title">Activity logs</h1>
          <p>
            Review authentication activity without opening MongoDB or exposing
            credentials.
          </p>
        </div>

        <button
          type="button"
          className="activity-refresh-button"
          onClick={() => loadLogs(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <form className="activity-filter-panel" onSubmit={applyFilters}>
        <label className="activity-search-field">
          <span>Search</span>
          <input
            type="search"
            name="search"
            value={draftFilters.search}
            onChange={handleFilterChange}
            placeholder="Email, role, device, or IP"
          />
        </label>

        <label>
          <span>Role</span>
          <select
            name="role"
            value={draftFilters.role}
            onChange={handleFilterChange}
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="teacher">Teacher</option>
            <option value="student">Student</option>
          </select>
        </label>

        <label>
          <span>Activity</span>
          <select
            name="activity"
            value={draftFilters.activity}
            onChange={handleFilterChange}
          >
            <option value="">All activity</option>
            <option value="login">Login</option>
            <option value="logout">Logout</option>
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
          <span>Order</span>
          <select
            name="sort"
            value={draftFilters.sort}
            onChange={handleFilterChange}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
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

        <div className="activity-filter-actions">
          <button type="submit" className="activity-primary-button">
            Apply filters
          </button>
          <button
            type="button"
            className="activity-secondary-button"
            onClick={clearFilters}
          >
            Clear
          </button>
        </div>
      </form>

      {error ? (
        <div className="activity-error-state" role="alert">
          <strong>Unable to show activity</strong>
          <p>{error}</p>
          <button type="button" onClick={() => loadLogs(true)}>
            Try again
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="activity-skeleton-list" role="status">
          <span className="sr-only">Loading activity logs</span>
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="activity-skeleton-row" key={index} />
          ))}
        </div>
      ) : logs.length === 0 && !error ? (
        <div className="activity-empty-state">
          <span aria-hidden="true">◎</span>
          <h2>No activity logs found</h2>
          <p>Try clearing filters or signing in with a demo account.</p>
        </div>
      ) : !error ? (
        <>
          <div className="activity-table-summary" aria-live="polite">
            <span>
              Showing <strong>{startItem}</strong>–<strong>{endItem}</strong> of{" "}
              <strong>{pagination.totalItems}</strong>
            </span>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
          </div>

          <div className="activity-table-wrapper">
            <table className="activity-table">
              <caption className="sr-only">
                Administrative authentication activity
              </caption>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Activity</th>
                  <th>Date and time</th>
                  <th>IP address</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td data-label="User">
                      <strong>{log.user.name || log.user.email}</strong>
                      {log.user.name ? <small>{log.user.email}</small> : null}
                    </td>
                    <td data-label="Role">
                      <span className="activity-role-badge">
                        {formatRole(log.user.role)}
                      </span>
                    </td>
                    <td data-label="Activity">
                      <span
                        className={`activity-action-badge activity-action-${log.activity}`}
                      >
                        {log.activity}
                      </span>
                    </td>
                    <td data-label="Date and time">
                      {formatDateTime(log.timestamp)}
                    </td>
                    <td data-label="IP address">
                      <code>{log.ipAddress || "Not recorded"}</code>
                    </td>
                    <td data-label="Device" title={log.userAgent || ""}>
                      {deviceLabel(log.userAgent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="activity-pagination" aria-label="Activity log pages">
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
    </section>
  );
};

export default ActivityLogs;
