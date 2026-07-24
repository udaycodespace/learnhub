import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import axiosInstance from "../components/common/AxiosInstance";

const BookmarksContext = createContext(null);

const authConfig = () => ({
  headers: {
    Authorization: `Bearer ${localStorage.getItem("token")}`,
  },
});

export const BookmarksProvider = ({ children }) => {
  const [bookmarkIds, setBookmarkIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const requestVersion = useRef(0);

  const isAuthenticated = Boolean(localStorage.getItem("token"));

  const refreshBookmarks = useCallback(async () => {
    if (!isAuthenticated) {
      setBookmarkIds(new Set());
      setReady(true);
      return;
    }

    const version = ++requestVersion.current;
    setLoading(true);

    try {
      const response = await axiosInstance.get(
        "/api/bookmarks?limit=50",
        authConfig(),
      );

      if (version !== requestVersion.current) return;

      const ids = (response.data.data || [])
        .map((item) => item.course?.id)
        .filter(Boolean);

      setBookmarkIds(new Set(ids));
    } catch (error) {
      if (version === requestVersion.current) {
        console.error("Unable to load saved courses:", error);
      }
    } finally {
      if (version === requestVersion.current) {
        setLoading(false);
        setReady(true);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    refreshBookmarks();
  }, [refreshBookmarks]);

  useEffect(() => {
    const sync = (event) => {
      const detail = event.detail || {};

      if (!detail.courseId) return;

      setBookmarkIds((current) => {
        const next = new Set(current);

        if (detail.bookmarked) next.add(detail.courseId);
        else next.delete(detail.courseId);

        return next;
      });
    };

    window.addEventListener("learnhub:bookmark-change", sync);
    return () =>
      window.removeEventListener("learnhub:bookmark-change", sync);
  }, []);

  const setBookmarkLocally = useCallback((courseId, bookmarked) => {
    setBookmarkIds((current) => {
      const next = new Set(current);

      if (bookmarked) next.add(courseId);
      else next.delete(courseId);

      return next;
    });

    window.dispatchEvent(
      new CustomEvent("learnhub:bookmark-change", {
        detail: { courseId, bookmarked },
      }),
    );
  }, []);

  const toggleBookmark = useCallback(
    async (courseId) => {
      if (!isAuthenticated) {
        const error = new Error("Sign in to save courses.");
        error.code = "AUTH_REQUIRED";
        throw error;
      }

      const wasBookmarked = bookmarkIds.has(courseId);
      const nextValue = !wasBookmarked;

      setBookmarkLocally(courseId, nextValue);

      try {
        if (nextValue) {
          await axiosInstance.post(
            `/api/bookmarks/${courseId}`,
            {},
            authConfig(),
          );
        } else {
          await axiosInstance.delete(
            `/api/bookmarks/${courseId}`,
            authConfig(),
          );
        }

        return nextValue;
      } catch (error) {
        setBookmarkLocally(courseId, wasBookmarked);
        throw error;
      }
    },
    [
      bookmarkIds,
      isAuthenticated,
      setBookmarkLocally,
    ],
  );

  const removeBookmark = useCallback(
    async (courseId) => {
      if (!bookmarkIds.has(courseId)) return;

      setBookmarkLocally(courseId, false);

      try {
        await axiosInstance.delete(
          `/api/bookmarks/${courseId}`,
          authConfig(),
        );
      } catch (error) {
        setBookmarkLocally(courseId, true);
        throw error;
      }
    },
    [bookmarkIds, setBookmarkLocally],
  );

  const clearAllBookmarks = useCallback(async () => {
    const previous = new Set(bookmarkIds);
    setBookmarkIds(new Set());

    try {
      await axiosInstance.delete("/api/bookmarks", authConfig());
      window.dispatchEvent(
        new CustomEvent("learnhub:bookmarks-cleared"),
      );
    } catch (error) {
      setBookmarkIds(previous);
      throw error;
    }
  }, [bookmarkIds]);

  const value = useMemo(
    () => ({
      bookmarkIds,
      bookmarkCount: bookmarkIds.size,
      isBookmarked: (courseId) => bookmarkIds.has(courseId),
      toggleBookmark,
      removeBookmark,
      clearAllBookmarks,
      refreshBookmarks,
      loading,
      ready,
      isAuthenticated,
    }),
    [
      bookmarkIds,
      toggleBookmark,
      removeBookmark,
      clearAllBookmarks,
      refreshBookmarks,
      loading,
      ready,
      isAuthenticated,
    ],
  );

  return (
    <BookmarksContext.Provider value={value}>
      {children}
    </BookmarksContext.Provider>
  );
};

export const useBookmarks = () => {
  const context = useContext(BookmarksContext);

  if (!context) {
    throw new Error(
      "useBookmarks must be used inside BookmarksProvider.",
    );
  }

  return context;
};
