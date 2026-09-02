const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EDITABLE_FIELDS,
  MAX_SECTION_TITLE_LENGTH,
  toEditableCourse,
  validateCourseEdit,
} = require("../utils/courseEdit");

const {
  canEditCourse,
  createCourseUpdateControllers,
} = require("../controllers/courseUpdateController");

const { MAX_TITLE_LENGTH } = require("../utils/courseInput");

// #127. A course could be created and deleted and nothing else:
//
//   $ grep -rn "router.put\|router.patch" backend/routers
//   backend/routers/courseReviewRoutes.js:25:router.put("/review/:reviewId", ...)
//
// So correcting a typo meant deleting the course, and deleteCourseController
// removes every section video from disk and then every enrolment, payment,
// review and bookmark that pointed at it (#74).
//
// Models are injected; no database. The suites that start one already run in
// parallel and adding another tips the run into startup timeouts.

const OWNER_ID = "64a000000000000000000001";
const OTHER_ID = "64a000000000000000000002";
const COURSE_ID = "64b000000000000000000001";

const storedCourse = () => ({
  _id: COURSE_ID,
  userId: OWNER_ID,
  C_educator: "Original Educator",
  C_title: "Introduciton to CSS",
  C_categories: "Design",
  C_price: "499",
  C_description: "A course about CSS.",
  enrolled: 42,
  sections: [
    {
      S_title: "Selectors",
      S_description: "How selectors work.",
      S_content: { filename: "a.mp4", path: "/uploads/a.mp4" },
    },
    {
      S_title: "The cascade",
      S_description: "Specificity and order.",
      S_content: { filename: "b.mp4", path: "/uploads/b.mp4" },
    },
  ],
});

