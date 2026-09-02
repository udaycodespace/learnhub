import { useCallback, useState } from 'react';
import {
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  styled,
  tableCellClasses,
} from '@mui/material';

import axiosInstance from '../common/AxiosInstance';
import CatalogPager from '../common/CatalogPager';
import Toast from '../common/Toast';
import ConfirmDialog from '../common/ConfirmDialog';
import { createConfirmRequest } from '../../lib/confirmDialog';
import PaymentRecords from './PaymentRecords';
import ActivityLogs from './ActivityLogs';
import useAdminList from '../../hooks/useAdminList';
import '../../styles/admin-lists.css';
import {
  USER_ROLE_OPTIONS,
  USER_SORT_OPTIONS,
  buildUserParams,
  describeAdminRange,
  describeRoleSummary,
  formatAdminDate,
  readRoleSummary,
  readUsers,
} from '../../lib/adminListing';

// #96. The users table called /api/admin/getallusers bare and rendered every
// account it returned as a table row. The endpoint is paginated and searchable
// now, so finding one account no longer means Ctrl-F against a fully
// materialised DOM.

const StyledTableCell = styled(TableCell)(({ theme }) => ({
  [`&.${tableCellClasses.head}`]: {
    backgroundColor: theme.palette.common.black,
    color: theme.palette.common.white,
  },
  [`&.${tableCellClasses.body}`]: {
    fontSize: 14,
  },
}));

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:nth-of-type(odd)': {
    backgroundColor: theme.palette.action.hover,
  },
  '&:last-child td, &:last-child th': {
    border: 0,
  },
}));

const TABS = [
  { key: 'users', label: 'Users' },
  { key: 'payments', label: 'Payments' },
  { key: 'activity-logs', label: 'Activity Logs' },
];

const EMPTY_TOAST = { message: '', type: 'info' };

