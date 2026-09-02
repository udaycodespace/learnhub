const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCourseIdFilter,
  buildEnrolledDecrementOperations,
  decrementEnrolledCounts,
  groupByCourse,
  removeCourseDependents,
  removeCoursesDependents,
  removeUserDependents,
} = require("../utils/cascadeDelete");

/**
 * A stand-in collection: rows in memory, plus the filters it was asked to
 * delete on, so a test can assert on the query and not only the count.
 */
function createCollection(rows = []) {
  const collection = {
    rows: [...rows],
    deleteFilters: [],
    updates: [],
    bulkWrites: [],
    projections: [],
    // Every call that would be a network hop against a real database. The
    // point of #116 is how many of these there are, so they are recorded.
    roundTrips: [],
    // Mirrors the Mongoose builder: find() and select() are chainable, lean()
    // awaits. select() records the projection so a test can assert that the
    // authored-course pass stopped pulling whole documents (#116).
    find(filter) {
      collection.roundTrips.push({ op: "find", filter });

      const builder = {
        select(projection) {
          collection.projections.push(projection);
          return builder;
        },
        lean: async () => collection.rows.filter((row) => matches(row, filter)),
      };

      return builder;
    },
    async deleteMany(filter) {
      collection.deleteFilters.push(filter);
      collection.roundTrips.push({ op: "deleteMany", filter });

      const before = collection.rows.length;
      collection.rows = collection.rows.filter((row) => !matches(row, filter));

      return { deletedCount: before - collection.rows.length };
    },
    async deleteOne(filter) {
      collection.roundTrips.push({ op: "deleteOne", filter });

      const index = collection.rows.findIndex((row) => matches(row, filter));

      if (index === -1) return { deletedCount: 0 };

      collection.rows.splice(index, 1);
      return { deletedCount: 1 };
    },
    async updateOne(filter, update) {
      collection.updates.push({ filter, update });
      collection.roundTrips.push({ op: "updateOne", filter });

      const row = collection.rows.find((candidate) => matches(candidate, filter));

      if (!row) return { modifiedCount: 0 };

      const inc = update.$inc || {};
      for (const [field, delta] of Object.entries(inc)) {
        row[field] = (row[field] || 0) + delta;
      }

      return { modifiedCount: 1 };
    },
    // One round trip carrying many operations, applied in order. `ordered`
    // matters to what this does: the `enrolled > 0` guard on each operation is
    // re-evaluated as the previous one lands.
    async bulkWrite(operations, options = {}) {
      collection.roundTrips.push({
        op: "bulkWrite",
        count: operations.length,
        ordered: options.ordered,
      });
      collection.bulkWrites.push({ operations, options });

      let modifiedCount = 0;

      for (const operation of operations) {
        const { filter, update } = operation.updateOne;
        const row = collection.rows.find((candidate) =>
          matches(candidate, filter),
        );

        if (!row) continue;

        for (const [field, delta] of Object.entries(update.$inc || {})) {
          row[field] = (row[field] || 0) + delta;
        }

        modifiedCount += 1;
      }

      return { modifiedCount, matchedCount: modifiedCount };
    },
  };

  return collection;
}

function matches(row, filter = {}) {
  return Object.entries(filter).every(([field, expected]) => {
    const actual = row[field];

    if (expected && typeof expected === "object" && "$gt" in expected) {
      return Number(actual) > expected.$gt;
    }

    // The batched cascade deletes many courses in one call.
    if (expected && typeof expected === "object" && "$in" in expected) {
      return expected.$in.some(
        (candidate) => String(actual) === String(candidate),
      );
    }

    return String(actual) === String(expected);
  });
}

function createModels({ courses = [], enrolments = [], payments = [], reviews = [], bookmarks = [], logs = [] } = {}) {
  return {
    Course: createCollection(courses),
    EnrolledCourse: createCollection(enrolments),
    CoursePayment: createCollection(payments),
    CourseReview: createCollection(reviews),
    CourseBookmark: createCollection(bookmarks),
    ActivityLog: createCollection(logs),
  };
}

const noFiles = async () => ({ deleted: [], failed: [] });

