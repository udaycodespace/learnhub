import React, { useEffect, useState } from "react";
import axiosInstance from "../common/AxiosInstance";
import RatingStars from "./RatingStars";
import "./CourseReviews.css";

const CourseRatingBadge = ({ courseId, compact = false }) => {
  const [summary, setSummary] = useState({
    averageRating: 0,
    totalReviews: 0,
  });

  useEffect(() => {
    if (!courseId) return undefined;

    let active = true;

    axiosInstance
      .get(`/api/reviews/${courseId}/summary`)
      .then((response) => {
        if (active && response.data.success) {
          setSummary(response.data.data);
        }
      })
      .catch(() => {
        if (active) {
          setSummary({ averageRating: 0, totalReviews: 0 });
        }
      });

    return () => {
      active = false;
    };
  }, [courseId]);

  return (
    <div className={`course-rating-badge ${compact ? "is-compact" : ""}`}>
      <RatingStars value={summary.averageRating} readOnly size="0.95rem" />
      <strong>{summary.averageRating || "New"}</strong>
      <span>
        {summary.totalReviews}{" "}
        {summary.totalReviews === 1 ? "review" : "reviews"}
      </span>
    </div>
  );
};

export default CourseRatingBadge;
