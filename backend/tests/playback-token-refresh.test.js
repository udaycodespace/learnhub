const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "playback-refresh-secret";

const {
  PLAYBACK_TTL_SECONDS,
  issuePlaybackToken,
  tokenCoversCourse,
  verifyPlaybackToken,
} = require("../utils/playbackTokens");

const {
  createPlaybackTokenController,
  getViewerId,
} = require("../controllers/playbackAccessController");

const {
  createCourseVideoController,
} = require("../controllers/courseVideoController");

// #124. The playback token lives for thirty minutes and nothing renewed it, so
// a course page open longer than that held a credential the stream route
// refuses — silently, because a <video> element's 401 does not pass through the
// axios interceptor.
//
// These tests pin the two halves of the fix: the token now says when it
// expires, and there is a route that mints a new one against the same enrolment
// check without re-fetching the course.

const COURSE_ID = "64b000000000000000000001";
const OTHER_COURSE_ID = "64b000000000000000000002";
const USER_ID = "64a000000000000000000001";

function mockResponse() {
  return {
    statusCode: 0,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(values) {
      Object.assign(this.headers, values);
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
}

function enrolledCourseStub(row) {
  return {
    calls: [],
    findOne(filter) {
      this.calls.push(filter);

      const chain = {
        select: () => chain,
        lean: async () => row,
      };

      return chain;
    },
  };
}

const alwaysValidId = () => true;

// -- the expiry travels with the token ---------------------------------------

test("issuePlaybackToken reports the deadline alongside the token", () => {
  const now = 1_700_000_000_000;

  const issued = issuePlaybackToken(
    { userId: USER_ID, courseId: COURSE_ID },
    { now },
  );

  assert.equal(issued.expiresInSeconds, PLAYBACK_TTL_SECONDS);
  assert.equal(issued.expiresAt, now + PLAYBACK_TTL_SECONDS * 1000);
});

test("the reported deadline matches the token's own exp claim", () => {
  const issued = issuePlaybackToken({ userId: USER_ID, courseId: COURSE_ID });
  const payload = jwt.decode(issued.token);

  // Within a second: `expiresAt` is measured from Date.now() and `exp` from the
  // signing library's own clock read a moment later.
  const drift = Math.abs(payload.exp * 1000 - issued.expiresAt);

  assert.ok(drift <= 1000, `exp and expiresAt drifted by ${drift}ms`);
});

test("the issued token is a real playback token for that course", () => {
  const { token } = issuePlaybackToken({
    userId: USER_ID,
    courseId: COURSE_ID,
  });

  const claims = verifyPlaybackToken(token);

  assert.ok(claims);
  assert.equal(claims.userId, USER_ID);
  assert.ok(tokenCoversCourse(claims, COURSE_ID));
  assert.equal(tokenCoversCourse(claims, OTHER_COURSE_ID), false);
});

// -- the refresh route -------------------------------------------------------

test("an enrolled viewer is issued a fresh token", async () => {
  const EnrolledCourse = enrolledCourseStub({ _id: "enrolment-1" });

  const controller = createPlaybackTokenController({
    EnrolledCourse,
    isValidObjectId: alwaysValidId,
  });

  const res = mockResponse();

  await controller(
    { params: { courseid: COURSE_ID }, user: { _id: USER_ID } },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.playbackToken);
  assert.equal(res.body.playbackTokenExpiresIn, PLAYBACK_TTL_SECONDS);
  assert.ok(res.body.playbackTokenExpiresAt > Date.now());

  const claims = verifyPlaybackToken(res.body.playbackToken);
  assert.ok(tokenCoversCourse(claims, COURSE_ID));
});

test("the enrolment is checked against the authenticated caller, not the body", async () => {
  const EnrolledCourse = enrolledCourseStub({ _id: "enrolment-1" });

  const controller = createPlaybackTokenController({
    EnrolledCourse,
    isValidObjectId: alwaysValidId,
  });

  await controller(
    {
      params: { courseid: COURSE_ID },
      user: { _id: USER_ID },
      // Anything that can write a body can write this.
      body: { userId: "64a0000000000000000000ff" },
    },
    mockResponse(),
  );

  assert.deepEqual(EnrolledCourse.calls, [
    { userId: USER_ID, courseId: COURSE_ID },
  ]);
});

test("a viewer who is no longer enrolled does not get a fresh half hour", async () => {
  const controller = createPlaybackTokenController({
    EnrolledCourse: enrolledCourseStub(null),
    isValidObjectId: alwaysValidId,
  });

  const res = mockResponse();

  await controller(
    { params: { courseid: COURSE_ID }, user: { _id: USER_ID } },
    res,
  );

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.playbackToken, undefined);
});

test("an unauthenticated request is refused before the database is touched", async () => {
  const EnrolledCourse = enrolledCourseStub({ _id: "enrolment-1" });

  const controller = createPlaybackTokenController({
    EnrolledCourse,
    isValidObjectId: alwaysValidId,
  });

  const res = mockResponse();

  await controller({ params: { courseid: COURSE_ID } }, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(EnrolledCourse.calls, []);
});

test("a malformed course id is a 400, not a CastError", async () => {
  const EnrolledCourse = enrolledCourseStub({ _id: "enrolment-1" });

  const controller = createPlaybackTokenController({
    EnrolledCourse,
    isValidObjectId: () => false,
  });

  const res = mockResponse();

  await controller(
    { params: { courseid: "not-an-id" }, user: { _id: USER_ID } },
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(EnrolledCourse.calls, []);
});

test("a database failure is a 500 and does not leak the error", async () => {
  const controller = createPlaybackTokenController({
    EnrolledCourse: {
      findOne() {
        throw new Error("connection reset by peer");
      },
    },
    isValidObjectId: alwaysValidId,
    logger: { error() {} },
  });

  const res = mockResponse();

  await controller(
    { params: { courseid: COURSE_ID }, user: { _id: USER_ID } },
    res,
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "Failed to refresh video access");
  assert.ok(!String(res.body.message).includes("connection reset"));
});

test("getViewerId ignores a client-supplied body id", () => {
  assert.equal(getViewerId({ user: { _id: USER_ID } }), USER_ID);
  assert.equal(getViewerId({ user: { id: USER_ID } }), USER_ID);
  assert.equal(getViewerId({ body: { userId: USER_ID } }), null);
  assert.equal(getViewerId({}), null);
});

// -- the defect itself -------------------------------------------------------

test("an expired token is refused by the stream route, and a renewed one is not", async () => {
  // A token minted with the lifetime already spent — what the player was
  // holding thirty minutes into a course.
  const expired = jwt.sign(
    { sub: USER_ID, courseId: COURSE_ID, scope: "course-video" },
    process.env.JWT_SECRET,
    { expiresIn: -1 },
  );

  assert.equal(verifyPlaybackToken(expired), null);

  const Course = {
    findById() {
      return { lean: async () => ({ _id: COURSE_ID, sections: [] }) };
    },
  };

  const videoController = createCourseVideoController({ Course });

  const refused = mockResponse();
  await videoController(
    {
      params: { courseid: COURSE_ID, sectionIndex: "0" },
      query: { token: expired },
      headers: {},
    },
    refused,
  );

  assert.equal(refused.statusCode, 401);
  assert.equal(refused.body.message, "A valid playback token is required");

  // The renewed token gets past the credential check. It stops at "no such
  // section" because this stub course has none, which is precisely the point:
  // the token is no longer what refuses it.
  const controller = createPlaybackTokenController({
    EnrolledCourse: enrolledCourseStub({ _id: "enrolment-1" }),
    isValidObjectId: alwaysValidId,
  });

  const issued = mockResponse();
  await controller(
    { params: { courseid: COURSE_ID }, user: { _id: USER_ID } },
    issued,
  );

  const accepted = mockResponse();
  await videoController(
    {
      params: { courseid: COURSE_ID, sectionIndex: "0" },
      query: { token: issued.body.playbackToken },
      headers: {},
    },
    accepted,
  );

  assert.equal(accepted.statusCode, 404);
  assert.equal(accepted.body.message, "Section video not found");
});
