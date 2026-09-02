import React, { useContext, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { MDBCol, MDBInput, MDBRow } from "mdb-react-ui-kit";
import { Link, useNavigate } from "react-router-dom";
import { UserContext } from "../../App";
import CourseRatingBadge from "../reviews/CourseRatingBadge";
import CourseReviews from "../reviews/CourseReviews";
import axiosInstance from "./AxiosInstance";
import BookmarkButton from "../bookmarks/BookmarkButton";
import Toast from "./Toast";
import CatalogPager from "./CatalogPager";
import useCourseCatalog from "../../hooks/useCourseCatalog";
import useRatingSummaries from "../../hooks/useRatingSummaries";
import {
  SORT_OPTIONS,
  describeRange,
} from "../../lib/catalogQuery";
import { routeEnrollmentFeedback } from "../../lib/confirmDialog";
import {
  coursePriceLabel,
  isPaidCourse,
  readEnrollmentError,
  readEnrollmentFieldErrors,
} from "../../lib/coursePricing";

const EMPTY_TOAST = { message: "", type: "info" };

const paletteByCategory = [
  ["#f2c14e", "#e56b6f"],
  ["#5b8def", "#a98bfa"],
  ["#35a77c", "#b8d85c"],
  ["#e87a5d", "#f3b562"],
  ["#694fad", "#ef9aa8"],
  ["#267a8c", "#82c9b7"],
];

const levelForCourse = (course, index) => {
  if (course.C_level) return course.C_level;
  const levels = ["Beginner", "Intermediate", "All levels"];
  return levels[index % levels.length];
};

const descriptionForCourse = (course) =>
  course.C_description ||
  course.description ||
  `A practical introduction to ${course.C_title || "this subject"}, designed to help you build confidence through focused video lessons.`;

const CourseArtwork = ({ course, index }) => {
  const [start, end] = paletteByCategory[index % paletteByCategory.length];
  const initials = (course.C_title || "LH")
    .split(" ")
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <div
      className="course-artwork"
      style={{ "--cover-start": start, "--cover-end": end }}
      aria-hidden="true"
    >
      <span className="course-art-grid" />
      <span className="course-art-ring" />
      <strong>{initials}</strong>
      <small>{course.C_categories || "LearnHub original"}</small>
    </div>
  );
};

