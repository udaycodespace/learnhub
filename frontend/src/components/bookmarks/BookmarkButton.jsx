import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useBookmarks } from "../../context/BookmarksContext";
import "./Bookmarks.css";

// #103. The star used to read its value out of whatever the provider happened
// to have loaded — page one of the wishlist, and nothing else. A course saved
// earlier than the fifty most recent rendered hollow, and clicking it sent an
// add instead of a remove.
//
// The button now says which course it is showing, and the provider asks the
// server about the ids on screen in one batched request. Registering is all
// this component has to do; the batching lives in the provider.

const BookmarkButton = ({
  courseId,
  compact = false,
  className = "",
  onChange,
}) => {
  const navigate = useNavigate();
  const {
    isBookmarked,
    toggleBookmark,
    trackCourses,
    isAuthenticated,
    enabled,
  } = useBookmarks();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const bookmarked = isBookmarked(courseId);

  // Registering the id is what fills the star in (#103). `trackCourses` is a
  // no-op for a session without a wishlist, so the effect stays unconditional
  // and the early return below stays after every hook.
  useEffect(() => {
    trackCourses(courseId);
  }, [courseId, trackCourses]);

  // A signed-in account without a wishlist is not offered the control. The
  // catalogue is reachable by an admin through the dashboard's Courses panel,
  // and the star used to render there and answer 403 when clicked (#115).
  //
  // A signed-out visitor still sees it: the feature is theirs, and the button
  // sends them to the login screen.
  if (isAuthenticated && !enabled) {
    return null;
  }

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