// -- deleting a course -------------------------------------------------------

test("deleting a course clears every row that referenced it", async () => {
  const models = createModels({
    enrolments: [
      { _id: "e1", courseId: "c1", userId: "u1" },
      { _id: "e2", courseId: "c1", userId: "u2" },
      { _id: "e3", courseId: "c2", userId: "u1" },
    ],
    payments: [
      { _id: "p1", courseId: "c1", userId: "u1" },
      { _id: "p2", courseId: "c2", userId: "u1" },
    ],
    reviews: [{ _id: "r1", courseId: "c1", userId: "u1" }],
    bookmarks: [
      { _id: "b1", courseId: "c1", userId: "u3" },
      { _id: "b2", courseId: "c2", userId: "u3" },
    ],
  });

  const result = await removeCourseDependents("c1", {
    models,
    cleanupFiles: noFiles,
  });

  assert.deepEqual(
    { ...result, files: undefined },
    {
      enrolments: 2,
      payments: 1,
      reviews: 1,
      bookmarks: 1,
      files: undefined,
    },
  );

  // Another course's rows are untouched.
  assert.deepEqual(
    models.EnrolledCourse.rows.map((row) => row._id),
    ["e3"],
  );
  assert.deepEqual(
    models.CourseBookmark.rows.map((row) => row._id),
    ["b2"],
  );
});

test("deleting a course removes its section videos", async () => {
  const models = createModels();
  const course = {
    _id: "c1",
    sections: [{ S_content: { filename: "one.mp4" } }],
  };

  const cleaned = [];
  const result = await removeCourseDependents("c1", {
    models,
    course,
    cleanupFiles: async (input) => {
      cleaned.push(input);
      return { deleted: ["one.mp4"], failed: [] };
    },
  });

  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0], course);
  assert.equal(result.files.deleted, 1);
  assert.equal(result.files.failed, 0);
});

test("a file that cannot be removed is reported, not thrown", async () => {
  const models = createModels();

  const result = await removeCourseDependents("c1", {
    models,
    course: { _id: "c1", sections: [] },
    cleanupFiles: async () => ({
      deleted: [],
      failed: [{ filename: "locked.mp4", reason: "EBUSY" }],
    }),
  });

  assert.equal(result.files.failed, 1);
});

// -- learner counts ----------------------------------------------------------

test("enrolments are counted per course", () => {
  const counts = groupByCourse([
    { courseId: "c1" },
    { courseId: "c2" },
    { courseId: "c1" },
    { courseId: null },
    {},
  ]);

  assert.equal(counts.get("c1"), 2);
  assert.equal(counts.get("c2"), 1);
  assert.equal(counts.size, 2);
});

test("the learner count drops by one per removed enrolment", async () => {
  const Course = createCollection([
    { _id: "c1", enrolled: 5 },
    { _id: "c2", enrolled: 1 },
  ]);

  await decrementEnrolledCounts(
    new Map([
      ["c1", 2],
      ["c2", 1],
    ]),
    Course,
  );

  assert.equal(Course.rows.find((row) => row._id === "c1").enrolled, 3);
  assert.equal(Course.rows.find((row) => row._id === "c2").enrolled, 0);
});

test("the learner count cannot be driven below zero", async () => {
  // `enrolled` has drifted on existing data — it was only ever incremented —
  // so a course can hold fewer enrolments than its counter claims.
  const Course = createCollection([{ _id: "c1", enrolled: 1 }]);

  await decrementEnrolledCounts(new Map([["c1", 4]]), Course);

  assert.equal(Course.rows[0].enrolled, 0);
});

// -- deleting a user ---------------------------------------------------------

