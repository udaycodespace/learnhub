# Making course reviews reachable (#136)

## The defect

The reviews feature added in #18 is complete on the server and was all but
unreachable in the browser.

The API exposes a full set of endpoints, and `GET /api/reviews/:courseId` is
deliberately public — no `authMiddleware` on that line:

```js
router.get("/:courseId", listReviews);
router.get("/:courseId/summary", getRatingSummary);
router.get("/:courseId/mine", authMiddleware, getMyReview);
router.post("/:courseId", authMiddleware, createReview);
```

`createReview` gates on enrolment and nothing else:

```js
const enrollment = await ensureEnrollment(userId, courseId);
if (!enrollment) {
  return res.status(403).send({
    success: false,
    message: "Only enrolled students can review this course.",
  });
}
```

`<CourseReviews>`, the component that consumes all of it, was rendered in
exactly one place in the entire frontend — inside `<Modal.Body>` of the
**certificate** modal in `CourseContent.jsx`. That modal is opened by a button
that only renders once every section is complete.

Two things followed.

**Nobody could read a review.** Every catalogue card renders a
`<CourseRatingBadge>` showing a star average and a count. It was an inert
`<div>`: not a link, not a button, with no expanded form and no course detail
page to navigate to. A prospective student was shown "4.6 (23)" and given no
way to see any of the 23, on the one screen where reviews exist to inform a
decision. The public `listReviews` endpoint had **no caller in the frontend at
all**.

**Most enrolled students could not write one.** The server's rule is enrolment;
the UI's rule was 100% completion. A student nine sections into a ten-section
course was authorised by the API and had no button. Reviews were therefore
collected only from the subset who finish courses, which biases every average
on the catalogue upward — invisibly, because the count looks like it covers all
enrolments.

## The fix

### The rule stays where the server put it

`frontend/src/lib/reviewEligibility.js` already states who may write a review —
enrolment, and not authorship of the course (#117, #122) — and `CourseReviews`
already asks it. Nothing here changes that rule, and nothing here adds a
progress argument to it: completion is not part of the server's rule and must
not become part of the UI's. That divergence is the defect, and it came from
*where the component was mounted*, not from the rule it consulted.

So the fix is placement, and `frontend/src/lib/reviewAccess.js` holds only the
label for the control that opens a course's reviews.

### Reviews on the course player

`<CourseReviews>` moves out of the certificate modal and onto the player page,
below the sections and the video, where any enrolled student reaches it at any
progress. The certificate modal keeps its congratulation and its download; it
is a reasonable prompt, just not the only door.

### Reviews from the catalogue

`<CourseRatingBadge>` takes an optional `onOpen`. With it the badge renders as
a `<button>` that opens the course's reviews; without it, it is the same inert
div as before, so the single-course usages are unaffected.

The accessible name is the whole sentence — "Rated 4.6 out of 5 from 23 reviews
for Intro to Testing. Open reviews" — because the stars, the average and the
count render as three separate nodes, which is not a sentence, and because a
control has to say what activating it does.

`AllCourses` holds the open course in state and renders `<CourseReviews>` in a
scrollable modal beside the payment one. Nothing is fetched until the badge is
activated, so the catalogue's critical path is unchanged: the summaries are
still batched by `useRatingSummaries` in the one request that already existed.

Reading works signed out. `CourseReviews` already had the message for that case
— "Sign in with an enrolled student account to leave a review" — it had simply
never been rendered anywhere a signed-out visitor could reach.

## What is covered

`frontend/src/lib/reviewAccess.test.js` — 5 tests on the badge label: it reads
as a sentence and says what it opens, singularises one review, says "no reviews
yet" rather than "0 reviews", produces no `NaN` from a missing summary, and
takes the course title as optional.

Who may write a review is covered by `reviewEligibility.test.js`, which this
change leaves alone. The regression it fixes — an enrolled student at any
progress — is now a property of the mount point rather than of a predicate:
`<CourseReviews>` is on the player page, so there is no completion check
between the student and the form.

## Not addressed here

There is still no course detail page — the catalogue modal is the reading
surface, which suits a card grid but is not a shareable URL for a course and
its reviews. A `/course/:courseId` route is a larger change and separate work.

The upward bias in the averages collected while this was broken is in the data
already; nothing here rewrites it.
