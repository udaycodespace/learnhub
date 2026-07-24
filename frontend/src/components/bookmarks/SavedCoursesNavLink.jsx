import React from "react";
import { Link } from "react-router-dom";
import { useBookmarks } from "../../context/BookmarksContext";

const SavedCoursesNavLink = ({ className = "" }) => {
  const { bookmarkCount } = useBookmarks();

  return (
    <Link
      to="/saved-courses"
      className={`saved-courses-nav-link ${className}`}
      aria-label={`Saved courses, ${bookmarkCount} items`}
    >
      <span aria-hidden="true">☆</span>
      <span>Saved</span>
      <strong>{bookmarkCount}</strong>
    </Link>
  );
};

export default SavedCoursesNavLink;
