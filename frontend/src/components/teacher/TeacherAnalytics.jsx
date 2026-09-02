import React, { useCallback, useEffect, useState } from "react";
import axiosInstance from "../common/AxiosInstance";
import "./TeacherAnalytics.css";

const formatDate = (v) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(v));

const TeacherAnalytics = () => {
  const [summary, setSummary] = useState({ totalCourses: 0, totalEnrollments: 0, averageRating: 0, totalReviews: 0 });
  const [courses, setCourses] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await axiosInstance.get("/api/teacher/analytics");
      setSummary(res.data.data.summary);
      setCourses(res.data.data.courses);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load analytics.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (courseId) => {
    setDetailLoading(true); setError("");
    try {
      const res = await axiosInstance.get(`/api/teacher/analytics/course/${courseId}`);
      setDetail(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load course detail.");
    } finally { setDetailLoading(false); }
  };

  if (loading) return <section className="teacher-analytics"><div className="ta-loading">Loading analytics…</div></section>;
  if (error && !detail) return <section className="teacher-analytics"><div className="ta-error">{error}</div></section>;

  if (detail) {
    return (
      <section className="teacher-analytics" aria-labelledby="ta-detail-title">
        <button className="ta-detail-back" onClick={() => setDetail(null)}>← Back to overview</button>
        {error && <div className="ta-error" role="alert">{error}</div>}
        <h2 id="ta-detail-title">{detail.course.title}</h2>
        <p style={{ color: "#6b7280", fontSize: "0.85rem", margin: "0 0 1rem" }}>
          {detail.course.category} · {detail.course.sections} sections
        </p>
        <div className="ta-detail-stats">
          <div className="ta-card"><strong>{detail.enrollments.total}</strong><span>Enrolled</span></div>
          <div className="ta-card"><strong>{detail.enrollments.completed}</strong><span>Completed</span></div>
          <div className="ta-card"><strong>{detail.reviews.average} ★</strong><span>{detail.reviews.total} reviews</span></div>
        </div>
        <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Rating distribution</h3>
        <div style={{ marginBottom: "1.5rem" }}>
          {[5, 4, 3, 2, 1].map((star) => {
            const count = detail.reviews.distribution[star] || 0;
            const pct = detail.reviews.total ? Math.round((count / detail.reviews.total) * 100) : 0;
            return (
              <div key={star} className="ta-rating-dist">
                <span style={{ width: 20, textAlign: "right" }}>{star}★</span>
                <div style={{ flex: 1, background: "#f3f4f6", borderRadius: 4, height: 8 }}>
                  <div className="ta-rating-bar" style={{ width: `${pct}%`, height: "100%" }} />
                </div>
                <span style={{ width: 30 }}>{count}</span>
              </div>
            );
          })}
        </div>
        <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Recent enrollments</h3>
        {detail.recentEnrollments.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: "0.85rem" }}>No enrollments yet.</p>
        ) : (
          <ul className="ta-recent-list">
            {detail.recentEnrollments.map((e, i) => (
              <li key={i} className="ta-recent-item">
                <div><strong>{e.user.name}</strong> <span>{e.user.email}</span></div>
                <span>{formatDate(e.enrolledAt)} · {e.progress} sections</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="teacher-analytics" aria-labelledby="ta-title">
      <header className="ta-header">
        <p style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#6b7280", margin: 0 }}>TEACHER INSIGHTS</p>
        <h1 id="ta-title">Course Analytics</h1>
        <p>Track enrollments, ratings, and student engagement across your courses.</p>
      </header>
      <div className="ta-summary">
        <div className="ta-card"><strong>{summary.totalCourses}</strong><span>Courses</span></div>
        <div className="ta-card"><strong>{summary.totalEnrollments}</strong><span>Enrollments</span></div>
        <div className="ta-card"><strong>{summary.averageRating} ★</strong><span>Avg Rating</span></div>
        <div className="ta-card"><strong>{summary.totalReviews}</strong><span>Reviews</span></div>
      </div>
      {courses.length === 0 ? (
        <div className="ta-empty"><h3>No courses yet</h3><p>Create your first course to start tracking analytics.</p></div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="ta-courses-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Category</th>
                <th>Enrollments</th>
                <th>Rating</th>
                <th>Reviews</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.title}</strong></td>
                  <td><span className="ta-badge ta-badge-blue">{c.category}</span></td>
                  <td><span className="ta-badge ta-badge-green">{c.enrollments}</span></td>
                  <td>{c.averageRating > 0 ? <span className="ta-badge ta-badge-amber">{c.averageRating} ★</span> : <span style={{ color: "#9ca3af" }}>—</span>}</td>
                  <td>{c.totalReviews}</td>
                  <td><button className="ta-detail-back" onClick={() => openDetail(c.id)}>Details →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detailLoading && <div className="ta-loading" style={{ marginTop: "1rem" }}>Loading details…</div>}
    </section>
  );
};

export default TeacherAnalytics;
