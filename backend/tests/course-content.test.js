const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

// The controller mints a playback token once it has confirmed the enrolment
// (#76), and signPlaybackToken refuses to sign without a secret. Set one before
// the controller is required, the way the other suites here do, so a missing
// secret cannot masquerade as a broken course-content response.
process.env.JWT_SECRET = process.env.JWT_SECRET || "course-content-secret";

const {
  createGetCourseContentController,
} = require("../controllers/courseContentController");
const {
  createCompleteSectionController,
  projectProgress,
  setClock,
} = require("../controllers/progressController");
const {
  buildProgressSummary,
  completedSectionIds,
  countCompletedSections,
  describeSections,
  isEnrollmentComplete,
} = require("../utils/courseProgress");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function leanable(value) {
  return {
    lean: async () => value,
    then: (resolve) => resolve(value),
  };
}

function createModels({ course, enrollment } = {}) {
  return {
    Course: { findById: () => leanable(course) },
    EnrolledCourse: { findOne: () => leanable(enrollment) },
    isValidObjectId: mongoose.isValidObjectId,
    logger: { error() {} },
  };
}

const COURSE_ID = new mongoose.Types.ObjectId().toString();
const USER_ID = new mongoose.Types.ObjectId().toString();

function createRequest(courseid = COURSE_ID, user = { _id: USER_ID }) {
  return { params: { courseid }, user, body: {} };
}

/* ------------------------------------------------------------------ *
 * utils/courseProgress
 * ------------------------------------------------------------------ */

test("distinct ids are counted once, whatever their type", () => {
  const progress = [
    { sectionId: 0 },
    { sectionId: "0" },
    { sectionId: 1 },
    { sectionId: null },
    null,
    {},
  ];

  assert.deepEqual([...completedSectionIds(progress)], ["0", "1"]);
  assert.equal(countCompletedSections(progress), 2);
  assert.equal(countCompletedSections("not an array"), 0);
});

test("a duplicated progress row cannot push completion past the total", () => {
  const summary = buildProgressSummary({
    course_Length: 2,
    progress: [{ sectionId: 0 }, { sectionId: 0 }, { sectionId: 1 }],
  });

  assert.deepEqual(summary, { completed: 2, total: 2, percent: 100 });
});

test("progress for a section the course no longer has does not complete it", () => {
  // The old client compared `progress.length` with the number of sections, so
  // three stale rows against two sections read as finished.
  const enrollment = {
    course_Length: 3,
    progress: [{ sectionId: 0 }, { sectionId: 5 }],
  };

  assert.deepEqual(buildProgressSummary(enrollment), {
    completed: 2,
    total: 3,
    percent: 67,
  });
  assert.equal(isEnrollmentComplete(enrollment), false);
});

test("an enrolment with no sections is never complete", () => {
  assert.equal(isEnrollmentComplete({ course_Length: 0, progress: [] }), false);
  assert.equal(isEnrollmentComplete({}), false);
});

test("a section without a video is described, and marked completable", () => {
  const sections = describeSections(
    [
      { S_title: "One", S_content: { path: "/uploads/a.mp4" } },
      { S_title: "Two", S_description: "Reading only" },
    ],
    [{ sectionId: 1 }],
  );

  assert.equal(sections.length, 2);
  assert.equal(sections[0].hasVideo, true);
  assert.equal(sections[0].completed, false);
  // The whole of #93: this section has no video, and it is still here, and it
  // is completed.
  assert.equal(sections[1].hasVideo, false);
  assert.equal(sections[1].completed, true);
  assert.equal(sections[1].S_title, "Two");
});

test("sections stored as an object map are described in order", () => {
  const sections = describeSections(
    { 0: { S_title: "One" }, 1: { S_title: "Two" } },
    [],
  );

  assert.deepEqual(
    sections.map((section) => section.S_title),
    ["One", "Two"],
  );
  assert.deepEqual(
    sections.map((section) => section.index),
    [0, 1],
  );
});