test("deleting a student clears their rows and corrects the learner counts", async () => {
  const models = createModels({
    courses: [
      { _id: "c1", userId: "teacher-1", enrolled: 3 },
      { _id: "c2", userId: "teacher-1", enrolled: 1 },
    ],
    enrolments: [
      { _id: "e1", courseId: "c1", userId: "student-1" },
      { _id: "e2", courseId: "c2", userId: "student-1" },
      { _id: "e3", courseId: "c1", userId: "student-2" },
    ],
    payments: [{ _id: "p1", courseId: "c1", userId: "student-1" }],
    reviews: [{ _id: "r1", courseId: "c1", userId: "student-1" }],
    bookmarks: [{ _id: "b1", courseId: "c1", userId: "student-1" }],
    logs: [
      { _id: "l1", userId: "student-1" },
      { _id: "l2", userId: "student-2" },
    ],
  });

  const summary = await removeUserDependents("student-1", {
    models,
    cleanupFiles: noFiles,
  });

  assert.equal(summary.authoredCourses, 0);
  assert.equal(summary.enrolments, 2);
  assert.equal(summary.payments, 1);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.bookmarks, 1);
  assert.equal(summary.activityLogs, 1);

  // The other student keeps theirs.
  assert.deepEqual(
    models.EnrolledCourse.rows.map((row) => row._id),
    ["e3"],
  );
  assert.deepEqual(
    models.ActivityLog.rows.map((row) => row._id),
    ["l2"],
  );

  // Both courses lose the one learner that went away.
  assert.equal(models.Course.rows.find((row) => row._id === "c1").enrolled, 2);
  assert.equal(models.Course.rows.find((row) => row._id === "c2").enrolled, 0);
});

test("deleting a teacher takes their courses, and those courses' rows, with them", async () => {
  const models = createModels({
    courses: [
      { _id: "c1", userId: "teacher-1", enrolled: 2, sections: [] },
      { _id: "c9", userId: "teacher-2", enrolled: 1, sections: [] },
    ],
    enrolments: [
      { _id: "e1", courseId: "c1", userId: "student-1" },
      { _id: "e2", courseId: "c1", userId: "student-2" },
      { _id: "e9", courseId: "c9", userId: "student-1" },
    ],
    payments: [{ _id: "p1", courseId: "c1", userId: "student-1" }],
    reviews: [{ _id: "r1", courseId: "c1", userId: "student-2" }],
    bookmarks: [{ _id: "b1", courseId: "c1", userId: "student-3" }],
  });

  const cleaned = [];
  const summary = await removeUserDependents("teacher-1", {
    models,
    cleanupFiles: async (course) => {
      cleaned.push(course._id);
      return { deleted: ["a.mp4"], failed: [] };
    },
  });

  assert.equal(summary.authoredCourses, 1);
  assert.equal(summary.enrolments, 2);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.bookmarks, 1);
  assert.equal(summary.files.deleted, 1);

  assert.deepEqual(cleaned, ["c1"], "only the authored course is cleaned up");

  // Another teacher's course and its enrolment survive.
  assert.deepEqual(
    models.Course.rows.map((row) => row._id),
    ["c9"],
  );
  assert.deepEqual(
    models.EnrolledCourse.rows.map((row) => row._id),
    ["e9"],
  );
});

test("authored courses are matched on the string userId the course schema stores", async () => {
  // courseModel.userId is a String while every other reference is an ObjectId.
  // Passing the ObjectId straight through matches nothing and silently leaves
  // the courses behind.
  const objectIdLike = {
    toString: () => "507f1f77bcf86cd799439011",
  };

  const models = createModels({
    courses: [{ _id: "c1", userId: "507f1f77bcf86cd799439011", enrolled: 0, sections: [] }],
  });

  const summary = await removeUserDependents(objectIdLike, {
    models,
    cleanupFiles: noFiles,
  });

  assert.equal(summary.authoredCourses, 1);
  assert.equal(models.Course.rows.length, 0);
});

test("deleting a user with nothing attached is a no-op that still reports", async () => {
  const models = createModels();

  const summary = await removeUserDependents("nobody", {
    models,
    cleanupFiles: noFiles,
  });

  assert.deepEqual(summary, {
    authoredCourses: 0,
    enrolments: 0,
    payments: 0,
    reviews: 0,
    bookmarks: 0,
    activityLogs: 0,
    files: { deleted: 0, failed: 0 },
  });
});