const AllCourses = () => {
  const navigate = useNavigate();
  const user = useContext(UserContext);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [cardDetails, setCardDetails] = useState({
    cardholdername: "",
    cardnumber: "",
    cvvcode: "",
    expmonthyear: "",
  });
  // A rejected enrolment used to be one alert() saying "Please try again",
  // whatever went wrong. The server sends a sentence and a per-field map; both
  // are rendered now, and the modal stays open so the learner can correct the
  // field it names (#114).
  const [enrollError, setEnrollError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  // The search, the filter and the paging all happen on the server now. This
  // page used to fetch once with no query, receive the default first twelve
  // courses, and filter those twelve in the browser — so course thirteen was
  // unreachable and the search box only ever searched one page.
  const {
    courses,
    pagination,
    loading,
    error: loadError,
    search,
    setSearch,
    priceType,
    setPriceType,
    sort,
    setSort,
    goToPage,
    clearFilters,
    reload,
    searchPending,
    hasFilters,
  } = useCourseCatalog();

  // One request for the ratings on this page, rather than one per card. Every
  // CourseRatingBadge used to fetch its own, so opening the catalogue cost
  // thirteen requests and twelve aggregations.
  const { summaries } = useRatingSummaries(courses);

  const resetPaymentForm = () => {
    setCardDetails({
      cardholdername: "",
      cardnumber: "",
      cvvcode: "",
      expmonthyear: "",
    });
    setEnrollError("");
    setFieldErrors({});
  };

  const handleChange = (event) => {
    const { name, value } = event.target;

    setCardDetails((current) => ({ ...current, [name]: value }));

    // Clear the marker on a field as soon as it is edited, so a corrected
    // input stops being flagged before the form is submitted again.
    setFieldErrors((current) => {
      if (!current[name]) return current;

      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const handleEnroll = (course) => {
    if (!user.userLoggedIn) {
      navigate("/login");
      return;
    }

    // isPaidCourse and the server's isFreeCourse are the same rule now. While
    // they were two rules a course priced "0.00" took this branch — no modal —
    // and the server then rejected the request for carrying no card details,
    // with no way back to the form (#114).
    if (!isPaidCourse(course)) {
      handleSubmit(course._id, course.C_title);
      return;
    }

    setEnrollError("");
    setFieldErrors({});
    setSelectedCourse(course);
  };

  const [toast, setToast] = useState(EMPTY_TOAST);

  const dismissToast = () => setToast(EMPTY_TOAST);
  // The course whose reviews are open. Every card advertised a star average
  // and a count and there was no route from either to a review — the only
  // <CourseReviews> in the app was inside the course player's certificate
  // modal, which opens at 100% completion (#136).
  const [reviewsCourse, setReviewsCourse] = useState(null);

  const openReviews = (courseId) => {
    const course = courses.find(
      (entry) => String(entry._id) === String(courseId),
    );

    if (course) setReviewsCourse(course);
  };

  const closeReviews = () => setReviewsCourse(null);

  const closePaymentModal = () => {
    setSelectedCourse(null);
    resetPaymentForm();
  };

  const handleSubmit = async (courseId, fallbackTitle) => {
    setEnrollError("");
    setFieldErrors({});

    try {
      const res = await axiosInstance.post(
        `/api/user/enrolledcourse/${courseId}`,
        cardDetails,
      );

      const feedback = routeEnrollmentFeedback({
        success: true,
        message: res.data.message,
      });

      const targetCourse = res.data.course;

      closePaymentModal();

      // The alert used to sit above these two lines and halt the tab's event
      // loop, so a successful enrolment looked like it had hung with the
      // payment modal still open behind a system dialog. The toast is raised
      // after the navigation instead, so it lands on the page the learner
      // arrives at (#137).
      if (targetCourse) {
        navigate(`/courseSection/${targetCourse.id}/${targetCourse.Title}`);
      } else if (fallbackTitle) {
        navigate(`/courseSection/${courseId}/${fallbackTitle}`);
      }

      setToast(feedback.toast);

      // The learner count on the card is now stale.
      reload();
    } catch (error) {
      console.error("Unable to enroll:", error);

      // A free course has no modal to put a message in, and used to get an
      // alert — the only error path free enrolment had, gone the moment it was
      // dismissed. Both go to the toast now; a paid course additionally keeps
      // its inline copy, because the form is still open and the message
      // belongs beside the fields.
      const feedback = routeEnrollmentFeedback({
        success: false,
        message: readEnrollmentError(error),
        hasOpenForm: Boolean(selectedCourse),
      });

      setEnrollError(feedback.inlineError);
      setFieldErrors(readEnrollmentFieldErrors(error));
      setToast(feedback.toast);
    }
  };

  return (
    <>
      <div className="catalog-toolbar">
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
            value={priceType}
            onChange={(event) => setPriceType(event.target.value)}
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
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort courses"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="catalog-count" aria-live="polite">
          <strong>{pagination.totalItems}</strong>
          <span>
            {pagination.totalItems === 1 ? "course" : "courses"}
            {searchPending ? " — searching…" : " found"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="course-state" role="status">
          <span className="catalog-loader" aria-hidden="true" />
          <h3>Opening the catalog…</h3>
          <p>Gathering the latest courses for you.</p>
        </div>
      ) : loadError ? (
        <div className="course-state course-state-error" role="alert">
          <span aria-hidden="true">!</span>
          <h3>Course catalog unavailable</h3>
          <p>{loadError}</p>
          <button type="button" className="button button-ink" onClick={reload}>
            Try again
          </button>
        </div>
      ) : courses.length > 0 ? (
        <div className="course-grid">
          {courses.map((course, index) => (
            <article className="catalog-card" key={course._id}>
              <CourseArtwork course={course} index={index} />

              <div className="catalog-card-body">
                <div className="course-meta-row">
                  <span className="course-category">
                    {course.C_categories || "General"}
                  </span>
                  <BookmarkButton
  courseId={course._id}
  compact
/>
                  <span className="course-level">
                    {levelForCourse(course, index)}
                  </span>
                </div>

                <h3>{course.C_title}</h3>
                <p className="course-description">{descriptionForCourse(course)}</p>

                <div className="course-instructor">
                  <CourseRatingBadge
                    courseId={course._id}
                    courseTitle={course.C_title}
                    summary={summaries.get(String(course._id))}
                    onOpen={openReviews}
                    compact
                  />
                  <span className="instructor-avatar" aria-hidden="true">
                    {(course.C_educator || "L").charAt(0).toUpperCase()}
                  </span>
                  <div>
                    <small>CREATED BY</small>
                    <strong>{course.C_educator || "LearnHub educator"}</strong>
                  </div>
                </div>

                <div className="course-card-footer">
                  <div>
                    <small>ACCESS</small>
                    <strong>{coursePriceLabel(course)}</strong>
                  </div>
                  <div>
                    <small>LEARNERS</small>
                    <strong>{course.enrolled || 0}</strong>
                  </div>

                  {user.userLoggedIn ? (
                    <button
                      type="button"
                      className="course-enroll-button"
                      onClick={() => handleEnroll(course)}
                    >
                      Enroll
                      <span aria-hidden="true">↗</span>
                    </button>
                  ) : (
                    <Link className="course-enroll-button" to="/login">
                      Sign in to enroll
                      <span aria-hidden="true">↗</span>
                    </Link>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="course-state">
          <span aria-hidden="true">○</span>
          <h3>
            {hasFilters
              ? "No courses match that search"
              : "There are no courses yet"}
          </h3>
          <p>
            {hasFilters
              ? "Every course is searched, so try a broader keyword or switch the access filter."
              : "Check back once an educator publishes one."}
          </p>
          {hasFilters && (
            <button
              type="button"
              className="button button-outline"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {!loading && !loadError && courses.length > 0 && (
        <>
          <p className="catalog-range" aria-live="polite">
            {describeRange(pagination, courses.length)}
          </p>

          <CatalogPager
            pagination={pagination}
            onPageChange={goToPage}
            disabled={loading}
          />
        </>
      )}

      <Toast message={toast.message} type={toast.type} onClose={dismissToast} />
      {/* Readable without an account: GET /api/reviews/:courseId is public and
          had no caller in the frontend at all before this. */}
      <Modal
        show={Boolean(reviewsCourse)}
        onHide={closeReviews}
        size="lg"
        scrollable
        centered
        aria-labelledby="catalog-reviews-title"
      >
        <Modal.Header closeButton>
          <Modal.Title id="catalog-reviews-title">
            Reviews · {reviewsCourse?.C_title}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {reviewsCourse ? (
            <CourseReviews
              courseId={reviewsCourse._id}
              courseTitle={reviewsCourse.C_title}
            />
          ) : null}
        </Modal.Body>
      </Modal>

      <Modal show={Boolean(selectedCourse)} onHide={closePaymentModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            Enroll in {selectedCourse?.C_title}
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="payment-course-summary">
            <span>{selectedCourse?.C_categories || "Course"}</span>
            <strong>{selectedCourse?.C_educator}</strong>
            <b>{coursePriceLabel(selectedCourse)}</b>
          </div>

          {/* What the server actually said. `formatPaymentMessage` joins the
              per-field errors into a sentence and both halves are on the 400
              body; this component used to discard them and alert a fixed
              string, which is what made a rejected enrolment unexplainable. */}
          {enrollError ? (
            <div className="payment-error" role="alert">
              {enrollError}
            </div>
          ) : null}

          <Form
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmit(selectedCourse?._id, selectedCourse?.C_title);
            }}
          >
            <MDBInput
              className="mb-3"
              label="Card holder name"
              name="cardholdername"
              value={cardDetails.cardholdername}
              onChange={handleChange}
              type="text"
              placeholder="Name on card"
              aria-invalid={Boolean(fieldErrors.cardholdername)}
              required
            />
            {fieldErrors.cardholdername ? (
              <small className="payment-field-error">
                {fieldErrors.cardholdername}
              </small>
            ) : null}
            <MDBInput
              className="mb-3"
              name="cardnumber"
              value={cardDetails.cardnumber}
              onChange={handleChange}
              label="Card number"
              type="text"
              maxLength="16"
              inputMode="numeric"
              placeholder="1234 5678 9012 3457"
              aria-invalid={Boolean(fieldErrors.cardnumber)}
              required
            />
            {fieldErrors.cardnumber ? (
              <small className="payment-field-error">
                {fieldErrors.cardnumber}
              </small>
            ) : null}
            <MDBRow className="mb-4">
              <MDBCol md="6">
                <MDBInput
                  name="expmonthyear"
                  value={cardDetails.expmonthyear}
                  onChange={handleChange}
                  className="mb-3"
                  label="Expiration"
                  type="text"
                  placeholder="MM/YYYY"
                  aria-invalid={Boolean(fieldErrors.expmonthyear)}
                  required
                />
                {fieldErrors.expmonthyear ? (
                  <small className="payment-field-error">
                    {fieldErrors.expmonthyear}
                  </small>
                ) : null}
              </MDBCol>
              <MDBCol md="6">
                <MDBInput
                  name="cvvcode"
                  value={cardDetails.cvvcode}
                  onChange={handleChange}
                  className="mb-3"
                  label="CVV"
                  type="password"
                  inputMode="numeric"
                  maxLength="3"
                  placeholder="•••"
                  aria-invalid={Boolean(fieldErrors.cvvcode)}
                  required
                />
                {fieldErrors.cvvcode ? (
                  <small className="payment-field-error">
                    {fieldErrors.cvvcode}
                  </small>
                ) : null}
              </MDBCol>
            </MDBRow>

            <div className="payment-actions">
              <Button variant="light" type="button" onClick={closePaymentModal}>
                Cancel
              </Button>
              <Button variant="dark" type="submit">
                Complete mock payment
              </Button>
            </div>
          </Form>
        </Modal.Body>
      </Modal>
    </>
  );
};

export default AllCourses;
