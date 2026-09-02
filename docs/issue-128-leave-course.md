# Leaving a course (#128)

## The defect

An enrolment row was only ever created.

```
$ grep -rn "EnrolledCourse.*delete" backend --exclude-dir=node_modules
backend/utils/cascadeDelete.js:  models.EnrolledCourse.deleteMany(filter),
backend/utils/cascadeDelete.js:  models.EnrolledCourse.deleteMany({ userId }),
```

Both of those are in the cascade — one for a deleted course, one for a deleted
account. `userRoutes.js` had `POST /enrolledcourse/:courseid` and no
counterpart, and the enrolled-courses table's Action column contained one thing,
a `Go To` link.

**A mis-click was permanent.** A free course enrols on a single click, because
`handleEnroll` skips the payment modal entirely for one:

```js
if (!isPaidCourse(course)) {
  handleSubmit(course._id, course.C_title);
  return;
}
```

There is no confirmation step in that path, and no way back out of it.

**`enrolled` only ever went up.** The counter is incremented on enrolment and
decremented in exactly one place, `decrementEnrolledCounts`, which only the
delete cascade calls. That counter is what the catalogue sorts `popular` by and
what the educator dashboard reports as reach. Its own comment already notes that
it "has drifted on existing data" because "it was only ever incremented".

**A review outlived the enrolment that justified it.** `createReview` requires
an enrolment and every review is serialised `verifiedEnrollment: true`. Somebody
who enrolled by accident, rated the course one star and moved on left a
permanently verified review behind, resting on an enrolment they could not
withdraw.

## What is here

`DELETE /api/user/enrolledcourse/:courseid`, for the caller's own enrolment. No
role check — whoever is enrolled may leave — and the account comes from the
token, so there is no way to spell a request that withdraws somebody else.

`utils/enrolmentWithdrawal.js` does the work, in this order:

1. **The enrolment row is removed**, and `progress` goes with it, because
   progress is stored on that row. That is the right outcome: it is progress
   through a course this account is no longer taking.
2. **`course.enrolled` is decremented**, with the same `{ enrolled: { $gt: 0 } }`
   guard `decrementEnrolledCounts` uses. A guarded `$inc` rather than a recount:
   the counter has already drifted, and a recount would silently rewrite history
   an admin has been looking at.
3. **The account's review of the course is removed**, because a review is only
   allowed to exist alongside an enrolment.
4. **The payment row is marked, not deleted** — `status: "withdrawn"`. A
   financial record must not disappear because somebody changed their mind, and
   the ledger should be able to say which enrolments were withdrawn. Rows
   already marked from an earlier cycle are left alone.

The enrolment is removed **first**, and everything else only runs if that
removal matched something. Two tabs and two clicks must not decrement the
learner count twice.

**A bookmark is deliberately not removed.** A saved course is a wishlist entry
and is independent of enrolment; somebody who leaves a course may well still
want it on their list.

## The admin ledger learns the new status

`STATUS_EXPRESSION` maps five stored spellings onto three buckets and defaults
everything it does not recognise to `pending`. A `withdrawn` row would have
landed there, which is wrong twice over: nothing is pending, and `pending` is a
number an admin reads as work to do.

So `withdrawn` is its own bucket — deliberately not a member of
`FAILED_STATUS_VALUES`, because a withdrawal is not a payment that failed. The
money moved; whether it comes back is a question this application does not
answer. It gets a summary tile, a filter option and a neutral badge colour in
both themes, and revenue still counts successful rows only, so leaving a course
takes its amount back out of the total.

## The confirmation

An in-page `alertdialog`, the pattern `TeacherHome` already uses for deleting a
course, not a native `confirm()` — that blocks the tab and is not announced to
assistive technology.

It names what goes and what stays, because leaving is not reversible and the two
are not obvious: the progress that will be lost (with the section count, and
"1 section" rather than "1 sections"), that a review goes with it, that the
payment record is **kept and marked, and that this is not a refund request** —
"leave the course" reads like "get my money back" and it is not — and that
re-enrolling from the catalogue is possible.

`styles/enrolled-courses.css` is its own file rather than a reach into
`teacher-dashboard.css` for three classes. That file belongs to the educator
dashboard, and importing it from a student page would couple two features that
have nothing else to do with each other.

## Tests

`backend/tests/enrolment-withdrawal.test.js` — 19 tests with model stubs that
record every call, so the order and the filters are asserted rather than only
the end state: the enrolment is removed first; when there is no enrolment the
stub records exactly one call and nothing else runs; the learner count uses the
`$gt: 0` guard; the payment row is updated and never deleted; a bookmark is
untouched; and the account is taken from the token even when the body carries a
different `userId`. The last three cover the ledger: `withdrawn` is its own
value, `parsePaymentQuery` accepts it as a filter while still refusing an
unknown one, and `buildSummary` counts it in its own bucket with `pending` left
at zero.

`frontend/src/lib/enrolledCourses.test.js` — 7 tests added for the confirmation
text, including the singular/plural boundary and that a row with no progress
block does not throw.

`backend/tests/payment-listing.test.js` — one existing expectation updated: the
summary shape has a new key, with a comment saying why.
