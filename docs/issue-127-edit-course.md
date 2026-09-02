# Editing a published course (#127)

## The defect

A course could be created and deleted. It could not be changed.

```
$ grep -rn "router.put\|router.patch" backend/routers
backend/routers/courseReviewRoutes.js:25:router.put("/review/:reviewId", authMiddleware, updateReview);
```

One `PUT` in the project, and it belonged to a review. `userRoutes.js` offered
`POST /addcourse` and `DELETE /deletecourse/:courseid`. `TeacherHome.jsx`
rendered one action per card, `Delete`. `AddCourse.jsx` always posted to
`/addcourse` — no edit mode, and no component to put one in.

## Why "delete and re-add" is not a workaround

`deleteCourseController` is deliberately destructive, and correctly so — #74
made it that way. It removes the section videos from disk and then calls
`removeCourseDependents`:

```js
const [enrolments, payments, reviews, bookmarks] = await Promise.all([
  models.EnrolledCourse.deleteMany(filter),
  models.CoursePayment.deleteMany(filter),
  models.CourseReview.deleteMany(filter),
  models.CourseBookmark.deleteMany(filter),
]);
```

So fixing one character in `C_title` cost every enrolment and with it every
student's `progress` array; every payment record, which is the admin ledger's
only history of who paid for what; every review and the rating on the catalogue
card; every bookmark; and every `.mp4`, which then had to be uploaded again. For
a paid course it also meant every enrolled student paying again.

None of the fields an educator actually needs to correct touches a file on disk,
and none of them invalidates an enrolment.

## What is here

**`GET /api/user/editcourse/:courseid`** — the course as an edit form needs it.
It exists because the educator's list endpoint deliberately projects section
text away (#94 removed `sections` from that response along with the stored file
paths), so a form that lets somebody rename a section has nowhere else to read
the current name from. The response carries section titles and descriptions and
a `hasVideo` flag, and **not** `S_content`: an edit form has no more reason to
see a storage path than a catalogue card does.

**`PUT /api/user/editcourse/:courseid`** — the change. JSON, not multipart: none
of the editable fields is a file, so there is no Multer here and none of the
identity trouble that comes with it (#83).

Both are mounted on the admin router too, the way `deletecourse` already is.

**An allow-list, not a spread.** `{ ...req.body }` is how #55 happened. Four
metadata fields and two per-section text fields are read; everything else in the
body is ignored rather than rejected, so an edit form that posts the whole course
document back still works and still cannot write `userId`, `enrolled`, `_id` or a
section's `S_content`. There is a test that sends all four of those.

**The section count is fixed.** This route takes no uploads, so a submitted list
of a different length is refused with a sentence saying so, rather than
truncating or padding silently.

**A stale byline is fixed on the way through.** `C_educator` is written once at
creation from the token (#83), so a teacher who later corrected their name left
the old one on every course they had already published. An edit by the owner
re-reads it from the token. An admin editing somebody else's course is not the
educator, so their name is not written — asserted by a test.

**Ownership is decided the way deletion decides it**: a teacher may act on a
course they own, an admin on any course. Written out in
`courseUpdateController` rather than shared with `courseDeletionController`,
because the two need the document for different reasons — deletion to collect
filenames, this to know how many sections there are.

**An `Edit` action** on each educator card, opening a modal filled from the GET.
Save is disabled while the form is untouched, so "No editable fields were
supplied" is never a sentence anybody has to read. `lib/courseEdit.js` mirrors
the server's rules for the browser, the same table asserted on both sides, and
the price field says the #114 rule out loud — *leave blank, or enter 0 or
"free", for a free course* — rather than leaving it to be discovered by
submitting.

## What an edit deliberately cannot do

- Replace, add or remove a section video. That is an upload, with its own type,
  size and count rules (#44, #106), and a cleanup path for a rejected one.
- Change `userId`. Ownership comes from the token at creation and stays there.
- Change `enrolled`. It is a count of real enrolments, not a field.
- Change the email or role of anybody. Nothing here touches a user.

## Tests

`backend/tests/course-edit.test.js` — 26 tests with injected models, so no
database. Among them: a body carrying `userId`, `enrolled`, `C_educator` and
`_id` changes only the one field that was editable; a body carrying a section
`S_content` of `{ path: "/etc/passwd" }` leaves the stored path untouched; a
teacher editing somebody else's course is refused and the stub records no write;
a student is refused by a controller whose `Course.findById` throws, so the test
fails if the lookup is ever reached; and after a successful edit the stub still
holds `enrolled: 42`, the original `userId` and both sections — everything the
delete-and-recreate workaround would have destroyed.

`frontend/src/lib/courseEdit.test.js` — 18 tests, including that whitespace
alone is not a change and that a course whose `sections` field is an object map
produces an empty list rather than throwing, which is the shape that blanked the
whole educator dashboard in #94.
