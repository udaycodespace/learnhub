# Reviewing your own course (#117)

## The defect

`createReview` gated on one thing:

```js
const enrollment = await ensureEnrollment(userId, courseId);
if (!enrollment) {
  return res.status(403).send({
    success: false,
    message: "Only enrolled students can review this course.",
  });
}
```

Nothing stops an author enrolling in their own course — `enrollCourseController`
checks that the course exists, that its sections are readable, and that payment
is valid, and never compares `course.userId` against the enrolling account. Two
requests were enough:

```
[#5] enrol in own course -> 200 true "Enroll Successfully"
[#5] review own course   -> 201 true "Review submitted successfully."
[#5] verifiedEnrollment  -> true | summary: {"averageRating":5,"totalReviews":1}
```

The review was then presented as independent. `serializeReview` stamped the
literal `true`:

```js
verifiedEnrollment: true,
```

and `CourseReviews.jsx` rendered the badge without reading the field at all.

It flows into everything built on the summary: `CourseRatingBadge` on the
catalogue card, `buildSummaryPipeline`'s average, and the rating a shopper reads
before enrolling. A course with one self-review outranks a course with three
genuine four-star reviews.

## The fix

### `backend/utils/courseAuthorship.js` (new)

`isCourseAuthor(course, userId)`. It is a helper rather than a `===` because
`courseModel.userId` is a `String` while `courseReview.userId` is an
`ObjectId` — comparing them without coercing both sides is false, always, and
silently. `courseDeletionController` already does this by hand and
`cascadeDelete` carries a comment about the same trap.

Also `REVIEW_DENIAL`, the two reasons, and `AUTHOR_REVIEW_MESSAGE`.

### `courseReviewController`

- **`createReview`** refuses the author, *before* the enrolment check. The
  ordering is the point: the enrolment is not the thing that is wrong, so
  "you are not enrolled" would be the wrong answer.
- **`getMyReview`** returns `reason`, `isAuthor` and `isEnrolled` alongside
  `canReview`, so the client can stop rendering a form that answers 403.
- **`updateReview`** reads before writing. Creating a self-review is blocked,
  but a row written *before* the guard is still owned by its author, and
  `findOneAndUpdate({ _id, userId })` would have let them edit it —
  reintroducing by the back door exactly what the create path refuses.
- **`serializeReview`** computes `verifiedEnrollment` instead of asserting it.
- **`listReviews`** reads the course's author (one extra projected field, in
  parallel with the count it already ran) so the badge can be a fact.

Deleting stays open in every case: that is the direction that fixes the problem.

### `backend/scripts/removeSelfReviews.js` (new)

Guarding the write leaves the existing rows in the average exactly where they
were. This clears them, following the `db:dedupe-emails` pattern already in the
repo:

```bash
npm run db:remove-self-reviews -- --dry-run
npm run db:remove-self-reviews
```

One `$lookup` on the indexed `courseId` with
`$expr: { $eq: [{ $toString: "$userId" }, "$course.userId"] }`, rather than
walking reviews and loading a course per row.

### `frontend/src/lib/reviewEligibility.js` (new)

The component had two states and one sentence for everything that was not "you
may review". An author was told *"Enroll in this course before submitting a
verified review"* — advice that leads nowhere, since they can enrol and the
review is still refused. `reviewDenialMessage` says the right thing for each
reason, and `CourseReviews.jsx` now reads `review.verifiedEnrollment` rather
than rendering the badge unconditionally.

## What was deliberately not changed

**The enrolment.** An author can still enrol in their own course, and should:
`sendCourseContentController` will not serve the sections without an enrolment,
so refusing it would take away the ability to check that the videos play.
Blocking the review is what protects the rating; blocking the enrolment would
cost something real and protect nothing extra.

**The `enrolled` counter.** An author who enrols still counts as one of their
own learners, which shows in `LEARNERS` on the card and in the `sort=popular`
ordering. That counter has a separate, older drift problem — it was only ever
incremented, and `cascadeDelete` has a comment about it — and fixing one course
of it here would be a change to a number admins have been reading, made for a
reason unrelated to this bug. Left alone, on purpose.

**Excluding existing self-reviews at read time.** It would mean a `$lookup` in
`buildSummaryPipeline`, which is the pipeline #86 built specifically so a
twelve-card catalogue page costs one indexed pass. The cleanup script achieves
the same result once, rather than on every catalogue render.

## Verifying

```bash
cd backend  && npm test    # 433 pass (413 before, 20 added)
cd frontend && npm test    # 180 pass (169 before, 11 added)
```

The original repro, re-run:

```
enrol in own course -> 200 true "Enroll Successfully"
review own course   -> 403 false "You cannot review a course you created." | reason: own-course
catalogue summary   -> {"averageRating":0,"totalReviews":0,...}
canReview / reason  -> false / own-course | enrolled: true
```

## Tests

`backend/tests/self-review.test.js` (20) covers the comparison across the
String/ObjectId mismatch, the refusal while enrolled, the reason being
`own-course` rather than an enrolment prompt, an educator reviewing *somebody
else's* course still working, the three `/mine` states, the update back door,
delete staying open, the badge on a legacy row, and the script — dry run,
apply, no-op, and a review whose course was deleted (which is `cascadeDelete`'s
problem, not this script's).

`frontend/src/lib/reviewEligibility.test.js` (11) covers each message, the
signed-out precedence, an unrecognised reason from a newer server, and an older
server that sends only `canReview`.

## Notes

- `npm run lint` does not pass on `main` and does not pass here.
  `CourseReviews.jsx` reports the same 3 problems before and after — an unused
  `React` import and two `react/prop-types`. `lib/reviewEligibility.js` lints
  clean.
- The admin token is a pseudo-identity (`{ _id: "admin" }`) with no matching
  course, so `isCourseAuthor` is false for it and nothing changes.
- `updateReview` costs one extra read on a path that runs when somebody edits a
  review. That seemed a better trade than leaving a way back in.
- A course with no `userId` is not owned by everybody: both an absent owner and
  an absent account return false, with a test for each.
