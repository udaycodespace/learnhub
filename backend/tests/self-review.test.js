process.env.JWT_SECRET = process.env.JWT_SECRET || "learnhub-test-secret";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  AUTHOR_REVIEW_MESSAGE,
  REVIEW_DENIAL,
  isCourseAuthor,
} = require("../utils/courseAuthorship");

// #117. createReview gated on one thing — is the reviewer enrolled — and
// nothing stops an author enrolling in their own course. Two requests were
// enough:
//
//   [#5] enrol in own course -> 200 true "Enroll Successfully"
//   [#5] review own course   -> 201 true "Review submitted successfully."
//   [#5] verifiedEnrollment  -> true | summary: {"averageRating":5,"totalReviews":1}
//
// The result was badged "✓ Verified enrollment", counted in the average
// CourseRatingBadge renders on every catalogue card, and averaged into the
// summary the catalogue can sort on.

let User;
let Course;
let CourseReview;
let EnrolledCourse;
let app;
let removeSelfReviews;
let findSelfReviews;

test.before(async () => {
  await startTestDatabase();

  User = require("../schemas/userModel");
  Course = require("../schemas/courseModel");
  CourseReview = require("../schemas/courseReviewModel");
  EnrolledCourse = require("../schemas/enrolledCourseModel");
  ({ findSelfReviews, removeSelfReviews } = require("../scripts/removeSelfReviews"));

  app = express();
  app.use(express.json());
  app.use("/api/reviews", require("../routers/courseReviewRoutes"));
  app.use("/api/user", require("../routers/userRoutes"));
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

const createUser = (type, email, name = "Person") =>
  User.create({ name, email, password: "hashed", type, isVerified: true });

const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });

const createCourse = (author, title = "My own course") =>
  Course.create({
    userId: String(author._id),
    C_educator: author.name,
    C_title: title,
    C_categories: "Web",
    C_price: "free",
    C_description: "d",
    sections: [{ S_title: "one", S_content: { filename: "a.mp4", path: "/uploads/a.mp4" } }],
  });

const enrol = (user, course) =>
  EnrolledCourse.create({
    userId: user._id,
    courseId: course._id,
    course_Length: 1,
  });

// -- the comparison ----------------------------------------------------------

test("authorship survives the String/ObjectId mismatch", () => {
  // courseModel.userId is a String; courseReview.userId is an ObjectId.
  // Comparing them without coercing both sides is false, always, silently.
  const id = "507f1f77bcf86cd799439011";
  const objectIdLike = { toString: () => id };

  assert.equal(isCourseAuthor({ userId: id }, objectIdLike), true);
  assert.equal(isCourseAuthor({ userId: id }, id), true);
  assert.equal(isCourseAuthor({ userId: id }, "507f1f77bcf86cd799439012"), false);
});

test("a course with no owner is not owned by everybody", () => {
  assert.equal(isCourseAuthor({}, "u1"), false);
  assert.equal(isCourseAuthor({ userId: null }, "u1"), false);
  assert.equal(isCourseAuthor({ userId: "" }, "u1"), false);
  assert.equal(isCourseAuthor(null, "u1"), false);
  assert.equal(isCourseAuthor({ userId: "u1" }, null), false);
  assert.equal(isCourseAuthor({ userId: "u1" }, undefined), false);
});

// -- the regression ----------------------------------------------------------

test("an educator cannot review their own course, even while enrolled", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const course = await createCourse(teacher);
  await enrol(teacher, course);

  const response = await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(teacher)}`)
    .send({ rating: 5, reviewText: "Best course ever" });

  assert.equal(response.status, 403);
  assert.equal(response.body.message, AUTHOR_REVIEW_MESSAGE);
  assert.equal(response.body.reason, REVIEW_DENIAL.OWN_COURSE);
  assert.equal(await CourseReview.countDocuments({}), 0);
});

test("the author is told they are the author, not that they are not enrolled", async () => {
  // The enrolment is not the thing that is wrong, and enrolling — which they
  // can do — would not help, so "only enrolled students can review" would send
  // them down a road that leads nowhere.
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const course = await createCourse(teacher);

  const response = await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(teacher)}`)
    .send({ rating: 5 });

  assert.equal(response.body.reason, REVIEW_DENIAL.OWN_COURSE);
  assert.doesNotMatch(response.body.message, /enrolled/i);
});