function mockResponse() {
  return {
    statusCode: 0,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function courseStub(course = storedCourse()) {
  const model = {
    stored: course,
    updates: [],
    findById(id) {
      return {
        lean: async () =>
          String(id) === String(course._id) ? { ...course } : null,
      };
    },
    findOneAndUpdate(filter, update) {
      model.updates.push({ filter, update });
      Object.assign(course, update.$set || {});

      return { lean: async () => ({ ...course }) };
    },
  };

  return model;
}

const build = (Course) =>
  createCourseUpdateControllers({
    Course,
    isValidObjectId: () => true,
    logger: { error() {}, warn() {} },
  });

const asOwner = (body) => ({
  params: { courseid: COURSE_ID },
  user: { _id: OWNER_ID, type: "teacher", name: "Renamed Educator" },
  body,
});

// -- what may be edited ------------------------------------------------------

test("only the four metadata fields are editable", () => {
  assert.deepEqual(EDITABLE_FIELDS, [
    "C_title",
    "C_categories",
    "C_description",
    "C_price",
  ]);
});

test("an edit changes only the fields the body carries", () => {
  const result = validateCourseEdit({
    body: { C_title: "Introduction to CSS" },
    course: storedCourse(),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.changes, { C_title: "Introduction to CSS" });
});

test("the fields a client must never write are ignored", () => {
  const result = validateCourseEdit({
    body: {
      C_title: "Introduction to CSS",
      // The three that would matter: ownership (#83), the learner count the
      // catalogue sorts by, and the stored path of a video (#76).
      userId: OTHER_ID,
      enrolled: 99999,
      C_educator: "Somebody Else",
      _id: "64b0000000000000000000ff",
    },
    course: storedCourse(),
  });

  assert.deepEqual(Object.keys(result.changes), ["C_title"]);
});

test("a required field cannot be blanked", () => {
  for (const field of ["C_title", "C_categories", "C_description"]) {
    const result = validateCourseEdit({
      body: { [field]: "   " },
      course: storedCourse(),
    });

    assert.equal(result.valid, false, field);
    assert.ok(result.errors[field], field);
  }
});

test("a blank price is a value, not a mistake", () => {
  // #114 settled that a blank price means free.
  const result = validateCourseEdit({
    body: { C_price: "" },
    course: storedCourse(),
  });

  assert.equal(result.valid, true);
  assert.equal(result.changes.C_price, "free");
});

test("the length limits are the ones the create path enforces", () => {
  const tooLong = "x".repeat(MAX_TITLE_LENGTH + 1);

  assert.equal(
    validateCourseEdit({ body: { C_title: tooLong }, course: storedCourse() })
      .valid,
    false,
  );
  assert.equal(
    validateCourseEdit({
      body: { C_title: "x".repeat(MAX_TITLE_LENGTH) },
      course: storedCourse(),
    }).valid,
    true,
  );
});

test("a body with nothing editable is refused rather than silently accepted", () => {
  const result = validateCourseEdit({
    body: { enrolled: 1, userId: OTHER_ID },
    course: storedCourse(),
  });

  assert.equal(result.valid, false);
  assert.equal(result.empty, true);
});

// -- sections ----------------------------------------------------------------

test("section text is rewritten and the stored video is not touched", () => {
  const course = storedCourse();

  const result = validateCourseEdit({
    body: {
      sections: [
        { S_title: "CSS selectors", S_description: "How selectors work." },
        { S_title: "The cascade", S_description: "Specificity, order, origin." },
      ],
    },
    course,
  });

  assert.equal(result.valid, true);
  assert.equal(result.changes.sections[0].S_title, "CSS selectors");
  assert.equal(
    result.changes.sections[1].S_description,
    "Specificity, order, origin.",
  );

  // The whole point: no upload happened, so no file reference changes.
  assert.deepEqual(result.changes.sections[0].S_content, {
    filename: "a.mp4",
    path: "/uploads/a.mp4",
  });
  assert.deepEqual(result.changes.sections[1].S_content, {
    filename: "b.mp4",
    path: "/uploads/b.mp4",
  });
});

test("a section's stored file path cannot be rewritten from the body", () => {
  const result = validateCourseEdit({
    body: {
      sections: [
        {
          S_title: "Selectors",
          S_content: { filename: "../../etc/passwd", path: "/etc/passwd" },
        },
        { S_title: "The cascade" },
      ],
    },
    course: storedCourse(),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.changes.sections[0].S_content, {
    filename: "a.mp4",
    path: "/uploads/a.mp4",
  });
});

test("adding or removing a section here is refused, not silently ignored", () => {
  // The count is fixed by the uploads, and this route takes no uploads.
  for (const sections of [[{ S_title: "One" }], [{}, {}, {}]]) {
    const result = validateCourseEdit({
      body: { sections },
      course: storedCourse(),
    });

    assert.equal(result.valid, false);
    assert.match(result.errors.sections, /2 sections/);
  }
});

test("a section title cannot be blanked, and is length-checked", () => {
  const blank = validateCourseEdit({
    body: { sections: [{ S_title: "  " }, { S_title: "The cascade" }] },
    course: storedCourse(),
  });

  assert.equal(blank.valid, false);
  assert.ok(blank.errors["sections.0.S_title"]);

  const long = validateCourseEdit({
    body: {
      sections: [
        { S_title: "x".repeat(MAX_SECTION_TITLE_LENGTH + 1) },
        { S_title: "The cascade" },
      ],
    },
    course: storedCourse(),
  });

  assert.equal(long.valid, false);
  assert.ok(long.errors["sections.0.S_title"]);
});

test("sections must be a list", () => {
  const result = validateCourseEdit({
    body: { sections: { 0: { S_title: "One" } } },
    course: storedCourse(),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.sections);
});

// -- the editable view -------------------------------------------------------

test("the edit view carries section text but never a file path", () => {
  const view = toEditableCourse(storedCourse());

  assert.equal(view.sections.length, 2);
  assert.equal(view.sections[0].S_title, "Selectors");
  assert.equal(view.sections[0].hasVideo, true);

  // #94 kept the stored paths out of the educator's list response; an edit
  // form has no more reason to see them.
  assert.doesNotMatch(JSON.stringify(view), /uploads|\.mp4/);
});

test("a course whose sections field is not an array does not throw", () => {
  // The schema declares `sections: {}`, so the collection holds whatever was
  // written. One such document blanked the whole educator dashboard in #94.
  for (const sections of [undefined, null, {}, "nope", 7]) {
    const view = toEditableCourse({ _id: COURSE_ID, sections });
    assert.deepEqual(view.sections, []);
  }
});

// -- who may edit ------------------------------------------------------------

test("a teacher may edit only their own course", () => {
  const course = storedCourse();

  assert.equal(canEditCourse(course, { role: "teacher", userId: OWNER_ID }), true);
  assert.equal(canEditCourse(course, { role: "teacher", userId: OTHER_ID }), false);
});

test("an admin may edit any course, a student none", () => {
  const course = storedCourse();

  assert.equal(canEditCourse(course, { role: "admin", userId: "admin" }), true);
  assert.equal(canEditCourse(course, { role: "student", userId: OTHER_ID }), false);
  assert.equal(canEditCourse(course, { role: "teacher", userId: "" }), false);
});

// -- the round trip ----------------------------------------------------------

test("the owner's edit is written", async () => {
  const Course = courseStub();
  const { updateCourseController } = build(Course);
  const res = mockResponse();

  await updateCourseController(
    asOwner({ C_title: "Introduction to CSS", C_price: "4990" }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(Course.stored.C_title, "Introduction to CSS");
  assert.equal(Course.stored.C_price, "4990");

  // Everything the delete-and-recreate workaround would have destroyed.
  assert.equal(Course.stored.enrolled, 42);
  assert.equal(Course.stored.userId, OWNER_ID);
  assert.equal(Course.stored.sections.length, 2);
});

test("the educator byline is re-read from the token on the owner's edit", async () => {
  // C_educator is written once at creation from the same source (#83), so a
  // teacher who later corrects their name left a stale byline behind.
  const Course = courseStub();
  const { updateCourseController } = build(Course);

  await updateCourseController(
    asOwner({ C_title: "Introduction to CSS" }),
    mockResponse(),
  );

  assert.equal(Course.stored.C_educator, "Renamed Educator");
});

test("an admin editing somebody else's course does not become the educator", async () => {
  const Course = courseStub();
  const { updateCourseController } = build(Course);

  await updateCourseController(
    {
      params: { courseid: COURSE_ID },
      user: { _id: "admin", type: "admin", name: "root" },
      body: { C_title: "Introduction to CSS" },
    },
    mockResponse(),
  );

  assert.equal(Course.stored.C_educator, "Original Educator");
});

test("another teacher's edit is refused and writes nothing", async () => {
  const Course = courseStub();
  const { updateCourseController } = build(Course);
  const res = mockResponse();

  await updateCourseController(
    {
      params: { courseid: COURSE_ID },
      user: { _id: OTHER_ID, type: "teacher", name: "Somebody Else" },
      body: { C_title: "Hijacked" },
    },
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(Course.stored.C_title, "Introduciton to CSS");
  assert.deepEqual(Course.updates, []);
});

test("a student is refused before the course is read", async () => {
  const Course = {
    findById() {
      throw new Error("findById must not be reached for a student");
    },
  };

  const { updateCourseController } = build(Course);
  const res = mockResponse();

  await updateCourseController(
    {
      params: { courseid: COURSE_ID },
      user: { _id: OTHER_ID, type: "student" },
      body: { C_title: "Hijacked" },
    },
    res,
  );

  assert.equal(res.statusCode, 403);
});

test("a missing course is a 404", async () => {
  const { updateCourseController } = build(courseStub());
  const res = mockResponse();

  await updateCourseController(
    {
      params: { courseid: "64b00000000000000000ffff" },
      user: { _id: OWNER_ID, type: "teacher", name: "Educator" },
      body: { C_title: "New title" },
    },
    res,
  );

  assert.equal(res.statusCode, 404);
});

test("a malformed course id is a 400, not a CastError", async () => {
  const controllers = createCourseUpdateControllers({
    Course: courseStub(),
    isValidObjectId: () => false,
    logger: { error() {} },
  });

  const res = mockResponse();

  await controllers.updateCourseController(
    {
      params: { courseid: "not-an-id" },
      user: { _id: OWNER_ID, type: "teacher" },
      body: { C_title: "New title" },
    },
    res,
  );

  assert.equal(res.statusCode, 400);
});

test("the owner can read the course for editing", async () => {
  const { getCourseForEditController } = build(courseStub());
  const res = mockResponse();

  await getCourseForEditController(asOwner(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.C_title, "Introduciton to CSS");
  assert.equal(res.body.data.sections.length, 2);
  assert.doesNotMatch(JSON.stringify(res.body), /uploads/);
});

test("another teacher cannot read somebody else's course for editing", async () => {
  const { getCourseForEditController } = build(courseStub());
  const res = mockResponse();

  await getCourseForEditController(
    {
      params: { courseid: COURSE_ID },
      user: { _id: OTHER_ID, type: "teacher" },
    },
    res,
  );

  assert.equal(res.statusCode, 403);
});

test("the response names what changed", async () => {
  const Course = courseStub();
  const { updateCourseController } = build(Course);
  const res = mockResponse();

  await updateCourseController(asOwner({ C_categories: "Front end" }), res);

  assert.ok(res.body.changed.includes("C_categories"));
  assert.equal(res.body.changed.includes("userId"), false);
  assert.equal(res.body.changed.includes("enrolled"), false);
});
