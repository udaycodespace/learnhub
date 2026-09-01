# Removing the blocking native dialogs (#137)

## The defect

#36 replaced the native dialogs in Login with the `Toast` component, and
`TeacherHome` was converted later. `TeacherHome` carries the reason:

```js
// The native confirm() blocked the tab and was not announced to assistive
// technology. An in-page confirmation is inspectable and dismissible.
```

Five call sites in four components on `main` were never converted:

| File | Call | Fires on |
| --- | --- | --- |
| `components/user/teacher/AddCourse.jsx` | `alert` | a course is created |
| `components/common/AllCourses.jsx` | `alert` | enrolment succeeds |
| `components/common/AllCourses.jsx` | `alert` | enrolment fails on a **free** course |
| `components/bookmarks/SavedCourses.jsx` | `window.confirm` | Clear all saved courses |
| `components/reviews/CourseReviews.jsx` | `window.confirm` | deleting your own review |

A sixth, the completion `alert` in `CourseContent`, was on `main` when this was
written and has since been converted to a toast by #93. Nothing here touches
that component any more.

`alert` and `confirm` halt the JavaScript event loop for the whole tab, and
each site had a specific consequence.

**The enrolment success alert sat in the middle of a navigation.** It was
raised *before* `navigate(...)` and before `closePaymentModal()`, so everything
after it was suspended until the learner found and clicked OK. A successful
enrolment appeared to hang with the payment modal still open behind a system
dialog.

**The free-course failure alert was the only error path that course had.** The
comment beside it said so:

```js
// A free course has no modal to show the message in, so it still needs
// the alert. A paid one keeps the form open with the message on it.
if (!selectedCourse) {
  alert(message);
}
```

A paid course got an inline, re-readable message on the form. A free course got
a dialog that was gone the moment it was dismissed — for the identical failure.
The two halves of one flow reported errors in two different registers.

**`AddCourse`'s alert lost the only confirmation of a long upload.** It fired
after a multipart POST that may have taken minutes, and was followed by
`setAddCourse(emptyCourse())`. Dismissing it left an empty form and no evidence
the course had been created.

Against assistive technology a native dialog moves focus out of the document
and its text is not in the accessibility tree as page content, so it is not
announced by a live region, cannot be re-read, and cannot be styled — which is
also why the site's dark theme did not apply to any of these six messages.

## The fix

### One confirmation, not four copies

`TeacherHome` had the only in-page confirmation in the app, and `AdminHome` and
`admin/AllCourses` had already copy-pasted its markup and its
`.teacher-confirm` class names. Adding `SavedCourses` and `CourseReviews` to
that would have made five copies.

`components/common/ConfirmDialog.jsx` is that panel, lifted. All five call
sites use it, the CSS moves to `ConfirmDialog.css`, and the duplicated rules in
`styles/teacher-dashboard.css` are gone.

What it has that `window.confirm` does not: a `consequence` line, buttons that
name the action rather than saying OK, the site's theme including dark mode,
focus starting on Cancel rather than the destructive button, Escape to dismiss,
a backdrop click that is not fooled by a drag that started inside the panel,
and a `busy` state — and, the point, no blocking of the event loop.

`lib/confirmDialog.js` holds the copy and the defaults, so a confirmation is a
value that can be asserted rather than a string buried in a handler.
`createConfirmRequest` returns `null` for a request with no title or no
handler, because the dialog renders on a truthy request and a malformed one
should be nothing rather than a panel whose confirm button throws.

### The consequence is the point

`window.confirm("Delete your review permanently?")` had nowhere to say what is
lost. The replacement does:

> Your rating and any text you wrote about “Intro to Testing” will be removed,
> and the course average will be recalculated without it. This cannot be
> undone.

Clearing the saved list names the count, and says enrolments are not affected —
which is the question anyone hesitating over that button is actually asking.

### The alerts

All four become `Toast`. Two details:

`routeEnrollmentFeedback` decides where an enrolment outcome is reported. Both
the free and the paid failure now go to the toast; the paid one additionally
keeps its inline copy, because the form is still open and the message belongs
beside the fields. The two halves of the flow report the same failure the same
way.

The success toast is raised **after** `navigate`, not before it, so it lands on
the page the learner arrives at rather than blocking the trip there.

## What is covered

`frontend/src/lib/confirmDialog.test.js` — 14 tests: a confirmation carries its
consequence and names its action; a confirm button never says OK; destructive
is the default tone and an unknown tone falls back to it; a request with no
title or no handler is `null`; the handler is carried through unchanged. Then
the enrolment routing: success is a toast; a free-course failure is reported
somewhere it can be re-read — the regression; a paid-course failure keeps its
inline copy; both halves report the same failure identically; and an empty
message on either path still says something rather than showing a blank toast.

## Not addressed here

The dialog traps focus only by placing it on Cancel and honouring Escape; it
does not cycle Tab within the panel. Full focus trapping wants a shared
primitive that the Bootstrap `Modal` usages elsewhere would also use, and that
is a larger change.
