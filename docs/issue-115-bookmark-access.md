# The Saved link that was not for everyone (#115)

## The defect

Bookmarks are student-only on the API, declared once for every route:

```js
router.use(authMiddleware);
router.use(checkRole(["student", "Student"]));
```

The client knew that in exactly one place — the route guard — and its comment
even said why:

```jsx
{/* Bookmarks are a student-only feature on the API side, so the
    route says so instead of letting the page mount and fail. */}
<Route path="/saved-courses" element={
  <ProtectedRoute allowedRoles={["student"]}>
```

The two places that actually reach for the feature did not.

`NavBar.jsx` rendered the link for anyone with a session:

```jsx
if (!user?.userData) { return null }
...
<SavedCoursesNavLink className="me-3" />
```

`BookmarksContext.jsx` fetched the wishlist for anyone with a token:

```js
const isAuthenticated = Boolean(getToken());
...
const response = await axiosInstance.get("/api/bookmarks?limit=50");
```

`BookmarksProvider` wraps the whole application, so that ran on every page.

Signed in as a teacher or an admin:

- The navbar showed `☆ Saved 0`.
- Clicking it went to `/saved-courses`, the guard refused the role, and
  `<Navigate to="/dashboard" replace />` put the user back where they started.
  The link did nothing, twice.
- Every page load produced `Unable to load saved courses: AxiosError ... 403`
  and a wasted authenticated round trip.
- `BookmarkButton` rendered on catalogue cards — reachable by an admin through
  the dashboard's *Courses* panel — and answered 403 when clicked.

Confirmed against the real router:

```
[#3] GET /api/bookmarks as teacher -> 403 {"message":"Forbidden: Access denied","success":false}
```

`lib/dashboardPanels.js` exists to prevent this exact shape and says so: the
navbar renders from `visiblePanelLinks(user)`, which is the same data
`resolvePanel` validates against, so "the navbar cannot advertise a link the
dashboard would refuse to open". The Saved link was the one navbar entry
outside that mechanism.

## The fix

The same idea, for the same reason.

### `frontend/src/lib/bookmarkAccess.js` (new)

| export | does |
| --- | --- |
| `BOOKMARK_ROLES` | the roles the API accepts, as a list the route guard is handed directly |
| `canUseBookmarks(user)` | whether an account has a wishlist, through `lib/roles` |
| `bookmarkDenialReason(user, isAuthenticated)` | `'signed-out'`, `'role'`, or `null` |
| `shouldLoadBookmarks(user, isAuthenticated)` | whether to issue the request at all |
| `bookmarkDenialMessage(reason)` | the message for a denial |

Going through `lib/roles` rather than comparing a literal matters: accounts
written before #55 still store a capitalised `type`, and `hasAnyRole` is where
that comparison rule already lives.

### The four call sites

- **`App.jsx`** — `allowedRoles={BOOKMARK_ROLES}` instead of `["student"]`.
  Sharing the value is what stops the guard and the UI disagreeing.
- **`NavBar.jsx`** — `canUseBookmarks(user.userData)` gates the link, beside the
  `visiblePanelLinks` call it should have been next to all along.
- **`BookmarksContext.jsx`** — takes the session from `useAuth()` rather than a
  bare `getToken()`, because the role is the thing being asked about.
  `refreshBookmarks` returns early when the account has no wishlist. **`ready`
  still settles** — anything waiting on it to decide whether to render an empty
  state would otherwise wait forever. `enabled` is added to the context value.
- **`BookmarkButton.jsx`** — renders nothing for a signed-in account without a
  wishlist. A signed-out visitor still sees it: the feature *is* theirs, and the
  button sends them to the login screen.

### `backend/routers/courseBookmarkRoutes.js`

`["student", "Student"]` → `["student"]`, named as `BOOKMARK_ROLES` and
exported so a test can assert the client mirrors the right list.

`checkRole` lowercases both sides before comparing, so the second spelling never
did any work — but carrying it suggested the rule was fuzzier than it is, which
is part of how four places ended up with four different ideas of it. Removing it
is the only behavioural-looking part of this change, so there is a test running
`"student"`, `"Student"` and `"STUDENT"` through the guard and asserting all
three still pass.

## Two reasons, not one

`toggleBookmark` used to throw one error for both:

```js
if (!isAuthenticated) {
  const error = new Error("Sign in to save courses.");
  error.code = "AUTH_REQUIRED";
```

A signed-out visitor and an educator are not in the same situation. The first
should be sent to the login screen. The second cannot get a wishlist by signing
in again, so the control should not be there — and firing the request to be told
403 helps nobody. `bookmarkDenialReason` separates them and the error carries
`AUTH_REQUIRED` or `ROLE_REQUIRED` accordingly.

## What did not change

Everything a student sees. The wishlist, the stars, the counts, the optimistic
toggle and the `learnhub:bookmark-change` event all behave exactly as before —
this only stops offering the feature to accounts the API was already refusing.

The product decision is also unchanged: educators still do not have a wishlist.
That is what the API enforces and this makes the UI honour it. Whether they
*should* is a separate question, and changing it would be a change to the API
first.

## Tests

- **`frontend/src/lib/bookmarkAccess.test.js`** (new, 12) — the predicate over
  every role including the capitalised legacy spelling and the `role` alias, the
  two denial reasons and their messages, and the ordering detail that a stale
  student in `localStorage` with an expired token reads as signed-out rather
  than wrong-role.
- **`backend/tests/bookmark-access.test.js`** (new, 8) — the rule the client
  mirrors, asserted against the router that enforces it. Every route is walked
  for a student and for a teacher, so a new route cannot be added outside the
  guard, and the admin pseudo-identity `{ id: "admin" }` is covered separately
  because `authMiddleware` builds it without touching the database.

## Verifying

```bash
cd backend  && npm test    # 421 pass (413 before, 8 added)
cd frontend && npm test    # 181 pass (169 before, 12 added)
cd frontend && npm run build
```

By hand:

1. Sign in as a `teacher`. The navbar has no Saved link, and the console is
   clean on every page load.
2. Open the catalogue. The cards have no star.
3. Sign in as a `student`. Everything is where it was.

## Notes

- `npm run lint` does not pass on `main` and does not pass here. The files
  touched report the same 8 problems before and after — unused `React` imports,
  `react/prop-types`, and the pre-existing fast-refresh warning on
  `BookmarksContext`. `lib/bookmarkAccess.js` and `App.jsx` lint clean.
- `getToken()` is still imported by the provider. `AxiosInstance` owns the
  storage keys and the interceptor reads the same value, so the token check
  stays alongside the session check rather than replacing it.
- `SavedCourses.jsx` needed no change. It is only reachable through the guarded
  route, which is now driven by the same list.
- The `enabled` flag is on the context rather than each consumer calling
  `canUseBookmarks` itself, so there is one place a component can be wrong.
