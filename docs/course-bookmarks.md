# Course bookmarks and student wishlist

## Backend API

All endpoints require an authenticated student token.

```http
GET    /api/bookmarks
GET    /api/bookmarks/status?courseIds=id1,id2
POST   /api/bookmarks/:courseId
DELETE /api/bookmarks/:courseId
DELETE /api/bookmarks
```

Supported list parameters:

| Parameter | Values |
|---|---|
| `page` | Positive integer |
| `limit` | 1–50 |
| `search` | Course, category, educator, description |
| `category` | Exact category |
| `access` | `free`, `paid` |
| `availability` | `available`, `deleted` |
| `sort` | `recent`, `title-asc`, `title-desc`, `price-asc`, `price-desc` |

## Database rules

A dedicated bookmark model stores only:

- User ID
- Course ID
- Created and updated timestamps

A compound unique index on `{ userId, courseId }` prevents duplicates.

When a course is deleted, Mongoose population returns `null`. The API retains the
bookmark and returns an unavailable placeholder so the student can see and remove
the stale saved item safely.

## Frontend integration

### 1. Wrap the application

In `frontend/src/App.jsx`:

```jsx
import { BookmarksProvider } from "./context/BookmarksContext";
```

Wrap the existing router or route tree:

```jsx
<BookmarksProvider>
  <Router>
    {/* existing routes */}
  </Router>
</BookmarksProvider>
```

Do not add a second `Router` if the application already has one.

### 2. Add the Saved Courses route

```jsx
import SavedCourses from "./components/bookmarks/SavedCourses";
```

Inside `<Routes>`:

```jsx
<Route path="/saved-courses" element={<SavedCourses />} />
```

Place it with other authenticated routes.

### 3. Add bookmark buttons to course cards

In `AllCourses.jsx`:

```jsx
import BookmarkButton from "../bookmarks/BookmarkButton";
```

Inside the course-card map:

```jsx
<BookmarkButton courseId={course._id} compact />
```

### 4. Add a bookmark button to the course page

In `CourseContent.jsx`:

```jsx
import BookmarkButton from "../../bookmarks/BookmarkButton";
```

Near the course heading:

```jsx
<BookmarkButton courseId={courseId} />
```

### 5. Add navigation count

In the authenticated navbar:

```jsx
import SavedCoursesNavLink from "../bookmarks/SavedCoursesNavLink";
```

Render:

```jsx
<SavedCoursesNavLink />
```

Adjust the relative import based on the navbar location.

## Optimistic updates

`BookmarksContext` updates the UI before the network request finishes. If the
request fails, it restores the previous state and the button displays an error.

A browser custom event keeps course cards, detail pages, navigation count, and
the Saved Courses page synchronized without duplicate state implementations.

## Manual testing

1. Log out and click Save. Confirm redirect to login.
2. Log in as a student and save a course card.
3. Confirm the navigation count increases.
4. Refresh and confirm the course remains saved.
5. Open the course and confirm its button is still active.
6. Remove it from the detail page and confirm the card updates.
7. Save several free and paid courses.
8. Test category, access, availability, search, and sorting.
9. Delete a saved course as teacher/admin and confirm the stale item is marked unavailable.
10. Simulate a failed request and confirm optimistic rollback.
11. Test keyboard activation and visible focus.
12. Test mobile and desktop layouts.