const AdminHome = () => {
  const [activeSection, setActiveSection] = useState('users');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [toast, setToast] = useState(EMPTY_TOAST);

  const {
    rows: users,
    summary,
    pagination,
    loading,
    error,
    search,
    setSearch,
    filters,
    setFilter,
    clearFilters,
    goToPage,
    reload,
    hasFilters,
    searchPending,
  } = useAdminList({
    url: '/api/admin/getallusers',
    buildParams: buildUserParams,
    readRows: readUsers,
    readSummary: readRoleSummary,
    initialFilters: { role: '' },
    errorMessage: 'Unable to load users.',
  });

  const dismissToast = useCallback(() => setToast(EMPTY_TOAST), []);

  const confirmDelete = async () => {
    const user = pendingDelete;

    if (!user) return;

    setPendingDelete(null);
    setDeletingId(user.id);

    try {
      // This call previously passed a second URL where axios expects the
      // request config, so the config argument that carried the auth header
      // was silently discarded.
      const response = await axiosInstance.delete(
        `/api/admin/deleteuser/${user.id}`,
      );

      if (response.data?.success) {
        setToast({ message: `${user.name} was deleted.`, type: 'success' });
        reload();
      } else {
        setToast({
          message: response.data?.message || 'Failed to delete the user.',
          type: 'error',
        });
      }
    } catch (requestError) {
      setToast({
        message:
          requestError.response?.data?.message || 'Failed to delete the user.',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main>
      <nav
        aria-label="Admin dashboard sections"
        className="admin-tabs-nav"
        style={{
          display: 'flex',
          gap: '8px',
          padding: '16px',
          overflowX: 'auto',
        }}
      >
        {TABS.map((tab) => (
          <Button
            key={tab.key}
            className={`admin-tab-btn${activeSection === tab.key ? ' admin-tab-btn-active' : ''}`}
            variant={activeSection === tab.key ? 'contained' : 'outlined'}
            onClick={() => setActiveSection(tab.key)}
          >
            {tab.label}
          </Button>
        ))}
      </nav>

      {activeSection === 'payments' ? (
        <PaymentRecords />
      ) : activeSection === 'activity-logs' ? (
        <ActivityLogs />
      ) : (
        <section style={{ padding: '20px' }} aria-labelledby="users-title">
          <h1 id="users-title" style={{ marginBottom: '6px' }}>
            Registered users
          </h1>

          {/* Counted by the database across every account, not by the browser
              across the ones it happened to load. */}
          <p className="admin-summary" aria-live="polite">
            {describeRoleSummary(summary)}
          </p>

          <div className="admin-toolbar">
            <label className="catalog-search">
              <span className="search-icon" aria-hidden="true">⌕</span>
              <span className="sr-only">Search users</span>
              <input
                type="search"
                placeholder="Search every account by name or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <label className="catalog-filter">
              <span>Role</span>
              <select
                value={filters.role}
                onChange={(event) => setFilter('role', event.target.value)}
                aria-label="Filter users by role"
              >
                {USER_ROLE_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="catalog-filter">
              <span>Sort</span>
              <select
                value={filters.sort}
                onChange={(event) => setFilter('sort', event.target.value)}
                aria-label="Sort users"
              >
                {USER_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {searchPending ? (
              <span className="admin-search-pending" aria-live="polite">
                Searching…
              </span>
            ) : null}
          </div>

          {error ? (
            <div className="course-state course-state-error" role="alert">
              <h3>Users could not be loaded</h3>
              <p>{error}</p>
              <button type="button" className="button button-ink" onClick={reload}>
                Try again
              </button>
            </div>
          ) : loading && users.length === 0 ? (
            <p role="status">Loading users…</p>
          ) : (
            <>
              <TableContainer component={Paper}>
                <Table sx={{ minWidth: 700 }} aria-label="Registered users">
                  <TableHead>
                    <TableRow>
                      <StyledTableCell>Name</StyledTableCell>
                      <StyledTableCell align="left">Email</StyledTableCell>
                      <StyledTableCell align="left">Role</StyledTableCell>
                      <StyledTableCell align="left">Verified</StyledTableCell>
                      <StyledTableCell align="left">Joined</StyledTableCell>
                      <StyledTableCell align="left">Action</StyledTableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.length > 0 ? (
                      users.map((user) => (
                        <StyledTableRow key={user.id}>
                          <StyledTableCell component="th" scope="row">
                            {user.name}
                          </StyledTableCell>
                          <StyledTableCell>{user.email}</StyledTableCell>
                          <StyledTableCell>{user.role}</StyledTableCell>
                          <StyledTableCell>
                            {user.verified ? 'Yes' : 'No'}
                          </StyledTableCell>
                          <StyledTableCell>
                            {formatAdminDate(user.createdAt)}
                          </StyledTableCell>
                          <StyledTableCell>
                            <Button
                              onClick={() => setPendingDelete(user)}
                              size="small"
                              color="error"
                              disabled={deletingId === user.id}
                            >
                              {deletingId === user.id ? 'Deleting…' : 'Delete'}
                            </Button>
                          </StyledTableCell>
                        </StyledTableRow>
                      ))
                    ) : (
                      <StyledTableRow>
                        <StyledTableCell colSpan={6}>
                          {hasFilters
                            ? 'No accounts match those filters'
                            : 'No users found'}
                          {hasFilters ? (
                            <button
                              type="button"
                              className="button button-outline admin-inline-button"
                              onClick={clearFilters}
                            >
                              Clear filters
                            </button>
                          ) : null}
                        </StyledTableCell>
                      </StyledTableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <p className="catalog-range" aria-live="polite">
                {describeAdminRange(pagination, users.length, 'accounts')}
              </p>

              <CatalogPager
                pagination={pagination}
                onPageChange={goToPage}
                disabled={loading}
                label="User list pages"
              />
            </>
          )}
        </section>
      )}

      <ConfirmDialog
        request={
          pendingDelete
            ? createConfirmRequest({
                title: "Delete this account?",
                consequence: `${pendingDelete.name} (${pendingDelete.email}) will be removed, along with their enrolments, payments, reviews, bookmarks and activity log — and, for an educator, their courses and every section video on disk. This cannot be undone.`,
                confirmLabel: "Delete account",
                onConfirm: confirmDelete,
              })
            : null
        }
        onCancel={() => setPendingDelete(null)}
      />

      <Toast message={toast.message} type={toast.type} onClose={dismissToast} />
    </main>
  );
};

export default AdminHome;