test("the rating a course shows is unaffected by its author trying", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);

  await enrol(teacher, course);
  await enrol(student, course);

  await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(teacher)}`)
    .send({ rating: 5 });

  const genuine = await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(student)}`)
    .send({ rating: 3, reviewText: "Fine" });

  assert.equal(genuine.status, 201);
  assert.equal(genuine.body.summary.averageRating, 3);
  assert.equal(genuine.body.summary.totalReviews, 1);
});

test("an enrolled student can still review, which is the whole feature", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);
  await enrol(student, course);

  const response = await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(student)}`)
    .send({ rating: 4, reviewText: "Useful" });

  assert.equal(response.status, 201);
  assert.equal(response.body.data.verifiedEnrollment, true);
  assert.equal(response.body.summary.averageRating, 4);
});

test("a student who is not enrolled is still refused, for the old reason", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);

  const response = await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(student)}`)
    .send({ rating: 4 });

  assert.equal(response.status, 403);
  assert.equal(response.body.reason, REVIEW_DENIAL.NOT_ENROLLED);
  assert.match(response.body.message, /enrolled/i);
});

test("an educator reviewing somebody else's course is fine", async () => {
  // Only the course's own author is blocked, not educators in general.
  const author = await createUser("teacher", "a@example.com", "Ann");
  const other = await createUser("teacher", "b@example.com", "Bob");
  const course = await createCourse(author);
  await enrol(other, course);

  const response = await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(other)}`)
    .send({ rating: 5, reviewText: "Learned a lot" });

  assert.equal(response.status, 201);
});

// -- the form the client renders ---------------------------------------------

test("GET /mine tells an author why, so no form is offered", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const course = await createCourse(teacher);
  await enrol(teacher, course);

  const { body } = await request(app)
    .get(`/api/reviews/${course._id}/mine`)
    .set("Authorization", `Bearer ${tokenFor(teacher)}`);

  assert.equal(body.canReview, false);
  assert.equal(body.reason, REVIEW_DENIAL.OWN_COURSE);
  assert.equal(body.isAuthor, true);
  // Enrolled, and still cannot review. The two were the same answer before.
  assert.equal(body.isEnrolled, true);
});

test("GET /mine still tells an unenrolled student to enrol", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);

  const { body } = await request(app)
    .get(`/api/reviews/${course._id}/mine`)
    .set("Authorization", `Bearer ${tokenFor(student)}`);

  assert.equal(body.canReview, false);
  assert.equal(body.reason, REVIEW_DENIAL.NOT_ENROLLED);
  assert.equal(body.isAuthor, false);
  assert.equal(body.isEnrolled, false);
});

test("GET /mine says yes to an enrolled student", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);
  await enrol(student, course);

  const { body } = await request(app)
    .get(`/api/reviews/${course._id}/mine`)
    .set("Authorization", `Bearer ${tokenFor(student)}`);

  assert.equal(body.canReview, true);
  assert.equal(body.reason, null);
});

// -- the back door -----------------------------------------------------------

test("an author cannot edit a self-review written before the guard existed", async () => {
  // Legacy rows are still owned by their author, and findOneAndUpdate matched
  // on { _id, userId } alone — so editing one would have reintroduced exactly
  // what the create path now refuses.
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const course = await createCourse(teacher);

  const legacy = await CourseReview.create({
    userId: teacher._id,
    courseId: course._id,
    rating: 5,
    reviewText: "Written before the guard",
  });

  const response = await request(app)
    .put(`/api/reviews/review/${legacy._id}`)
    .set("Authorization", `Bearer ${tokenFor(teacher)}`)
    .send({ rating: 1, reviewText: "edited" });

  assert.equal(response.status, 403);
  assert.equal(response.body.reason, REVIEW_DENIAL.OWN_COURSE);

  const unchanged = await CourseReview.findById(legacy._id).lean();
  assert.equal(unchanged.rating, 5);
});

test("an ordinary reviewer can still edit their own review", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);
  await enrol(student, course);

  const created = await request(app)
    .post(`/api/reviews/${course._id}`)
    .set("Authorization", `Bearer ${tokenFor(student)}`)
    .send({ rating: 2, reviewText: "First impression" });

  const updated = await request(app)
    .put(`/api/reviews/review/${created.body.data.id}`)
    .set("Authorization", `Bearer ${tokenFor(student)}`)
    .send({ rating: 5, reviewText: "It grew on me" });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.rating, 5);
  assert.equal(updated.body.summary.averageRating, 5);
});

test("an author can still delete a legacy self-review", async () => {
  // Deleting is the direction that fixes the problem, so it stays open.
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const course = await createCourse(teacher);

  const legacy = await CourseReview.create({
    userId: teacher._id,
    courseId: course._id,
    rating: 5,
  });

  const response = await request(app)
    .delete(`/api/reviews/review/${legacy._id}`)
    .set("Authorization", `Bearer ${tokenFor(teacher)}`);

  assert.equal(response.status, 200);
  assert.equal(await CourseReview.countDocuments({}), 0);
});

// -- the badge ---------------------------------------------------------------

test("a legacy self-review is not badged as a verified enrolment", async () => {
  // The field was the literal `true` on every row, and the review card
  // rendered its badge without reading it. New self-reviews cannot be written;
  // the ones already there should at least stop claiming to be independent.
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);
  await enrol(student, course);

  await CourseReview.create({ userId: teacher._id, courseId: course._id, rating: 5 });
  await CourseReview.create({ userId: student._id, courseId: course._id, rating: 3 });

  const { body } = await request(app).get(`/api/reviews/${course._id}`);

  const byRating = new Map(body.data.map((row) => [row.rating, row]));

  assert.equal(byRating.get(5).verifiedEnrollment, false);
  assert.equal(byRating.get(3).verifiedEnrollment, true);
});

// -- the cleanup script ------------------------------------------------------

test("the script finds self-reviews and leaves genuine ones alone", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const mine = await createCourse(teacher, "Mine");
  const theirs = await createCourse(student, "Theirs");

  await CourseReview.create({ userId: teacher._id, courseId: mine._id, rating: 5 });
  await CourseReview.create({ userId: student._id, courseId: mine._id, rating: 3 });
  await CourseReview.create({ userId: student._id, courseId: theirs._id, rating: 5 });

  const found = await findSelfReviews();

  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((row) => row.courseTitle).sort(),
    ["Mine", "Theirs"],
  );
});

test("a dry run reports without deleting", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const course = await createCourse(teacher);
  await CourseReview.create({ userId: teacher._id, courseId: course._id, rating: 5 });

  const logged = [];
  const result = await removeSelfReviews({
    apply: false,
    logger: { log: (line) => logged.push(line) },
  });

  assert.equal(result.found, 1);
  assert.equal(result.removed, 0);
  assert.equal(await CourseReview.countDocuments({}), 1);
  assert.ok(logged.some((line) => /Dry run/.test(line)));
});

test("applying removes only the self-reviews", async () => {
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const student = await createUser("student", "s@example.com", "Sam");
  const course = await createCourse(teacher);

  await CourseReview.create({ userId: teacher._id, courseId: course._id, rating: 5 });
  const genuine = await CourseReview.create({
    userId: student._id,
    courseId: course._id,
    rating: 3,
  });

  const result = await removeSelfReviews({ logger: { log: () => {} } });

  assert.equal(result.found, 1);
  assert.equal(result.removed, 1);

  const remaining = await CourseReview.find({}).lean();
  assert.equal(remaining.length, 1);
  assert.equal(String(remaining[0]._id), String(genuine._id));
});

test("a clean database is a no-op", async () => {
  const logged = [];
  const result = await removeSelfReviews({ logger: { log: (line) => logged.push(line) } });

  assert.deepEqual(result, { found: 0, removed: 0, details: [] });
  assert.ok(logged.some((line) => /No self-reviews/.test(line)));
});

test("a review whose course was deleted is not treated as a self-review", async () => {
  // The $lookup unwinds without preserving empties, so an orphan row simply
  // does not match. Deleting it is cascadeDelete's job, not this script's.
  const teacher = await createUser("teacher", "t@example.com", "Tess");
  const course = await createCourse(teacher);

  await CourseReview.create({ userId: teacher._id, courseId: course._id, rating: 5 });
  await Course.deleteOne({ _id: course._id });

  const result = await removeSelfReviews({ logger: { log: () => {} } });

  assert.equal(result.found, 0);
  assert.equal(await CourseReview.countDocuments({}), 1);
});
