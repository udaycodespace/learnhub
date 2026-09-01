import { useCallback, useState } from 'react';
import { Button, Card, Container } from 'react-bootstrap';

import axiosInstance from '../../common/AxiosInstance';
import CatalogPager from '../../common/CatalogPager';
import Toast from '../../common/Toast';
import ConfirmDialog from '../../common/ConfirmDialog';
import { createConfirmRequest } from '../../../lib/confirmDialog';
import useTeacherCourses from '../../../hooks/useTeacherCourses';
import EditCourse from './EditCourse';
import '../../../styles/teacher-dashboard.css';
import {
  SORT_OPTIONS,
  describeEnrolled,
  describeSections,
  describeSummary,
  describeTeacherRange,
  formatPublishedDate,
  previewDescription,
} from '../../../lib/teacherCourses';

// #94. This page called the endpoint on mount, kept whatever came back, and
// swallowed any failure into a console.log — so a 500, a dropped connection or
// an expired token left `allCourses` at [] and rendered the string
// 'No courses found!!'. An educator with twenty courses was told they had none.
//
// It also read `course.sections.length` off the raw document, which is
// `undefined` when `sections` is an object map and throws when the field is
// absent, and cut descriptions at ten characters. The endpoint is paginated
// and projected now, and the section count arrives already computed.

const EMPTY_TOAST = { message: '', type: 'info' };

const TeacherHome = () => {
  const {
    courses,
    summary,
    pagination,
    loading,
    error,
    search,
    setSearch,
    sort,
    setSort,
    goToPage,
    clearSearch,
    reload,
    hasSearch,
    searchPending,
  } = useTeacherCourses();

  const [expanded, setExpanded] = useState({});
  const [deletingId, setDeletingId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  // #127. Delete was the only action on a card, and deleting a course takes
  // every enrolment, payment, review, bookmark and uploaded video with it. It
  // was also the only way to fix a typo in a title.
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(EMPTY_TOAST);

  const dismissToast = useCallback(() => setToast(EMPTY_TOAST), []);

  const toggleDescription = (courseId) => {
    setExpanded((current) => ({ ...current, [courseId]: !current[courseId] }));
  };

  // The native confirm() blocked the tab and was not announced to assistive
  // technology. An in-page confirmation is inspectable and dismissible.
  const confirmDelete = async () => {
    const course = pendingDelete;

    if (!course) return;

    setPendingDelete(null);
    setDeletingId(course.id);

    try {
      const res = await axiosInstance.delete(
        `/api/user/deletecourse/${course.id}`,
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

  if (loading && courses.length === 0) {
    return (
      <Container className="card-container">
        <div className="course-state" role="status">
          <span className="catalog-loader" aria-hidden="true" />
          <h3>Loading your courses…</h3>
        </div>
      </Container>
    );
  }

  // A failed request used to be indistinguishable from having no courses.
  if (error) {
    return (
      <Container className="card-container">
        <div className="course-state course-state-error" role="alert">
          <h3>Your courses could not be loaded</h3>
          <p>{error}</p>
          <button type="button" className="button button-ink" onClick={reload}>
            Try again
          </button>
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <header className="teacher-toolbar">
        <p className="teacher-summary" aria-live="polite">
          {describeSummary(summary)}
        </p>

        <div className="teacher-controls">
          <label className="catalog-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <span className="sr-only">Search your courses</span>
            <input
              type="search"
              placeholder="Search your courses by title or description"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <label className="catalog-filter">
            <span>Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort your courses"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {searchPending ? (
            <span className="teacher-search-pending" aria-live="polite">
              Searching…
            </span>
          ) : null}
        </div>
      </header>

      {courses.length === 0 ? (
        <div className="course-state">
          <h3>
            {hasSearch
              ? 'No courses match that search'
              : 'You have not published a course yet'}
          </h3>
          <p>
            {hasSearch
              ? 'Every course you own is searched, so try a broader keyword.'
              : 'Use Add Course in the menu above to publish your first one.'}
          </p>
          {hasSearch ? (
            <button
              type="button"
              className="button button-outline"
              onClick={clearSearch}
            >
              Clear search
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="card-container">
            {courses.map((course) => {
              const isExpanded = Boolean(expanded[course.id]);
              const { text, truncated } = previewDescription(
                course.description,
                isExpanded,
              );
              const published = formatPublishedDate(course.createdAt);

              return (
                <Card key={course.id} className="card teacher-course-card">
                  <Card.Body>
                    <Card.Title>{course.title}</Card.Title>

                    {/* These used to be <p> elements inside <Card.Text>, which
                        React Bootstrap renders as a <p> — one
                        validateDOMNesting warning per card. */}
                    <Card.Text as="div">
                      <p className="teacher-course-description">
                        {text || <em>No description.</em>}{' '}
                        {truncated || isExpanded ? (
                          <button
                            type="button"
                            className="read-more-link"
                            onClick={() => toggleDescription(course.id)}
                          >
                            {isExpanded ? 'Read less' : 'Read more'}
                          </button>
                        ) : null}
                      </p>

                      <dl className="teacher-course-meta">
                        <div>
                          <dt>Category</dt>
                          <dd>{course.category}</dd>
                        </div>
                        <div>
                          <dt>Price</dt>
                          <dd>{course.price}</dd>
                        </div>
                        <div>
                          <dt>Sections</dt>
                          {/* Computed server-side, so an object-shaped or
                              missing `sections` field is a number here rather
                              than a blank cell or a TypeError. */}
                          <dd>{describeSections(course.sectionCount)}</dd>
                        </div>
                        <div>
                          <dt>Learners</dt>
                          <dd className="teacher-course-enrolled">
                            {describeEnrolled(course.enrolled)}
                          </dd>
                        </div>
                        {published ? (
                          <div>
                            <dt>Published</dt>
                            <dd>{published}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </Card.Text>

                    <div className="teacher-course-actions">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => setEditing(course)}
                        disabled={deletingId === course.id}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => setPendingDelete(course)}
                        disabled={deletingId === course.id}
                      >
                        {deletingId === course.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              );
            })}
          </div>

          <p className="catalog-range" aria-live="polite">
            {describeTeacherRange(pagination, courses.length)}
          </p>

          <CatalogPager
            pagination={pagination}
            onPageChange={goToPage}
            disabled={loading}
            label="Your course pages"
          />
        </>
      )}

      {editing ? (
        <EditCourse
          course={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setToast({ message, type: 'success' });
            // The card renders the title, category and price that just
            // changed, so the page is re-read rather than patched in place.
            reload();
          }}
        />
      ) : null}

      {/* This panel was the only in-page confirmation in the app. It is the
          shared ConfirmDialog now, so SavedCourses and CourseReviews use the
          same one rather than a third and fourth copy of it (#137). */}
      <ConfirmDialog
        request={
          pendingDelete
            ? createConfirmRequest({
                title: 'Delete this course?',
                consequence: `“${pendingDelete.title}” and its section videos will be removed, along with every enrolment, payment, review and bookmark that referenced it. This cannot be undone.`,
                confirmLabel: 'Delete course',
                onConfirm: confirmDelete,
              })
            : null
        }
        onCancel={() => setPendingDelete(null)}
        busy={Boolean(deletingId)}
      />

      <Toast message={toast.message} type={toast.type} onClose={dismissToast} />
    </Container>
  );
};

export default TeacherHome;
