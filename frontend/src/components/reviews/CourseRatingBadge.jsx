import { useEffect, useState } from "react";
import PropTypes from "prop-types";

import axiosInstance from "../common/AxiosInstance";
import RatingStars from "./RatingStars";
import { EMPTY_SUMMARY, normalizeSummary } from "../../lib/ratingSummaries";
import { describeReviewsLink } from "../../lib/reviewAccess";
import "./CourseReviews.css";

// This badge used to fetch its own summary unconditionally, so a list of twelve
// cards meant twelve requests and twelve aggregations. A parent that already
// has the numbers — the catalogue asks for the whole page in one request now —
// passes them in through `summary` and no request is made at all.
//
// The self-fetching path is kept for the single-course case, where there is no
// page to batch with.
//
// With `onOpen` the badge is the way into a course's reviews (#136). It used to
// be an inert div: every catalogue card advertised "4.6 (23)" and there was no
// route from it to any of the 23, because the only `<CourseReviews>` in the app
// was inside the certificate modal on the course player.

const CourseRatingBadge = ({
  courseId,
  compact = false,
  summary = null,
  onOpen = null,
  courseTitle = "",
}) => {
  const [fetched, setFetched] = useState(null);

  const provided = summary ? normalizeSummary(summary) : null;
  const hasSummary = provided !== null;

  useEffect(() => {
    // Nothing to fetch when the parent already batched this page's ratings.
    if (!courseId || hasSummary) return undefined;

    let active = true;

    axiosInstance
      .get(`/api/reviews/${courseId}/summary`)
      .then((response) => {
        if (active && response.data.success) {
          setFetched(normalizeSummary(response.data.data));
        }
      })
      .catch(() => {
        if (active) {
          setFetched(null);
        }
      });

    return () => {
      active = false;
    };
    // Keyed on the boolean, not on `summary` itself: the object identity
    // changes on every render of the parent while the answer does not.
  }, [courseId, hasSummary]);

  const value = provided || fetched || EMPTY_SUMMARY;

  const contents = (
    <>
      <RatingStars value={value.averageRating} readOnly size="0.95rem" />
      <strong>{value.averageRating || "New"}</strong>
      <span>
        {value.totalReviews}{" "}
        {value.totalReviews === 1 ? "review" : "reviews"}
      </span>
    </>
  );

  const className = `course-rating-badge ${compact ? "is-compact" : ""}`;

  // A button only when there is somewhere to go. The stars, the average and
  // the count render as three separate nodes, which is not a sentence, so the
  // accessible name carries the whole thing and says what activating it does.
  if (onOpen) {
    return (
      <button
        type="button"
        className={`${className} is-interactive`}
        onClick={() => onOpen(courseId)}
        aria-label={describeReviewsLink(value, courseTitle)}
      >
        {contents}
      </button>
    );
  }

  return <div className={className}>{contents}</div>;
};

CourseRatingBadge.propTypes = {
  courseId: PropTypes.string,
  compact: PropTypes.bool,
  summary: PropTypes.shape({
    averageRating: PropTypes.number,
    totalReviews: PropTypes.number,
  }),
  onOpen: PropTypes.func,
  courseTitle: PropTypes.string,
};

export default CourseRatingBadge;