test("a section completed by its _id is matched as well as by its index", () => {
  const sectionId = new mongoose.Types.ObjectId();
  const sections = describeSections([{ _id: sectionId, S_title: "One" }], [
    { sectionId: sectionId.toString() },
  ]);

  assert.equal(sections[0].completed, true);
  assert.equal(sections[0].sectionId, sectionId.toString());
});

test("a missing title falls back to the section position", () => {
  const sections = describeSections([{}, {}], []);

  assert.deepEqual(
    sections.map((section) => section.S_title),
    ["Section 1", "Section 2"],
  );
});

/* ------------------------------------------------------------------ *
 * GET /api/user/coursecontent/:courseid
 * ------------------------------------------------------------------ */

test("returns the sections, the progress summary and the certificate date", async () => {
  const certificateDate = new Date("2026-02-01T10:00:00.000Z");
  const controller = createGetCourseContentController(
    createModels({
      course: {
        _id: COURSE_ID,
        C_title: "Intro",
        C_educator: "Jane",
        sections: [{ S_title: "One" }, { S_title: "Two" }],
      },
      enrollment: {
        course_Length: 2,
        progress: [{ sectionId: 0 }, { sectionId: 1 }],
        certificateDate,
      },
    }),
  );
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.courseTitle, "Intro");
  assert.equal(res.body.courseEducator, "Jane");
  assert.deepEqual(res.body.progress, { completed: 2, total: 2, percent: 100 });
  assert.equal(res.body.isComplete, true);
  assert.equal(res.body.certificateDate, certificateDate);
  assert.equal(res.body.courseContent.length, 2);
  assert.equal(res.body.courseContent[0].completed, true);
  // Minted here because this is the only place the enrolment is known (#76).
  assert.equal(typeof res.body.playbackToken, "string");
  assert.ok(res.body.playbackToken.length > 0);
});

test("certificateDate is null rather than the enrolment's last write", async () => {
  const controller = createGetCourseContentController(
    createModels({
      course: { C_title: "Intro", sections: [{ S_title: "One" }] },
      enrollment: {
        course_Length: 1,
        progress: [],
        // Present on every document, and never a completion date.
        updatedAt: new Date("2026-02-01T10:00:00.000Z"),
      },
    }),
  );
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.body.certificateDate, null);
  assert.equal(res.body.isComplete, false);
  assert.equal(res.body.certficateData, undefined);
});

test("a caller who is not enrolled is refused, not reported missing", async () => {
  const controller = createGetCourseContentController(
    createModels({
      course: { C_title: "Intro", sections: [] },
      enrollment: null,
    }),
  );
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.message, "You are not enrolled in this course");
});

test("a missing course is a 404", async () => {
  const controller = createGetCourseContentController(
    createModels({ course: null, enrollment: null }),
  );
  const res = createResponse();

  await controller(createRequest(), res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "No such course found");
});