// -- how many round trips it takes (#116) ------------------------------------
//
// Everything above asserts the outcome, and every one of those tests passed
// unchanged against both the old implementation and this one — which is the
// point: the rows removed, the counters written and the summary returned are
// identical. What follows asserts the cost, because that is the only thing
// that actually changed and nothing was watching it.
//
// The old shape was one awaited `updateOne` per enrolment — not per course —
// and a full five-call cascade per authored course. A teacher with 40 courses
// and 300 enrolments was around 500 sequential operations inside one HTTP
// request that the admin dashboard awaits with no progress indication.

test("learner counts are corrected in one round trip, not one per enrolment", async () => {
  const Course = createCollection([
    { _id: "c1", enrolled: 40 },
    { _id: "c2", enrolled: 40 },
    { _id: "c3", enrolled: 40 },
  ]);

  const issued = await decrementEnrolledCounts(
    new Map([
      ["c1", 30],
      ["c2", 20],
      ["c3", 10],
    ]),
    Course,
  );

  assert.equal(issued, 60);
  assert.equal(Course.roundTrips.length, 1);
  assert.equal(Course.roundTrips[0].op, "bulkWrite");
  assert.equal(Course.roundTrips[0].count, 60);

  // Still 60 guarded operations, so the arithmetic is unchanged.
  assert.equal(Course.rows.find((row) => row._id === "c1").enrolled, 10);
  assert.equal(Course.rows.find((row) => row._id === "c2").enrolled, 20);
  assert.equal(Course.rows.find((row) => row._id === "c3").enrolled, 30);
});

test("the decrements are ordered, because the guard depends on it", async () => {
  // Each operation carries `enrolled: { $gt: 0 }`, re-evaluated as the
  // previous one lands. Two unordered decrements against a course sitting at 1
  // could both see the guard satisfied and take it to -1.
  const Course = createCollection([{ _id: "c1", enrolled: 1 }]);

  await decrementEnrolledCounts(new Map([["c1", 3]]), Course);

  assert.equal(Course.bulkWrites[0].options.ordered, true);
  assert.equal(Course.rows[0].enrolled, 0);
});

test("nothing to decrement issues no write at all", async () => {
  const Course = createCollection([{ _id: "c1", enrolled: 5 }]);

  assert.equal(await decrementEnrolledCounts(new Map(), Course), 0);
  assert.deepEqual(Course.roundTrips, []);
  assert.equal(Course.rows[0].enrolled, 5);
});

test("the decrement operations are one guarded $inc per enrolment", () => {
  // The shape, without a database. A single `$inc: -count` would be one
  // operation instead of three, and would have no guard to stop it going
  // negative on a counter that has already drifted.
  const operations = buildEnrolledDecrementOperations(new Map([["c1", 3]]));

  assert.equal(operations.length, 3);

  for (const operation of operations) {
    assert.deepEqual(operation, {
      updateOne: {
        filter: { _id: "c1", enrolled: { $gt: 0 } },
        update: { $inc: { enrolled: -1 } },
      },
    });
  }
});

test("many courses cascade in four deletes, not four per course", async () => {
  const courseIds = Array.from({ length: 25 }, (_, index) => `c${index}`);

  const models = createModels({
    enrolments: courseIds.map((courseId, index) => ({
      _id: `e${index}`,
      courseId,
      userId: "u1",
    })),
  });

  const result = await removeCoursesDependents(courseIds, {
    models,
    cleanupFiles: noFiles,
  });

  assert.equal(result.enrolments, 25);

  for (const name of [
    "EnrolledCourse",
    "CoursePayment",
    "CourseReview",
    "CourseBookmark",
  ]) {
    assert.equal(
      models[name].roundTrips.length,
      1,
      `${name} should be deleted from once, not once per course`,
    );
  }
});

