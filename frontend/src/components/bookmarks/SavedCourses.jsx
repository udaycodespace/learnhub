import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import axiosInstance from "../common/AxiosInstance";
import { useBookmarks } from "../../context/BookmarksContext";
import BookmarkButton from "./BookmarkButton";
import "./Bookmarks.css";

const initialFilters = {
  search: "",
  category: "",
  access: "",
  availability: "",
  sort: "recent",
};

const authConfig = () => ({
  headers: {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  },
});

const SavedCourses = () => {
  const navigate = useNavigate();
  const {
    bookmarkCount,
    clearAllBookmarks,
    refreshBookmarks,
  } = useBookmarks();

  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    totalItems: 0,
    hasPreviousPage: false,
    hasNextPage: false,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: "12",
      sort: filters.sort,
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value && key !== "sort") params.set(key, value);
    });

    return params.toString();
  }, [filters, page]);

  const loadSavedCourses = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await axiosInstance.get(
        `/api/bookmarks?${queryString}`,
        authConfig(),
      );

      setItems(response.data.data || []);
      setCategories(response.data.categories || []);
      setPagination(response.data.pagination);
    } catch (requestError) {
      if (requestError.response?.status === 401) {
        navigate("/login");
        return;
      }

      setError(
        requestError.response?.data?.message ||
          "Saved courses could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [navigate, queryString]);

  useEffect(() => {
    loadSavedCourses();
  }, [loadSavedCourses]);

  useEffect(() => {
    const refresh = () => loadSavedCourses();

    window.addEventListener("learnhub:bookmark-change", refresh);
    window.addEventListener("learnhub:bookmarks-cleared", refresh);

    return () => {
      window.removeEventListener(
        "learnhub:bookmark-change",
        refresh,
      );
      window.removeEventListener(
        "learnhub:bookmarks-cleared",
        refresh,
      );
    };
  }, [loadSavedCourses]);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setFilters(draftFilters);
  };

  const clearFilters = () => {
    setDraftFilters(initialFilters);
    setFilters(initialFilters);
    setPage(1);
  };

  const handleClearAll = async () => {
    if (!bookmarkCount) return;

    const confirmed = window.confirm(
      "Remove every course from your saved list?",
    );

    if (!confirmed) return;

    setClearing(true);
    setError("");

    try {
      await clearAllBookmarks();
      await refreshBookmarks();
      await loadSavedCourses();
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          "Saved courses could not be cleared.",
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <main className="saved-courses-page">
      <header className="saved-courses-header">
        <div>
          <p>SAVED FOR LATER</p>
          <h1>My course wishlist</h1>
          <span>
            {bookmarkCount}{" "}
            {bookmarkCount === 1 ? "saved course" : "saved courses"}
          </span>
        </div>

        <button
          type="button"
          onClick={handleClearAll}
          disabled={!bookmarkCount || clearing}
          className="clear-bookmarks-button"
        >
          {clearing ? "Clearing…" : "Clear all"}
        </button>
      </header>

      <form className="saved-course-filters" onSubmit={applyFilters}>
        <label className="saved-course-search">
          <span>Search</span>
          <input
            type="search"
            value={draftFilters.search}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                search: event.target.value,
              }))
            }
            placeholder="Course, category, or educator"
          />
        </label>

        <label>
          <span>Category</span>
          <select
            value={draftFilters.category}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                category: event.target.value,
              }))
            }
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option value={category} key={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Access</span>
          <select
            value={draftFilters.access}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                access: event.target.value,
              }))
            }
          >
            <option value="">Free and paid</option>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </label>

        <label>
          <span>Availability</span>
          <select
            value={draftFilters.availability}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                availability: event.target.value,
              }))
            }
          >
            <option value="">All saved items</option>
            <option value="available">Available</option>
            <option value="deleted">Unavailable</option>
          </select>
        </label>

        <label>
          <span>Sort</span>
          <select
            value={draftFilters.sort}
            onChange={(event) =>
              setDraftFilters((current) => ({
                ...current,
                sort: event.target.value,
              }))
            }
          >
            <option value="recent">Recently saved</option>
            <option value="title-asc">Title: A–Z</option>
            <option value="title-desc">Title: Z–A</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </label>

        <div className="saved-filter-actions">
          <button type="submit">Apply filters</button>
          <button type="button" onClick={clearFilters}>
            Reset
          </button>
        </div>
      </form>

      {error ? (
        <section className="saved-course-error" role="alert">
          <strong>Unable to show saved courses</strong>
          <p>{error}</p>
          <button type="button" onClick={loadSavedCourses}>
            Try again
          </button>
        </section>
      ) : null}

      {loading ? (
        <section className="saved-course-grid" role="status">
          <span className="sr-only">Loading saved courses</span>
          {Array.from({ length: 6 }).map((_, index) => (
            <article
              className="saved-course-skeleton"
              key={index}
            />
          ))}
        </section>
      ) : items.length === 0 && !error ? (
        <section className="saved-course-empty">
          <span aria-hidden="true">☆</span>
          <h2>No saved courses found</h2>
          <p>
            Save courses from the catalog and they will appear here.
          </p>
          <Link to="/">Browse courses</Link>
        </section>
      ) : !error ? (
        <>
          <div className="saved-result-summary">
            <span>
              {pagination.totalItems}{" "}
              {pagination.totalItems === 1 ? "result" : "results"}
            </span>
            <span>
              Page {pagination.page} of {pagination.totalPages}
            </span>
          </div>

          <section className="saved-course-grid">
            {items.map(({ bookmarkId, savedAt, course }) => (
              <article
                className={`saved-course-card ${
                  course.availability === "deleted"
                    ? "is-unavailable"
                    : ""
                }`}
                key={bookmarkId}
              >
                <div className="saved-course-card-top">
                  <span>{course.category}</span>
                  {course.id ? (
                    <BookmarkButton
                      courseId={course.id}
                      compact
                    />
                  ) : (
                    <span className="unavailable-label">
                      Unavailable
                    </span>
                  )}
                </div>

                <h2>{course.title}</h2>
                <p>{course.description}</p>

                <dl>
                  <div>
                    <dt>Educator</dt>
                    <dd>{course.educator}</dd>
                  </div>
                  <div>
                    <dt>Access</dt>
                    <dd>
                      {course.accessType === "free"
                        ? "Free"
                        : course.price}
                    </dd>
                  </div>
                  <div>
                    <dt>Saved</dt>
                    <dd>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                      }).format(new Date(savedAt))}
                    </dd>
                  </div>
                </dl>

                {course.id ? (
                  <Link
                    to={`/courseSection/${course.id}/${encodeURIComponent(
                      course.title,
                    )}`}
                    className="saved-course-open"
                  >
                    Open course →
                  </Link>
                ) : (
                  <p className="saved-course-unavailable-copy">
                    This course was removed from the catalog. You can
                    safely remove it from your wishlist.
                  </p>
                )}
              </article>
            ))}
          </section>

          {pagination.totalPages > 1 ? (
            <nav
              className="saved-course-pagination"
              aria-label="Saved course pages"
            >
              <button
                type="button"
                disabled={!pagination.hasPreviousPage}
                onClick={() =>
                  setPage((current) => Math.max(1, current - 1))
                }
              >
                ← Previous
              </button>
              <span>
                {pagination.page} / {pagination.totalPages}
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
        </>
      ) : null}
    </main>
  );
};

export default SavedCourses;
