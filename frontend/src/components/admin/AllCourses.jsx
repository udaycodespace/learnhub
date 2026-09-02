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
import useAdminList from '../../hooks/useAdminList';
import '../../styles/admin-lists.css';
import {
  COURSE_SORT_OPTIONS,
  buildCourseParams,
  describeAdminRange,
  formatAdminDate,
  readAdminCourses,
} from '../../lib/adminListing';

// #96. This table fetched every course in the database on mount and rendered
// all of them, with no loading state, a blocking alert() on a handled failure,
// a bare console.log on a thrown one, and `{Course.sections.length}` — which is
// `undefined` when `sections` is an object map and a TypeError when the field
// is absent. Its empty state read "No users found".

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

const EMPTY_TOAST = { message: '', type: 'info' };

const AllCourses = () => {
  const {
    rows: courses,
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
    url: '/api/admin/getallcourses',
    buildParams: buildCourseParams,
    readRows: readAdminCourses,
    initialFilters: { priceType: '' },
    errorMessage: 'The course list could not be loaded.',
  });

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [toast, setToast] = useState(EMPTY_TOAST);

  const dismissToast = useCallback(() => setToast(EMPTY_TOAST), []);

  const confirmDelete = async () => {
    const course = pendingDelete;

    if (!course) return;

    setPendingDelete(null);
    setDeletingId(course.id);

    try {
      const res = await axiosInstance.delete(
        `/api/admin/deletecourse/${course.id}`,
      );

      if (res.data?.success) {
        setToast({ message: `“${course.title}” was deleted.`, type: 'success' });
        reload();
      } else {
        setToast({
          message: res.data?.message || 'The course could not be deleted.',
          type: 'error',
        });
      }
    } catch (requestError) {
      setToast({
        message:
          requestError.response?.data?.message ||
          'The course could not be deleted.',
        type: 'error',
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section aria-labelledby="admin-courses-title">
      <h1 id="admin-courses-title" style={{ marginBottom: '18px' }}>
        Published courses
      </h1>

      <div className="admin-toolbar">
        <label className="catalog-search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <span className="sr-only">Search courses</span>
          <input
            type="search"
            placeholder="Search every course by title or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="catalog-filter">
          <span>Access</span>
          <select
            value={filters.priceType}
            onChange={(event) => setFilter('priceType', event.target.value)}
            aria-label="Filter courses by access type"
          >
            <option value="">All courses</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>

        <label className="catalog-filter">
          <span>Sort</span>
          <select
            value={filters.sort}
            onChange={(event) => setFilter('sort', event.target.value)}
            aria-label="Sort courses"
          >
            {COURSE_SORT_OPTIONS.map((option) => (
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

      {/* A handled failure used to pop an alert(); a thrown one was a
          console.log and a permanently empty table. */}
      {error ? (
        <div className="course-state course-state-error" role="alert">
          <h3>The course list could not be loaded</h3>
          <p>{error}</p>
          <button type="button" className="button button-ink" onClick={reload}>
            Try again
          </button>
        </div>
      ) : loading && courses.length === 0 ? (
        <p role="status">Loading courses…</p>
      ) : (
        <>
          <TableContainer component={Paper}>
            <Table sx={{ minWidth: 700 }} aria-label="Published courses">
              <TableHead>
                <TableRow>
                  <StyledTableCell>Course</StyledTableCell>
                  <StyledTableCell align="left">Educator</StyledTableCell>
                  <StyledTableCell align="left">Category</StyledTableCell>
                  <StyledTableCell align="left">Price</StyledTableCell>
                  <StyledTableCell align="left">Sections</StyledTableCell>
                  <StyledTableCell align="left">Enrolled</StyledTableCell>
                  <StyledTableCell align="left">Published</StyledTableCell>
                  <StyledTableCell align="center">Action</StyledTableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {courses.length > 0 ? (
                  courses.map((course) => (
                    <StyledTableRow key={course.id}>
                      <StyledTableCell component="th" scope="row">
                        {course.title}
                      </StyledTableCell>
                      <StyledTableCell>{course.educator}</StyledTableCell>
                      <StyledTableCell>{course.category}</StyledTableCell>
                      <StyledTableCell>{course.price}</StyledTableCell>
                      {/* Computed server-side, so no shape of `sections` can
                          blank this cell or take the page down. */}
                      <StyledTableCell>{course.sectionCount}</StyledTableCell>
                      <StyledTableCell>{course.enrolled}</StyledTableCell>
                      <StyledTableCell>
                        {formatAdminDate(course.createdAt)}
                      </StyledTableCell>
                      <StyledTableCell align="center">
                        <Button
                          onClick={() => setPendingDelete(course)}
                          size="small"
                          color="error"
                          disabled={deletingId === course.id}
                        >
                          {deletingId === course.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </StyledTableCell>
                    </StyledTableRow>
                  ))
                ) : (
                  <StyledTableRow>
                    <StyledTableCell colSpan={8}>
                      {/* This used to read "No users found". */}
                      {hasFilters
                        ? 'No courses match those filters'
                        : 'No courses have been published yet'}
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
            {describeAdminRange(pagination, courses.length, 'courses')}
          </p>

          <CatalogPager
            pagination={pagination}
            onPageChange={goToPage}
            disabled={loading}
            label="Course list pages"
          />
        </>
      )}

      <ConfirmDialog
        request={
          pendingDelete
            ? createConfirmRequest({
                title: "Delete this course?",
                consequence: `“${pendingDelete.title}” and its section videos will be removed, along with every enrolment, payment, review and bookmark that referenced it. This cannot be undone.`,
                confirmLabel: "Delete course",
                onConfirm: confirmDelete,
              })
            : null
        }
        onCancel={() => setPendingDelete(null)}
      />

      <Toast message={toast.message} type={toast.type} onClose={dismissToast} />
    </section>
  );
};

export default AllCourses;