test("deleting a teacher is a fixed number of round trips, not per course", async () => {
  const courses = Array.from({ length: 20 }, (_, index) => ({
    _id: `c${index}`,
    userId: "teacher-1",
    enrolled: 1,
    sections: [],
  }));

  const models = createModels({
    courses,
    enrolments: courses.map((course, index) => ({
      _id: `e${index}`,
      courseId: course._id,
      userId: "student-1",
    })),
  });

  const summary = await removeUserDependents("teacher-1", {
    models,
    cleanupFiles: noFiles,
  });

  assert.equal(summary.authoredCourses, 20);
  assert.equal(summary.enrolments, 20);

  // One find for the authored courses, one deleteMany to remove them, and one
  // find for the user's own enrolments. No bulkWrite: this teacher had no
  // enrolments of their own in anybody else's course.
  assert.deepEqual(
    models.Course.roundTrips.map((entry) => entry.op),
    ["find", "deleteMany"],
  );

  // Each of the four dependent collections is touched twice regardless of how
  // many courses there were: once for the authored courses, once for the
  // user's own rows.
  for (const name of ["CoursePayment", "CourseReview", "CourseBookmark"]) {
    assert.equal(
      models[name].roundTrips.length,
      2,
      `${name} scaled with the number of courses`,
    );
  }

  // EnrolledCourse also reads the user's own enrolments before deleting them.
  assert.deepEqual(
    models.EnrolledCourse.roundTrips.map((entry) => entry.op),
    ["deleteMany", "find", "deleteMany"],
  );
});

test("the authored-course read asks for the two fields it uses", async () => {
  // `sections` carries every section's S_title, S_description and
  // S_content.path. On a course with twenty sections it is the largest field
  // in the document, and the loop reads nothing else off these rows.
  const models = createModels({
    courses: [{ _id: "c1", userId: "teacher-1", enrolled: 0, sections: [] }],
  });

  await removeUserDependents("teacher-1", { models, cleanupFiles: noFiles });

  assert.deepEqual(models.Course.projections, ["_id sections"]);
  assert.deepEqual(models.EnrolledCourse.projections, ["courseId"]);
});

test("one course is still an equality match, not a one-element $in", () => {
  // The common path — a teacher deleting a single course — should read in the
  // profiler as the query it always was.
  assert.deepEqual(buildCourseIdFilter(["c1"]), { courseId: "c1" });
  assert.deepEqual(buildCourseIdFilter(["c1", "c2"]), {
    courseId: { $in: ["c1", "c2"] },
  });
});

test("deleting one course issues the same four deletes it always did", async () => {
  const models = createModels({
    enrolments: [{ _id: "e1", courseId: "c1", userId: "u1" }],
  });

  await removeCourseDependents("c1", { models, cleanupFiles: noFiles });

  for (const name of [
    "EnrolledCourse",
    "CoursePayment",
    "CourseReview",
    "CourseBookmark",
  ]) {
    assert.deepEqual(models[name].roundTrips, [
      { op: "deleteMany", filter: { courseId: "c1" } },
    ]);
  }
});

test("video cleanup is still one call per course, with the course document", async () => {
  // The one part of a cascade that is genuinely per-item: every section video
  // is its own unlink. Batching this would trade a latency problem for a
  // file-descriptor one.
  const courses = [
    { _id: "c1", sections: [{ S_content: { filename: "a.mp4" } }] },
    { _id: "c2", sections: [{ S_content: { filename: "b.mp4" } }] },
  ];

  const cleaned = [];

  const result = await removeCoursesDependents(["c1", "c2"], {
    models: createModels(),
    courses,
    cleanupFiles: async (course) => {
      cleaned.push(course._id);
      return { deleted: ["x.mp4"], failed: [] };
    },
  });

  assert.deepEqual(cleaned, ["c1", "c2"]);
  assert.equal(result.files.deleted, 2);
});

test("a course deleted between the read and the delete is not counted", async () => {
  // authoredCourses reports what the delete removed, not what the find saw.
  const models = createModels({
    courses: [{ _id: "c1", userId: "teacher-1", enrolled: 0, sections: [] }],
  });

  const realDeleteMany = models.Course.deleteMany.bind(models.Course);
  models.Course.deleteMany = async (filter) => {
    // Somebody else removed it first.
    models.Course.rows = [];
    return realDeleteMany(filter);
  };

  const summary = await removeUserDependents("teacher-1", {
    models,
    cleanupFiles: noFiles,
  });

  assert.equal(summary.authoredCourses, 0);
});
