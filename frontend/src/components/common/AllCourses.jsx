import React, { useContext, useEffect, useMemo, useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import { MDBCol, MDBInput, MDBRow } from "mdb-react-ui-kit";
import { Link, useNavigate } from "react-router-dom";
import { UserContext } from "../../App";
import axiosInstance from "./AxiosInstance";

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
  const [allCourses, setAllCourses] = useState([]);
  const [filterTitle, setFilterTitle] = useState("");
  const [filterType, setFilterType] = useState("");
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [cardDetails, setCardDetails] = useState({
    cardholdername: "",
    cardnumber: "",
    cvvcode: "",
    expmonthyear: "",
  });

  const getAllCoursesUser = async () => {
    setLoading(true);
    setLoadError("");

    try {
      const res = await axiosInstance.get("api/user/getallcourses", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (res.data.success) {
        setAllCourses(res.data.data || []);
      } else {
        setLoadError("The course catalog is temporarily unavailable.");
      }
    } catch (error) {
      console.error("Unable to load courses:", error);
      setLoadError("We could not load courses right now. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAllCoursesUser();
  }, []);

  const isPaidCourse = (course) => /\d/.test(course.C_price || "");

  const visibleCourses = useMemo(
    () =>
      allCourses.filter((course) => {
        const matchesTitle =
          !filterTitle ||
          course.C_title?.toLowerCase().includes(filterTitle.toLowerCase()) ||
          course.C_categories?.toLowerCase().includes(filterTitle.toLowerCase());

        const paid = isPaidCourse(course);
        const matchesType =
          !filterType ||
          (filterType === "Free" && !paid) ||
          (filterType === "Paid" && paid);

        return matchesTitle && matchesType;
      }),
    [allCourses, filterTitle, filterType],
  );

  const resetPaymentForm = () => {
    setCardDetails({
      cardholdername: "",
      cardnumber: "",
      cvvcode: "",
      expmonthyear: "",
    });
  };

  const handleChange = (event) => {
    setCardDetails((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const handleEnroll = (course) => {
    if (!user.userLoggedIn) {
      navigate("/login");
      return;
    }

    if (!isPaidCourse(course)) {
      handleSubmit(course._id, course.C_title);
      return;
    }

    setSelectedCourse(course);
  };

  const closePaymentModal = () => {
    setSelectedCourse(null);
    resetPaymentForm();
  };

  const handleSubmit = async (courseId, fallbackTitle) => {
    try {
      const res = await axiosInstance.post(
        `api/user/enrolledcourse/${courseId}`,
        cardDetails,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        },
      );

      alert(res.data.message);
      const targetCourse = res.data.course;

      if (targetCourse) {
        navigate(`/courseSection/${targetCourse.id}/${targetCourse.Title}`);
      } else if (fallbackTitle) {
        navigate(`/courseSection/${courseId}/${fallbackTitle}`);
      }

      closePaymentModal();
    } catch (error) {
      console.error("Unable to enroll:", error);
      alert("Enrollment could not be completed. Please try again.");
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
            placeholder="Search by course or category"
            value={filterTitle}
            onChange={(event) => setFilterTitle(event.target.value)}
          />
        </label>

        <label className="catalog-filter">
          <span>Access</span>
          <select
            value={filterType}
            onChange={(event) => setFilterType(event.target.value)}
            aria-label="Filter courses by access type"
          >
            <option value="">All courses</option>
            <option value="Free">Free</option>
            <option value="Paid">Paid</option>
          </select>
        </label>

        <div className="catalog-count" aria-live="polite">
          <strong>{visibleCourses.length}</strong>
          <span>{visibleCourses.length === 1 ? "course" : "courses"} found</span>
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
          <button type="button" className="button button-ink" onClick={getAllCoursesUser}>
            Try again
          </button>
        </div>
      ) : visibleCourses.length > 0 ? (
        <div className="course-grid">
          {visibleCourses.map((course, index) => (
            <article className="catalog-card" key={course._id}>
              <CourseArtwork course={course} index={index} />

              <div className="catalog-card-body">
                <div className="course-meta-row">
                  <span className="course-category">
                    {course.C_categories || "General"}
                  </span>
                  <span className="course-level">
                    {levelForCourse(course, index)}
                  </span>
                </div>

                <h3>{course.C_title}</h3>
                <p className="course-description">{descriptionForCourse(course)}</p>

                <div className="course-instructor">
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
                    <strong>{isPaidCourse(course) ? course.C_price : "Free"}</strong>
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
          <h3>No courses match that search</h3>
          <p>Try a broader keyword or switch the access filter.</p>
          <button
            type="button"
            className="button button-outline"
            onClick={() => {
              setFilterTitle("");
              setFilterType("");
            }}
          >
            Clear filters
          </button>
        </div>
      )}

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
            <b>{selectedCourse?.C_price}</b>
          </div>

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
              required
            />
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
              required
            />
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
                  required
                />
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
                  required
                />
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
