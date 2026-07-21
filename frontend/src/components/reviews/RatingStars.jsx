import React from "react";

const RatingStars = ({
  value = 0,
  onChange,
  readOnly = false,
  size = "1.25rem",
  label = "Course rating",
}) => (
  <div
    className="review-stars"
    role={readOnly ? "img" : "radiogroup"}
    aria-label={label}
  >
    {[1, 2, 3, 4, 5].map((star) => {
      const active = star <= Math.round(value);

      return readOnly ? (
        <span
          key={star}
          aria-hidden="true"
          style={{ fontSize: size }}
          className={active ? "review-star-active" : "review-star-inactive"}
        >
          ★
        </span>
      ) : (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          className={`review-star-button ${
            active ? "review-star-active" : "review-star-inactive"
          }`}
          onClick={() => onChange?.(star)}
        >
          ★
        </button>
      );
    })}
    {readOnly ? (
      <span className="sr-only">{Number(value).toFixed(1)} out of 5</span>
    ) : null}
  </div>
);

export default RatingStars;
