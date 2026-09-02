import React, { useCallback, useEffect, useState } from "react";
import axiosInstance, { getToken } from "../common/AxiosInstance";
import RatingStars from "./RatingStars";
import ConfirmDialog from "../common/ConfirmDialog";
import { createConfirmRequest } from "../../lib/confirmDialog";
import {
  canShowReviewForm,
  readEligibility,
  reviewDenialMessage,
} from "../../lib/reviewEligibility";
import "./CourseReviews.css";

const initialPagination = {
  page: 1,
  totalPages: 1,
  totalItems: 0,
  hasPreviousPage: false,
  hasNextPage: false,
};

const emptySummary = {
  averageRating: 0,
  totalReviews: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

const formatDate = (value) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));

const CourseReviews = ({ courseId, courseTitle }) => {
  const token = getToken();
  const [reviews, setReviews] = useState([]);
  const [summary, setSummary] = useState(emptySummary);
  const [pagination, setPagination] = useState(initialPagination);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [myReview, setMyReview] = useState(null);
  const [canReview, setCanReview] = useState(false);
  // Why the form is not being offered. "Enroll in this course" was the answer
  // to everything, including for the educator who wrote it (#117).
  const [denialReason, setDenialReason] = useState(null);
  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRequest, setConfirmRequest] = useState(null);

  const loadReviews = useCallback(async () => {
    if (!courseId) return;

    setLoading(true);
    setError("");

    try {
      const response = await axiosInstance.get(
        `/api/reviews/${courseId}?page=${page}&limit=5&sort=${sort}`,
      );

      setReviews(response.data.data || []);
      setSummary(response.data.summary || emptySummary);
      setPagination(response.data.pagination || initialPagination);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Reviews could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [courseId, page, sort]);

  const loadMyReview = useCallback(async () => {
    if (!courseId || !token) return;

    try {
      const response = await axiosInstance.get(
        `/api/reviews/${courseId}/mine`,
      );

      const eligibility = readEligibility(response.data);

      setMyReview(response.data.data);
      setCanReview(eligibility.canReview);
      setDenialReason(eligibility.reason);

      if (response.data.data) {
        setRating(response.data.data.rating);
        setReviewText(response.data.data.reviewText || "");
      }
    } catch {
      // No reason to go on: hide the form rather than offer one that will be
      // refused, and fall back to the enrolment prompt.
      setCanReview(false);
      setDenialReason(null);
    }
  }, [courseId, token]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  useEffect(() => {
    loadMyReview();
  }, [loadMyReview]);

  const resetForm = () => {
    if (myReview) {
      setRating(myReview.rating);
      setReviewText(myReview.reviewText || "");
    } else {
      setRating(0);
      setReviewText("");
    }
    setEditing(false);
  };

  const submitReview = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!rating) {
      setError("Choose a rating before submitting.");
      return;
    }

    setSaving(true);

    try {
      const payload = { rating, reviewText };
      const response = myReview
        ? await axiosInstance.put(
            `/api/reviews/review/${myReview.id}`,
            payload,
          )
        : await axiosInstance.post(`/api/reviews/${courseId}`, payload);

      setMyReview(response.data.data);
      setSummary(response.data.summary);
      setNotice(response.data.message);
      setEditing(false);
      setPage(1);
      await loadReviews();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Your review could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  // window.confirm blocked the tab, was not announced, could not be themed,
  // and gave a permanent deletion the same OK/Cancel as everything else (#137).
  const askToRemoveReview = () => {
    if (!myReview) return;

    setConfirmRequest(
      createConfirmRequest({
        title: "Delete your review?",
        consequence: `Your rating and any text you wrote about “${courseTitle || "this course"}” will be removed, and the course average will be recalculated without it. This cannot be undone.`,
        confirmLabel: "Delete review",
        onConfirm: removeReview,
      }),
    );
  };

  const removeReview = async () => {
    if (!myReview) return;

    setConfirmRequest(null);
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await axiosInstance.delete(
        `/api/reviews/review/${myReview.id}`,
      );

      setMyReview(null);
      setRating(0);
      setReviewText("");
      setSummary(response.data.summary);
      setNotice(response.data.message);
      setPage(1);
      await loadReviews();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Your review could not be deleted.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="course-reviews" aria-labelledby="course-reviews-title">
      <header className="course-reviews-header">
        <div>
          <p className="reviews-eyebrow">STUDENT FEEDBACK</p>
          <h2 id="course-reviews-title">
            Reviews for {courseTitle || "this course"}
          </h2>
        </div>

        <div className="rating-overview">
          <strong>{summary.averageRating.toFixed(1)}</strong>
          <div>
            <RatingStars value={summary.averageRating} readOnly />
            <span>
              {summary.totalReviews}{" "}
              {summary.totalReviews === 1 ? "review" : "reviews"}
            </span>
          </div>
        </div>
      </header>

      <div className="rating-distribution">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = summary.distribution?.[star] || 0;
          const percent = summary.totalReviews
            ? Math.round((count / summary.totalReviews) * 100)
            : 0;

          return (
            <div key={star} className="rating-distribution-row">
              <span>{star} ★</span>
              <div>
                <span style={{ width: `${percent}%` }} />
              </div>
              <small>{count}</small>
            </div>
          );
        })}
      </div>

      {notice ? (
        <div className="review-notice" role="status">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="review-error" role="alert">
          {error}
        </div>
      ) : null}

      {canShowReviewForm({ isAuthenticated: Boolean(token), canReview }) ? (
        <article className="review-form-card">
          <div className="review-form-heading">
            <div>
              <span className="verified-review-badge">✓ Verified enrollment</span>
              <h3>{myReview ? "Your review" : "Share your experience"}</h3>
            </div>

            {myReview && !editing ? (
              <div className="review-owner-actions">
                <button type="button" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={askToRemoveReview}
                  disabled={saving}
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>

          {!myReview || editing ? (
            <form onSubmit={submitReview}>
              <label>
                <span>Your rating</span>
                <RatingStars value={rating} onChange={setRating} />
              </label>

              <label>
                <span>Review (optional)</span>
                <textarea
                  value={reviewText}
                  onChange={(event) =>
                    setReviewText(event.target.value.slice(0, 1000))
                  }
                  rows={4}
                  placeholder="What helped you learn? What could be improved?"
                />
                <small>{reviewText.length}/1000</small>
              </label>

              <div className="review-form-actions">
                {editing ? (
                  <button type="button" onClick={resetForm}>
                    Cancel
                  </button>
                ) : null}
                <button type="submit" disabled={saving}>
                  {saving
                    ? "Saving…"
                    : myReview
                      ? "Update review"
                      : "Submit review"}
                </button>
              </div>
            </form>
          ) : (
            <div className="my-review-preview">
              <RatingStars value={myReview.rating} readOnly />
              <p>{myReview.reviewText || "No written review provided."}</p>
            </div>
          )}
        </article>
      ) : (
        <div className="review-eligibility-message">
          {reviewDenialMessage({
            isAuthenticated: Boolean(token),
            reason: denialReason,
          })}
        </div>
      )}

      <div className="reviews-toolbar">
        <h3>Student reviews</h3>
        <label>
          <span className="sr-only">Sort reviews</span>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="highest">Highest rated</option>
            <option value="lowest">Lowest rated</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="review-loading" role="status">
          Loading course reviews…
        </div>
      ) : reviews.length === 0 ? (
        <div className="review-empty">
          <strong>No reviews yet</strong>
          <p>Be the first enrolled student to share feedback.</p>
        </div>
      ) : (
        <div className="review-list">
          {reviews.map((review) => (
            <article key={review.id} className="review-card">
              <header>
                <div className="review-avatar">
                  {review.user.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <strong>{review.user.name}</strong>
                  {/* Read, not assumed. `verifiedEnrollment` was the literal
                      `true` on every row and this badge never looked at it, so
                      a course author's own review carried it too (#117). */}
                  {review.verifiedEnrollment ? (
                    <span className="verified-review-badge">
                      ✓ Verified enrollment
                    </span>
                  ) : null}
                </div>
                <time dateTime={review.createdAt}>
                  {formatDate(review.createdAt)}
                </time>
              </header>
              <RatingStars value={review.rating} readOnly />
              <p>{review.reviewText || "No written review provided."}</p>
            </article>
          ))}
        </div>
      )}

      {pagination.totalPages > 1 ? (
        <nav className="review-pagination" aria-label="Review pages">
          <button
            type="button"
            disabled={!pagination.hasPreviousPage}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            ← Previous
          </button>
          <span>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={!pagination.hasNextPage}
            onClick={() => setPage((current) => current + 1)}
          >
            Next →
          </button>
        </nav>
      ) : null}

      <ConfirmDialog
        request={confirmRequest}
        onCancel={() => setConfirmRequest(null)}
        busy={saving}
      />
    </section>
  );
};

export default CourseReviews;