test("a malformed course id is rejected before the models are touched", async () => {
  let touched = false;
  const controller = createGetCourseContentController({
    Course: {
      findById() {
        touched = true;
        return leanable(null);
      },
    },
    EnrolledCourse: { findOne: () => leanable(null) },
    isValidObjectId: mongoose.isValidObjectId,
  });
  const res = createResponse();

  await controller(createRequest("not-an-object-id"), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid course ID");
  assert.equal(touched, false);
});

test("the enrolment is resolved from req.user, not from the request body", async () => {
  const filters = [];
  const controller = createGetCourseContentController({
    Course: { findById: () => leanable({ C_title: "Intro", sections: [] }) },
    EnrolledCourse: {
      findOne(filter) {
        filters.push(filter);
        return leanable({ course_Length: 0, progress: [] });
      },
    },
    isValidObjectId: mongoose.isValidObjectId,
  });
  const res = createResponse();
  const req = createRequest();
  req.body = { userId: "somebody-elses-id" };

  await controller(req, res);

  assert.equal(filters[0].userId, USER_ID);
});

test("an unauthenticated request is a 401", async () => {
  const controller = createGetCourseContentController(createModels({}));
  const res = createResponse();

  await controller(createRequest(COURSE_ID, null), res);

  assert.equal(res.statusCode, 401);
});

/* ------------------------------------------------------------------ *
 * POST /api/user/completemodule — certificate stamping
 * ------------------------------------------------------------------ */

function createProgressModels({
  sections = [{ S_title: "One" }, { S_title: "Two" }],
  enrollment,
  modifiedCount = 1,
} = {}) {
  const calls = { updateOne: [] };

  return {
    calls,
    models: {
      CourseModel: { async findById() { return { sections }; } },
      EnrolledCourseModel: {
        async findOne() {
          return enrollment;
        },
        async updateOne(filter, update) {
          calls.updateOne.push({ filter, update });
          return { matchedCount: 1, modifiedCount };
        },
      },
    },
  };
}

function progressRequest(sectionId) {
  return {
    body: { courseId: COURSE_ID, sectionId },
    user: { _id: USER_ID },
  };
}

test("completing the last section stamps the certificate date once", async () => {
  const stamped = new Date("2026-03-04T09:30:00.000Z");
  setClock(() => stamped);

  const { calls, models } = createProgressModels({
    enrollment: {
      _id: new mongoose.Types.ObjectId(),
      course_Length: 2,
      progress: [{ sectionId: 0 }],
      certificateDate: null,
    },
  });
  const res = createResponse();

  await createCompleteSectionController(models)(progressRequest(1), res);
  setClock(null);

  assert.equal(res.body.success, true);
  assert.equal(res.body.isComplete, true);
  assert.equal(res.body.certificateDate, stamped);
  assert.deepEqual(res.body.progress, { completed: 2, total: 2, percent: 100 });

  // Two writes: the progress entry, then the certificate stamp.
  assert.equal(calls.updateOne.length, 2);
  assert.deepEqual(calls.updateOne[1].update, {
    $set: { certificateDate: stamped },
  });
  // Guarded, so a concurrent completion cannot overwrite the date.
  assert.ok(Array.isArray(calls.updateOne[1].filter.$or));
});

test("completing a middle section does not stamp a certificate", async () => {
  const { calls, models } = createProgressModels({
    sections: [{}, {}, {}],
    enrollment: {
      _id: new mongoose.Types.ObjectId(),
      course_Length: 3,
      progress: [],
    },
  });
  const res = createResponse();

  await createCompleteSectionController(models)(progressRequest(0), res);

  assert.equal(res.body.isComplete, false);
  assert.equal(res.body.certificateDate, null);
  assert.deepEqual(res.body.progress, { completed: 1, total: 3, percent: 33 });
  assert.equal(calls.updateOne.length, 1);
});

test("an already-stamped enrolment is not re-stamped", async () => {
  const original = new Date("2026-01-01T00:00:00.000Z");
  const { calls, models } = createProgressModels({
    modifiedCount: 0,
    enrollment: {
      _id: new mongoose.Types.ObjectId(),
      course_Length: 2,
      progress: [{ sectionId: 0 }, { sectionId: 1 }],
      certificateDate: original,
    },
  });
  const res = createResponse();

  await createCompleteSectionController(models)(progressRequest(1), res);

  assert.equal(res.body.alreadyCompleted, true);
  assert.equal(res.body.certificateDate, original);
  assert.equal(calls.updateOne.length, 1);
});

test("a section with no video completes like any other", async () => {
  const { models } = createProgressModels({
    sections: [
      { S_title: "One", S_content: { path: "/uploads/a.mp4" } },
      { S_title: "Two" },
    ],
    enrollment: {
      _id: new mongoose.Types.ObjectId(),
      course_Length: 2,
      progress: [{ sectionId: 0 }],
    },
  });
  const res = createResponse();

  await createCompleteSectionController(models)(progressRequest(1), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.isComplete, true);
});

test("projectProgress adds an id once and leaves an existing one alone", () => {
  assert.deepEqual(projectProgress([{ sectionId: 0 }], 1), [
    { sectionId: 0 },
    { sectionId: 1 },
  ]);
  assert.deepEqual(projectProgress([{ sectionId: 1 }], 1), [{ sectionId: 1 }]);
  assert.deepEqual(projectProgress([{ sectionId: 1 }], null), [
    { sectionId: 1 },
  ]);
  assert.deepEqual(projectProgress(undefined, 0), [{ sectionId: 0 }]);
});
