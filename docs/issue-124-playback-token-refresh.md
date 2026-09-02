# Renewing the playback token (#124)

## The defect

`/api/user/coursecontent/:courseid` mints a playback token, and the token is
short-lived on purpose:

```js
// backend/utils/playbackTokens.js
const PLAYBACK_TTL_SECONDS = 30 * 60;
```

`CourseContent.jsx` asked for it once, when the page mounted:

```jsx
const [playbackToken, setPlaybackToken] = useState('')
...
useEffect(() => { getCourseContent(); }, [courseId]);
```

Nothing renewed it. Thirty minutes later the value in that state was a
credential `courseVideoController` refuses before it touches the database:

```js
if (!tokenCoversCourse(claims, courseid)) {
  return res.status(401).send({
    success: false,
    message: "A valid playback token is required",
  });
}
```

## Why it was silent

`resolveCourseVideoUrl` still built a URL and `currentVideo && playbackToken`
was still truthy, so the player rendered and requested the file. That request is
issued by the `<video>` element, not by `axiosInstance`, so the 401 interceptor
never saw it — no `clearSession()`, no redirect to `/login?session=expired`, no
message. The player was an empty box, and the console was empty too.

Three ordinary ways to reach it:

- a lecture longer than half an hour — the element re-requests with a new
  `Range` header on every seek past the buffer, so a seek at 00:31:00 fails
  although playback started fine;
- a normal study session: watch section 1, take notes, come back, click
  section 2;
- any session at all, if the viewer does not click **Completed** — that handler
  called `getCourseContent()` again on success, which happened to re-mint the
  token, so a student who finished a section inside the window never saw this
  and a student who only watched always did.

## Why the fix is not a longer lifetime

Thirty minutes is the right number and #76 chose it deliberately. The token
rides in a query string, and query strings land in browser history, in `Referer`
headers and in every access log between the client and the server. Widening it
to match the session token would give a day's life to a credential that leaks by
design.

The defect is that nothing renewed it, so renewal is what this adds. The
lifetime is unchanged.

## What is here

**The expiry travels with the token.** `issuePlaybackToken` returns the token,
`expiresAt` in epoch milliseconds and `expiresInSeconds`. Both endpoints that
hand out a token carry all three, so the client never has to decode a credential
it has no business parsing. `signPlaybackToken` is untouched and still exported;
`issuePlaybackToken` wraps it.

**A route that mints a token and nothing else.**
`GET /api/user/playbacktoken/:courseid`, behind `authMiddleware`, in
`controllers/playbackAccessController.js`. It re-runs the same enrolment check
`/coursecontent` makes, because it is the same claim — this viewer may watch
this course — asked again. An enrolment removed while the page was open does not
get a fresh half hour; it gets a 403.

Previously the only way to obtain a token was to re-fetch every section of the
course, which is why the player asked once and gave up.

**`lib/playbackToken.js`** holds the timing rules, apart from React and with an
injected clock, so the thirty minutes the defect needs is asserted rather than
waited for. `needsRefresh` renews inside a five-minute leeway; `refreshDelay`
schedules at the deadline minus that leeway, floored at five seconds so a skewed
clock cannot produce a request-per-tick loop.

**`hooks/usePlaybackToken.js`** holds the token for one course. Two mechanisms,
because neither is enough on its own:

- a timer, which keeps the token fresh while the tab is open and visible, so
  pressing play at minute 45 does not wait for a round trip;
- `ensureFresh()`, awaited in `playVideo` before the player is pointed at the
  file. This is the one that actually closes the hole: background tabs have
  their timers clamped to once a minute and can be suspended entirely, so a
  scheduled refresh is a convenience and asking again at the moment of use is a
  guarantee. `visibilitychange` calls it too.

A refresh already in flight is shared rather than duplicated, so three clicks on
play issue one request.

**The failure is no longer silent.** If the token cannot be renewed the page
says so. A 403 reads "You are no longer enrolled in this course"; anything else
asks for a reload. A 401 is left alone — the axios interceptor owns that one and
already redirects.

## Behaviour that did not change

- The token lifetime, its scope check, and the `tokenCoversCourse` course
  binding.
- What `/coursecontent` returns, apart from two added fields. `playbackToken` is
  still there under the same name.
- The stream route. It was already correct; it is the thing that proved the
  token had expired.

## Tests

`backend/tests/playback-token-refresh.test.js` — 11 tests. The expiry matches
the token's own `exp` claim; the refresh route checks enrolment against
`req.user` and not `req.body.userId`; a viewer who is no longer enrolled is
refused; a malformed id is a 400 rather than a `CastError`; a database failure
does not leak the error text. The last test signs a token with the lifetime
already spent, watches the stream route refuse it with 401, mints a replacement
and watches the same route accept it — the defect and the fix in one run.

`frontend/src/lib/playbackToken.test.js` — 19 tests against an injected clock,
including the exact state `CourseContent` was in: a token issued at mount, read
thirty minutes and one millisecond later.
