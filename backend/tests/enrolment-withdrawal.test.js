const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WITHDRAWN_STATUS,
  withdrawEnrolment,
} = require("../utils/enrolmentWithdrawal");

const {
  createWithdrawEnrollmentController,
} = require("../controllers/enrollmentController");

const {
  WITHDRAWN_STATUS_VALUES,
  buildSummary,
  parsePaymentQuery,
} = require("../utils/paymentListing");

// #128. An enrolment row was only ever created. The only deletes in the project
// are in the cascade — one for a deleted course, one for a deleted account — so
// there was no way for a student to leave a course. A free course enrols on a
// single click with no confirmation, because `handleEnroll` skips the payment
// modal entirely for a free course, and a mis-click was permanent.
//
// It also inflated `course.enrolled` for good, which is what the catalogue
// sorts "popular" by and what the educator dashboard reports as reach.

const USER_ID = "64a000000000000000000001";
const COURSE_ID = "64b000000000000000000001";

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

/**
 * Records every call so the order and the filters can be asserted, not just
 * the end state.
 */
function modelStubs({ enrolment = { _id: "e1", progress: [{}, {}] } } = {}) {
  const calls = [];

  return {
    calls,
    Course: {
      async updateOne(filter, update) {
        calls.push({ model: "Course", filter, update });
        return { modifiedCount: 1 };
      },
    },
    EnrolledCourse: {
      async findOneAndDelete(filter) {
        calls.push({ model: "EnrolledCourse", filter });
        return enrolment;
      },
    },
    CourseReview: {
      async deleteMany(filter) {
        calls.push({ model: "CourseReview", filter });
        return { deletedCount: 1 };
      },
    },
    CoursePayment: {
      async updateMany(filter, update) {
        calls.push({ model: "CoursePayment", filter, update });
        return { modifiedCount: 1 };
      },
    },
  };
}

// -- what leaving does -------------------------------------------------------

test("the enrolment is removed", async () => {
  const models = modelStubs();

  const result = await withdrawEnrolment({
    userId: USER_ID,
    courseId: COURSE_ID,
    models,
  });

  assert.equal(result.withdrawn, true);

  const removal = models.calls.find((c) => c.model === "EnrolledCourse");
  assert.deepEqual(removal.filter, { userId: USER_ID, courseId: COURSE_ID });
});

test("progress goes with the enrolment it was recorded against", async () => {
  // `progress` is stored on the enrolment row, so removing the row removes it.
  // That is the right outcome: it is progress through a course this account is
  // no longer taking.
  const models = modelStubs({
    enrolment: { _id: "e1", progress: [{ sectionId: 0 }, { sectionId: 1 }] },
  });

  const result = await withdrawEnrolment({
    userId: USER_ID,
    courseId: COURSE_ID,
    models,
  });

  assert.equal(result.enrolment.progress.length, 2);
});

test("the learner count is decremented, guarded so it cannot go negative", async () => {
  const models = modelStubs();

  await withdrawEnrolment({ userId: USER_ID, courseId: COURSE_ID, models });

  const decrement = models.calls.find((c) => c.model === "Course");

  // The same guard `decrementEnrolledCounts` uses. `enrolled` has drifted on
  // existing data because it was only ever incremented, so a guarded $inc
  // rather than a recount that would rewrite history.
  assert.deepEqual(decrement.filter, {
    _id: COURSE_ID,
    enrolled: { $gt: 0 },
  });
  assert.deepEqual(decrement.update, { $inc: { enrolled: -1 } });
});

test("the account's review of the course is removed with the enrolment", async () => {
  // `createReview` refuses without an enrolment and every review is serialised
  // with `verifiedEnrollment: true`. Leaving it behind makes that claim false.
  const models = modelStubs();

  const result = await withdrawEnrolment({
    userId: USER_ID,
    courseId: COURSE_ID,
    models,
  });

  const review = models.calls.find((c) => c.model === "CourseReview");

  assert.deepEqual(review.filter, { userId: USER_ID, courseId: COURSE_ID });
  assert.equal(result.reviews, 1);
});

test("the payment row is marked, never deleted", async () => {
  const models = modelStubs();

  await withdrawEnrolment({ userId: USER_ID, courseId: COURSE_ID, models });

  const payment = models.calls.find((c) => c.model === "CoursePayment");

  // A financial record must not disappear because somebody changed their mind,
  // and the ledger should be able to say which enrolments were withdrawn.
  assert.deepEqual(payment.update, { $set: { status: WITHDRAWN_STATUS } });
  assert.equal(payment.filter.userId, USER_ID);
  assert.equal(payment.filter.courseId, COURSE_ID);
  assert.equal(models.calls.some((c) => c.deleted), false);
});

test("a row already marked withdrawn is left alone", async () => {
  const models = modelStubs();

  await withdrawEnrolment({ userId: USER_ID, courseId: COURSE_ID, models });

  const payment = models.calls.find((c) => c.model === "CoursePayment");

  assert.deepEqual(payment.filter.status, { $ne: WITHDRAWN_STATUS });
});

