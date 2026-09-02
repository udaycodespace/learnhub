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

// #115. Every bookmark route is student-only, and has been since the feature
// landed. The client knew that in one place — the `/saved-courses` route guard
// — and not in the two that reach for the feature: the navbar rendered the
// Saved link for every signed-in account, and BookmarksProvider fetched the
// wishlist for anyone holding a token.
//
// The API is not what is wrong, so what is asserted here is that the rule the
// client now mirrors is the rule the router actually enforces — for every
// route, and for both spellings of a stored role.

let User;
let Course;
let bookmarkRoutes;
let app;

test.before(async () => {
  await startTestDatabase();

  User = require("../schemas/userModel");
  Course = require("../schemas/courseModel");
  bookmarkRoutes = require("../routers/courseBookmarkRoutes");

  app = express();
  app.use(express.json());
  app.use("/api/bookmarks", bookmarkRoutes);
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

const createUser = (type, email) =>
  User.create({
    name: "Person",
    email,
    password: "hashed",
    type,
    isVerified: true,
  });

const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });

const createCourse = () =>
  Course.create({
    userId: "someone",
    C_educator: "Tess",
    C_title: "Intro",
    C_categories: "Web",
    C_price: "free",
    C_description: "d",
    sections: [],
  });

// Every route on the router, so a new one cannot be added outside the rule.
const ROUTES = [
  { method: "get", path: "/api/bookmarks" },
  { method: "get", path: "/api/bookmarks/status" },
  { method: "post", path: "/api/bookmarks/:courseId" },
  { method: "delete", path: "/api/bookmarks/:courseId" },
  { method: "delete", path: "/api/bookmarks" },
];

test("the router declares the role list the client mirrors", () => {
  // frontend/src/lib/bookmarkAccess.js exports the same list and its own test
  // asserts the same value. This is the backend half of that pair.
  assert.deepEqual(bookmarkRoutes.BOOKMARK_ROLES, ["student"]);
});

test("a student reaches every bookmark route", async () => {
  const student = await createUser("student", "s@example.com");
  const course = await createCourse();
  const token = tokenFor(student);

  for (const route of ROUTES) {
    const path = route.path.replace(":courseId", String(course._id));
    const response = await request(app)
      [route.method](path)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    assert.notEqual(
      response.status,
      403,
      `${route.method.toUpperCase()} ${route.path} rejected a student`,
    );
  }
});

test("an educator is refused on every bookmark route", async () => {
  // The 403 the navbar was walking accounts into, once per page load for the
  // listing route and once per click for the rest.
  const teacher = await createUser("teacher", "t@example.com");
  const course = await createCourse();
  const token = tokenFor(teacher);

  for (const route of ROUTES) {
    const path = route.path.replace(":courseId", String(course._id));
    const response = await request(app)
      [route.method](path)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    assert.equal(
      response.status,
      403,
      `${route.method.toUpperCase()} ${route.path} let a teacher through`,
    );
    assert.equal(response.body.message, "Forbidden: Access denied");
  }
});

test("an admin is refused too", async () => {
  const admin = await createUser("admin", "a@example.com");

  const response = await request(app)
    .get("/api/bookmarks")
    .set("Authorization", `Bearer ${tokenFor(admin)}`);

  assert.equal(response.status, 403);
});

test("the admin pseudo-identity is refused as well", async () => {
  // adminLoginController signs `{ id: "admin" }`, which authMiddleware turns
  // into a user object without touching the database.
  const token = jwt.sign({ id: "admin", role: "admin" }, process.env.JWT_SECRET);

  const response = await request(app)
    .get("/api/bookmarks")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(response.status, 403);
});

test("a capitalised stored role is still recognised as a student", async () => {
  // userModel lowercases `type` on write, so this can only come from a
  // document written before #55 — which is exactly why the client checks the
  // role through lib/roles rather than comparing a literal.
  const student = await createUser("student", "old@example.com");
  await User.collection.updateOne(
    { _id: student._id },
    { $set: { type: "Student" } },
  );

  const response = await request(app)
    .get("/api/bookmarks")
    .set("Authorization", `Bearer ${tokenFor(student)}`);

  assert.equal(response.status, 200);
});

test("dropping the redundant \"Student\" entry changed nothing", async () => {
  // checkRole lowercases both sides before comparing, so the second spelling
  // never did any work. Asserted rather than reasoned about, because removing
  // it is the only behavioural-looking part of this change.
  const checkRole = require("../middlewares/roleMiddleware");
  const seen = [];
  const next = () => seen.push("next");

  const guard = checkRole(bookmarkRoutes.BOOKMARK_ROLES);

  for (const type of ["student", "Student", "STUDENT"]) {
    guard({ user: { type } }, { status: () => ({ send: () => {} }) }, next);
  }

  assert.equal(seen.length, 3);
});

test("an unauthenticated request is refused before the role check", async () => {
  const response = await request(app).get("/api/bookmarks");

  assert.equal(response.status, 401);
  assert.equal(response.body.message, "Authorization header missing");
});
