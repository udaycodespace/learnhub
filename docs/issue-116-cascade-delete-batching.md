# Batching the delete cascade (#116)

## The defect

`removeUserDependents` did its work one row and one course at a time.

The learner counts were one awaited round trip **per enrolment**, not per
course:

```js
for (const [courseId, count] of countsByCourse) {
  for (let step = 0; step < count; step += 1) {
    await CourseModel.updateOne(
      { _id: courseId, enrolled: { $gt: 0 } },
      { $inc: { enrolled: -1 } },
    );
  }
}
```

The authored courses were a full five-call cascade each:

```js
const authored = await models.Course.find({ userId: String(userId) }).lean();

for (const course of authored) {
  const courseResult = await removeCourseDependents(course._id, { ... });  // 4 deleteMany
  ...
  await models.Course.deleteOne({ _id: course._id });                      // + 1
}
```

For an account with `E` enrolments and `A` authored courses:

| work | before | after |
| --- | --- | --- |
| decrement learner counts | `E` | 1 |
| cascade authored courses | `5 × A` | 5 |
| own rows | 5 | 5 |

A teacher with 40 courses and 300 enrolments was around 500 sequential
operations, each paying a full latency hop, inside one HTTP request that
`deleteUserController` awaits before answering. The admin dashboard shows no
progress and has no timeout handling for it.

`find({ userId })` also loaded whole course documents. The loop reads `_id` and
the filenames; `sections` carries every section's `S_title`, `S_description`
and `S_content.path`, so on a course with twenty sections it is the largest
field in the document, fetched to be thrown away.

Same defect class as #96 and #104, on the write path rather than the read path.

## The fix

### `decrementEnrolledCounts`

One `bulkWrite` instead of `E` awaited `updateOne` calls.

**The operations are unchanged.** It is still one guarded `$inc: -1` per
enrolment rather than a single `$inc: -count`, because `enrolled` has drifted
on existing data — it was only ever incremented, and nothing decremented it
before #74 — so a course can hold fewer enrolments than its counter claims. The
`enrolled: { $gt: 0 }` filter is re-evaluated per operation, which is what stops
the counter going negative and rendering `LEARNERS: -3` on a catalogue card. A
single `$inc: -count` would have no such guard.

`ordered: true` is load-bearing, not decoration. The guard only works if the
operations land one after another: two unordered decrements against a course
sitting at 1 could both see `enrolled > 0`.

Verified against a real MongoDB rather than only the test stub:

```
drifted (was 1, asked -4) -> 0 (expected 0, never negative)
healthy (was 10, asked -3) -> 7 (expected 7)
```

### `removeCoursesDependents(courseIds, ...)` (new)

The batched form: four `deleteMany` calls in total, whatever the number of
courses. `removeCourseDependents(courseId, ...)` is now the single-course
wrapper around it, unchanged in signature and in what it returns, because
`courseDeletionController` calls it directly.

`buildCourseIdFilter` keeps a single id as an equality match rather than a
one-element `$in`. Both use the same index, but the common path — a teacher
deleting one course — should read in the profiler as the query it always was.
There is a test asserting the emitted filter for that path is byte-identical.

### `removeUserDependents`

Collects the authored ids, cascades them in one pass, and removes them with one
`deleteMany({ _id: { $in } })`.

`authoredCourses` now reports what the delete removed rather than what the find
saw — a course removed by somebody else between the two should not be counted.
There is a test for it.

### The projections

`find({ userId }).select("_id sections")` for the authored courses and
`.select("courseId")` for the user's own enrolments. Those are the only fields
either loop reads; `removeCourseVideoFiles` looks at `course.sections` and
nothing else.

## What stayed sequential, and why

The video cleanup. Every section video is its own `unlink`, so it is the one
part of a cascade that is genuinely per-item, and firing an unbounded number of
them at once trades a latency problem for a file-descriptor one. It is still one
call per course, receiving the course document, and there is a test pinning
that.

## Tests

Every one of the 10 existing tests in `cascade-delete.test.js` passes
**unchanged** against both implementations. That is the point of this change:
the rows removed, the counters written and the summary returned are identical.

The 11 new ones assert the thing that actually changed, which nothing was
watching:

- 60 decrements across three courses is **one** round trip, and the arithmetic
  is still 40→10, 40→20, 40→30.
- The bulk write is `ordered: true`, and a counter at 1 asked to drop by 3
  lands on 0.
- An empty map issues no write at all.
- 25 courses cascade in one `deleteMany` per collection, not 25.
- Deleting a teacher with 20 courses touches `Course` exactly twice — one
  `find`, one `deleteMany` — and each dependent collection twice regardless of
  the course count.
- The projections are `"_id sections"` and `"courseId"`.
- One course still emits `{ courseId: "c1" }`.

The stub collection in that file grew a `roundTrips` log, a `bulkWrite`, a
chainable `select()` and `$in` support in its matcher, so the cost is assertable
without a database.

## Verifying

```bash
cd backend && npm test    # 424 pass (413 before, 11 added)
```

Against a live database, `db.setProfilingLevel(2)` and count `db.system.profile`
entries for one `DELETE /api/admin/deleteuser/:userid`.

## Notes

- Purely a performance change. `removeCourseDependents`, `groupByCourse` and
  `decrementEnrolledCounts` keep their names and their behaviour;
  `decrementEnrolledCounts` now returns the number of operations it issued,
  where it previously returned nothing.
- The `removed` block on the delete-user response is part of the API and is
  unchanged, including `files.deleted` and `files.failed`.
- `bulkWrite` has a 100,000-operation limit per call, and the driver splits
  larger batches itself. An account with more than 100,000 enrolments would be
  a different conversation anyway.
- The `enrolled` counter drift is not fixed here, only kept from getting worse.
  A recount would rewrite history an admin has been looking at, which is a
  decision rather than a cleanup.
