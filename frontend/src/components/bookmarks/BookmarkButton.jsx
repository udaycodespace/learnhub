import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBookmarks } from "../../context/BookmarksContext";
import "./Bookmarks.css";

const BookmarkButton = ({
  courseId,
  compact = false,
  className = "",
  onChange,
}) => {
  const navigate = useNavigate();
  const { isBookmarked, toggleBookmark, isAuthenticated } =
    useBookmarks();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const bookmarked = isBookmarked(courseId);

  const handleClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!isAuthenticated) {
      navigate("/login");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const nextValue = await toggleBookmark(courseId);
      onChange?.(nextValue);
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Saved-course status could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`bookmark-control ${className}`}>
      <button
        type="button"
        className={`bookmark-button ${
          bookmarked ? "is-bookmarked" : ""
        } ${compact ? "is-compact" : ""}`}
        onClick={handleClick}
        disabled={saving}
        aria-pressed={bookmarked}
        aria-label={
          bookmarked
            ? "Remove course from saved courses"
            : "Save course for later"
        }
        title={
          bookmarked
            ? "Remove from saved courses"
            : "Save for later"
        }
      >
        <span aria-hidden="true">
          {bookmarked ? "★" : "☆"}
        </span>
        {!compact ? (
          <span>
            {saving
              ? "Saving…"
              : bookmarked
                ? "Saved"
                : "Save course"}
          </span>
        ) : null}
      </button>

      {error ? (
        <span className="bookmark-inline-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
};

export default BookmarkButton;