test("nothing else is touched when there is no enrolment", async () => {
  // Two tabs, two clicks. The second must not decrement the learner count
  // again or remove a review the first one left standing.
  const models = modelStubs({ enrolment: null });

  const result = await withdrawEnrolment({
    userId: USER_ID,
    courseId: COURSE_ID,
    models,
  });

  assert.equal(result.withdrawn, false);
  assert.deepEqual(
    models.calls.map((c) => c.model),
    ["EnrolledCourse"],
  );
});

test("the enrolment is removed before anything else is", async () => {
  const models = modelStubs();

  await withdrawEnrolment({ userId: USER_ID, courseId: COURSE_ID, models });

  assert.equal(models.calls[0].model, "EnrolledCourse");
});

test("a bookmark is not removed", async () => {
  // A saved course is a wishlist entry and is independent of enrolment —
  // somebody who leaves a course may well still want it on their list.
  const models = modelStubs();

  await withdrawEnrolment({ userId: USER_ID, courseId: COURSE_ID, models });

  assert.equal(
    models.calls.some((c) => c.model === "CourseBookmark"),
    false,
  );
});

// -- the route ---------------------------------------------------------------

const asStudent = () => ({
  params: { courseid: COURSE_ID },
  user: { _id: USER_ID, type: "student" },
});

test("leaving answers 200 and says what went", async () => {
  const controller = createWithdrawEnrollmentController({
    isValidObjectId: () => true,
    withdraw: async () => ({
      withdrawn: true,
      enrolment: { progress: [{}, {}, {}] },
      reviews: 1,
      payments: 1,
      learnerCountAdjusted: true,
    }),
  });

  const res = mockResponse();
  await controller(asStudent(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.removed.progress, 3);
  assert.equal(res.body.removed.reviews, 1);
  assert.equal(res.body.payments.markedWithdrawn, 1);
});

test("the account comes from the token, so nobody can withdraw somebody else", async () => {
  let seen = null;

  const controller = createWithdrawEnrollmentController({
    isValidObjectId: () => true,
    withdraw: async (args) => {
      seen = args;
      return { withdrawn: true, enrolment: { progress: [] }, reviews: 0, payments: 0 };
    },
  });

  await controller(
    {
      params: { courseid: COURSE_ID },
      user: { _id: USER_ID, type: "student" },
      // Anything that can write a body can write this.
      body: { userId: "64a0000000000000000000ff" },
    },
    mockResponse(),
  );

  assert.equal(seen.userId, USER_ID);
  assert.equal(seen.courseId, COURSE_ID);
});

test("not being enrolled is a 404, not an error", async () => {
  const controller = createWithdrawEnrollmentController({
    isValidObjectId: () => true,
    withdraw: async () => ({
      withdrawn: false,
      enrolment: null,
      reviews: 0,
      payments: 0,
    }),
  });

  const res = mockResponse();
  await controller(asStudent(), res);

  assert.equal(res.statusCode, 404);
});

test("an unauthenticated request is refused before anything is read", async () => {
  let called = false;

  const controller = createWithdrawEnrollmentController({
    isValidObjectId: () => true,
    withdraw: async () => {
      called = true;
      return { withdrawn: true };
    },
  });

  const res = mockResponse();
  await controller({ params: { courseid: COURSE_ID } }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});

test("a malformed course id is a 400, not a CastError", async () => {
  const controller = createWithdrawEnrollmentController({
    isValidObjectId: () => false,
    withdraw: async () => {
      throw new Error("must not be reached");
    },
  });

  const res = mockResponse();
  await controller(
    { params: { courseid: "not-an-id" }, user: { _id: USER_ID } },
    res,
  );

  assert.equal(res.statusCode, 400);
});

test("a failure is a 500 and does not leak the error", async () => {
  const controller = createWithdrawEnrollmentController({
    isValidObjectId: () => true,
    withdraw: async () => {
      throw new Error("connection reset by peer");
    },
    logger: { error() {} },
  });

  const res = mockResponse();
  await controller(asStudent(), res);

  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(res.body.message, /connection reset/);
});

// -- the admin ledger --------------------------------------------------------

test("withdrawn is its own bucket, not a failure", async () => {
  // A withdrawal is not a payment that failed: the money moved, and whether it
  // comes back is a question this application does not answer.
  assert.deepEqual(WITHDRAWN_STATUS_VALUES, [WITHDRAWN_STATUS]);
});

test("the payments dashboard accepts withdrawn as a filter", () => {
  const result = parsePaymentQuery({ status: "withdrawn" });

  assert.equal(result.valid, true);
  assert.equal(result.value.status, "withdrawn");
});

test("an unknown status is still refused", () => {
  assert.equal(parsePaymentQuery({ status: "abandoned" }).valid, false);
});

test("withdrawn rows are counted in their own bucket", () => {
  const summary = buildSummary([
    { _id: "successful", count: 3, revenue: 1500 },
    { _id: "withdrawn", count: 2, revenue: 800 },
  ]);

  assert.equal(summary.withdrawn, 2);
  assert.equal(summary.totalTransactions, 5);

  // Not counted as pending, which is where an unrecognised status would land
  // through STATUS_EXPRESSION's default — and pending is a number an admin
  // reads as work to do.
  assert.equal(summary.pending, 0);

  // Revenue counts successful rows only, as it always has, so leaving a course
  // takes its amount back out of the total.
  assert.equal(summary.totalRevenue, 1500);
});
