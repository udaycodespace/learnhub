# Course completion and the certificate (#93)

## The defect

Three separate things kept a learner from a certificate they had earned, and
one of them could hand out a certificate they had not.

### 1. A section with no video had no way to be completed

`CourseContent.jsx` rendered both of a section's controls inside one guard:

```jsx
{section.S_content && (
   <>
      <Button onClick={() => playVideo(...)}>Play Video</Button>
      {isSectionCompleted && !completedSections.includes(index) && (
         <Button onClick={() => completeModule(sectionId)}
                 disabled={playingSectionIndex !== index}>
            Completed
         </Button>
      )}
   </>
)}
```

`course_Length` is `countSections(course.sections)` — every section, video or
not. So a single video-less section made the total unreachable and the
certificate never appeared, however much of the course was finished.

### 2. Completion was decided in the browser, from the wrong array

```jsx
{completedModule.length === courseContent.length && ( ... )}
```

`completedModule` is the enrolment's `progress` array verbatim. It can hold:

- the same `sectionId` twice — rows written before #39 had no uniqueness
  guard, which is why `enrolledCoursesController.countCompletedSections`
  exists;
- ids for sections that have since been removed from the course.

Both inflate `.length`, so the comparison could fire early on an unfinished
course. And because it never deduplicated, it could equally fail to fire on a
finished one. The player and My Courses reported different numbers for the same
enrolment.

### 3. The certificate was dated by the last write to the enrolment

```jsx
setCertificate(res.data.certficateData.updatedAt)
```

`updatedAt` is Mongoose's last-write timestamp. It moves every time a section
is completed, and again when `enrollmentController` corrects `course_Length`
after the course is edited. `enrolledCourseModel` has declared a
`certificateDate` field since it was written and **nothing ever set it** —
`enrolledCoursesController` returned `enrollment.certificateDate || null` and
it was null for every enrolment in the database.

The same endpoint also answered `404 "User not found"` for a caller who exists
and is simply not enrolled, resolved the enrolment from `req.body.userId`
rather than `req.user`, and shipped the entire enrolment document to the client
as `certficateData` for the sake of one field.

## The fix

### `backend/utils/courseProgress.js` (new)

The progress rule, in one place, read by both the player and My Courses:

| function | answers |
| --- | --- |
| `completedSectionIds(progress)` | the distinct ids, as strings |
| `countCompletedSections(progress)` | how many |
| `buildProgressSummary(enrollment)` | `{ completed, total, percent }`, `completed` capped at `total` |
| `isEnrollmentComplete(enrollment)` | `total > 0 && completed >= total` |
| `describeSections(sections, progress)` | one row per section: `index`, `sectionId`, `hasVideo`, `completed` |

`countCompletedSections` and `buildProgressSummary` moved here out of
`enrolledCoursesController`, which now imports and re-exports them, so the two
pages cannot drift apart again.

`describeSections` reads `course.sections` through `normalizeSections`, so an
object-shaped `sections` field is described in order rather than dropped, and
resolves `completed` against **both** addressing schemes — an index and a
section `_id` — because `normalizeSectionId` accepts either and older rows hold
whichever the client sent.

Note what `describeSections` deliberately does not do: `hasVideo` and
`completed` are independent fields. Nothing downstream may derive the second
from the first.

### `backend/controllers/courseContentController.js` (new)

`sendCourseContentController` moved out of the `userControllers` aggregator
and:

- resolves the enrolment from `req.user`, the identity a request body cannot
  influence — the same change #83 made to `/addcourse`;
- validates `:courseid` before it reaches Mongoose, so a malformed id is a 400
  rather than a `CastError` surfacing as a 500;
- answers **403 "You are not enrolled in this course"** where it used to answer
  404 "User not found";
- returns `courseContent` as described sections, plus `progress`, `isComplete`,
  `certificateDate`, `courseTitle` and `courseEducator`;
- keeps `courseContent` and `completeModule` under their original names so
  anything still reading them keeps working.

`certficateData` — the whole enrolment document — is gone.

### `backend/controllers/progressController.js`

`POST /api/user/completemodule` now returns the recomputed `progress`,
`isComplete` and `certificateDate`, so the common case needs no follow-up
request, and stamps the certificate:

```js
if (isComplete && !certificateDate) {
  certificateDate = now();

  await EnrolledCourseModel.updateOne(
    { _id: enrollment._id,
      $or: [{ certificateDate: { $exists: false } }, { certificateDate: null }] },
    { $set: { certificateDate } },
  );
}
```

The filter is guarded on the field still being unset, so two requests
completing the last section at once cannot overwrite each other's date. The
summary is projected from the array that was read plus the id `$addToSet` just
wrote (`projectProgress`), so there is no second read.

The clock is injectable (`setClock`) so a test can assert the stamped value
without racing it.

### Frontend

`frontend/src/lib/courseProgress.js` normalises the response and answers the
questions the component asks. It recomputes nothing the server sent:
`readIsComplete` trusts `isComplete` when present and falls back to comparing
the summary — never to a bare array length. `readVideoPath` handles
`/uploads/x`, `uploads/x`, `x`, `\x` and an absolute URL, which the component
used to do inline in the middle of a JSX `onClick`.

`CourseContent.jsx`:

- **Mark complete** is outside the `hasVideo` guard. A section with no video
  says so and still completes.
- A progress bar and `n of m sections complete` at the top of the page.
- The certificate button is gated on the server's `isComplete`.
- The certificate is dated from `certificateDate`, and the date line is omitted
  entirely when there is none rather than rendering `Invalid Date`.
- Loading and error states, with a retry — a failed load used to leave an empty
  accordion and a `console.log`.
- `alert()` replaced with the `Toast` component added in #36, and the
  `alreadyCompleted` flag the API returns is reflected in the message.

## Tests

`backend/tests/course-content.test.js` — 20 tests:

- distinct ids counted once across `0` and `"0"`;
- a duplicated row cannot push completion past the total;
- progress for a section the course no longer has does not complete it;
- an enrolment with no sections is never complete;
- **a section without a video is described and marked completable**;
- object-shaped `sections` described in order;
- completion matched by `_id` as well as by index;
- the endpoint returns the summary, the title and the certificate date;
- `certificateDate` is null rather than `updatedAt`, and `certficateData` is
  gone;
- 403 for an unenrolled caller, 404 for a missing course, 400 for a malformed
  id checked before the models are touched, 401 with no identity;
- the enrolment is resolved from `req.user` when the body says otherwise;
- completing the last section stamps the date once, under a guarded filter;
- completing a middle section stamps nothing;
- an already-stamped enrolment is not re-stamped;
- a video-less section completes like any other.

`frontend/src/lib/courseProgress.test.js` — 16 tests over the response
normalisation, including that a malformed or missing summary reads as zero
rather than as complete.

Backend: 254 passing (234 before). Frontend: 89 passing (73 before).

## Verifying by hand

1. Seed, enrol a student, and drop the video off the last section:
   `db.courses.updateOne({C_title: "Introduction to HTML and CSS"}, {$unset: {"sections.1.S_content": ""}})`
2. Open the course. Section 2 reads *This section has no video* and offers
   **Mark complete**.
3. Complete both. The bar reaches 100%, and the certificate button appears.
4. `db.enrolledcourses.findOne({...})` → `certificateDate` is set, once.
5. Complete a section again — `alreadyCompleted: true`, the toast says so, and
   `certificateDate` does not move.
6. Open a course you are not enrolled in → `403 "You are not enrolled in this
   course"`.
