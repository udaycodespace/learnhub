const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

const {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MISSING_COURSE_TITLE,
  UNKNOWN_EMAIL,
  buildDateMatch,
  buildPaymentPipeline,
  buildPaymentSort,
  buildSummary,
  clampedPage,
  maskCardNumber,
  maskStoredCard,
  parseDateBoundary,
  parsePaymentQuery,
  readPaymentFacet,
  toPaymentRow,
} = require("../utils/paymentListing");

const ADMIN_USERNAME = "payments-admin";
const ADMIN_PASSWORD = "payments-admin-password";

let app;
let User;
let Course;
let CoursePayment;

test.before(async () => {
  await startTestDatabase();
  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD_HASH;

  app = require("../app");
  User = require("../schemas/userModel");
  Course = require("../schemas/courseModel");
  CoursePayment = require("../schemas/coursePaymentModel");
});

test.beforeEach(async () => {
  await clearTestDatabase();
});

test.after(async () => {
  await stopTestDatabase();
});

async function adminToken() {
  const { body } = await request(app)
    .post("/api/admin/login")
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

  return body.token;
}

async function seedPayments({ count = 25 } = {}) {
  const password = await bcrypt.hash("password123", 10);

  const student = await User.create({
    name: "Priya Sharma",
    email: "priya@example.com",
    password,
    type: "student",
    isVerified: true,
  });

  const other = await User.create({
    name: "Rahul Verma",
    email: "rahul@example.com",
    password,
    type: "student",
    isVerified: true,
  });

  const paid = await Course.create({
    userId: String(student._id),
    C_educator: "Priya Sharma",
    C_title: "Advanced Node",
    C_categories: "IT & Software",
    C_price: "1,299",
    C_description: "Server side JavaScript",
    sections: [],
  });

  const free = await Course.create({
    userId: String(student._id),
    C_educator: "Priya Sharma",
    C_title: "Intro to Git",
    C_categories: "IT & Software",
    C_price: "free",
    C_description: "Version control",
    sections: [],
  });

  const docs = [];

  for (let i = 0; i < count; i += 1) {
    docs.push({
      userId: i % 2 === 0 ? student._id : other._id,
      courseId: i % 3 === 0 ? free._id : paid._id,
      amount: "irrelevant",
      // The three stored spellings the dashboard folds into two buckets.
      status: i % 5 === 0 ? "failed" : i % 7 === 0 ? "queued" : "enrolled",
      // Seeded in UTC so the date-range assertions below do not depend on the
      // machine's timezone.
      createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
      updatedAt: new Date(Date.UTC(2026, 0, 1 + i)),
    });
  }

  await CoursePayment.insertMany(docs);

  return { student, other, paid, free };
}

// -- query parsing -----------------------------------------------------------

test("the default query is page one at the dashboard's page size", () => {
  const { valid, value } = parsePaymentQuery({});

  assert.equal(valid, true);
  assert.equal(value.page, 1);
  assert.equal(value.limit, DEFAULT_LIMIT);
  assert.equal(value.sort, "newest");
  assert.equal(value.status, "");
});

test("limit is capped rather than honoured, so one request cannot ask for everything", () => {
  assert.equal(parsePaymentQuery({ limit: "5000" }).value.limit, MAX_LIMIT);
});

test("a junk page or limit falls back instead of producing NaN", () => {
  const { value } = parsePaymentQuery({ page: "abc", limit: "-4" });

  assert.equal(value.page, 1);
  assert.equal(value.limit, DEFAULT_LIMIT);
});

test("an unknown status filter is rejected with the message the client expects", () => {
  const parsed = parsePaymentQuery({ status: "refunded" });

  assert.equal(parsed.valid, false);
  assert.equal(parsed.message, "Invalid payment status filter.");
});

test("an unknown sort is rejected", () => {
  assert.equal(
    parsePaymentQuery({ sort: "amount" }).message,
    "Invalid payment sort option.",
  );
});

test("an unparseable date is rejected rather than silently ignored", () => {
  assert.equal(
    parsePaymentQuery({ startDate: "not-a-date" }).message,
    "Invalid start date.",
  );
  assert.equal(
    parsePaymentQuery({ endDate: "13/45/2026" }).message,
    "Invalid end date.",
  );
});

test("a reversed date range is rejected", () => {
  assert.equal(
    parsePaymentQuery({ startDate: "2026-03-01", endDate: "2026-01-01" })
      .message,
    "Start date cannot be after end date.",
  );
});

test("a bare end date covers the whole of that day", () => {
  const end = parseDateBoundary("2026-01-05", true);

  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

test("the date range is the one filter that runs before the joins", () => {
  const { value } = parsePaymentQuery({
    startDate: "2026-01-01",
    endDate: "2026-02-01",
  });
  const match = buildDateMatch(value);

  assert.ok(match.createdAt.$gte instanceof Date);
  assert.ok(match.createdAt.$lte instanceof Date);
  assert.deepEqual(buildDateMatch({}), {});
});

// -- the pipeline ------------------------------------------------------------

test("the page is skipped and limited by the database, not by a slice", () => {
  const { value } = parsePaymentQuery({ page: "3", limit: "10" });
  const pipeline = buildPaymentPipeline(value);

  const facet = pipeline.at(-1).$facet;

  assert.deepEqual(
    facet.rows.find((stage) => stage.$skip !== undefined),
    { $skip: 20 },
  );
  assert.deepEqual(
    facet.rows.find((stage) => stage.$limit !== undefined),
    { $limit: 10 },
  );
});

test("the joins project only the columns the table renders", () => {
  const pipeline = buildPaymentPipeline(parsePaymentQuery({}).value);
  const lookups = pipeline.filter((stage) => stage.$lookup);

  assert.equal(lookups.length, 2);
  assert.deepEqual(lookups[0].$lookup.pipeline, [
    { $project: { name: 1, email: 1 } },
  ]);
  assert.deepEqual(lookups[1].$lookup.pipeline, [
    { $project: { C_title: 1, C_price: 1 } },
  ]);
});

// A payment whose user or course was deleted has to stay visible as an orphaned
// row, which is what preserveNullAndEmptyArrays buys.
test("an unwind never drops a row whose reference is gone", () => {
  const pipeline = buildPaymentPipeline(parsePaymentQuery({}).value);
  const unwinds = pipeline.filter((stage) => stage.$unwind);

  assert.equal(unwinds.length, 2);
  unwinds.forEach((stage) => {
    assert.equal(stage.$unwind.preserveNullAndEmptyArrays, true);
  });
});

test("the search value is escaped before it reaches a regex", () => {
  const { value } = parsePaymentQuery({ search: "a(b" });
  const pipeline = buildPaymentPipeline(value);

  const searchMatch = pipeline.find((stage) => stage.$match?.searchText);

  assert.equal(searchMatch.$match.searchText.$regex, "a\\(b");
  assert.doesNotThrow(
    () => new RegExp(searchMatch.$match.searchText.$regex),
  );
});

test("no search means no search stage at all", () => {
  const pipeline = buildPaymentPipeline(parsePaymentQuery({}).value);

  assert.equal(
    pipeline.some((stage) => stage.$match?.searchText),
    false,
  );
});

test("the status filter matches the normalised value, in the database", () => {
  const { value } = parsePaymentQuery({ status: "failed" });
  const pipeline = buildPaymentPipeline(value);

  assert.ok(
    pipeline.some(
      (stage) => stage.$match?.normalizedStatus === "failed",
    ),
  );
});

test("every sort carries an _id tiebreak, so a page boundary is stable", () => {
  for (const sort of ["newest", "oldest", "amount-asc", "amount-desc"]) {
    assert.ok(
      Object.hasOwn(buildPaymentSort(sort), "_id"),
      `${sort} has no tiebreak`,
    );
  }
});

test("an unknown sort falls back to newest rather than to undefined", () => {
  assert.deepEqual(buildPaymentSort("nonsense"), buildPaymentSort("newest"));
});

test("the collection names for the joins are injectable", () => {
  const pipeline = buildPaymentPipeline(parsePaymentQuery({}).value, {
    userCollection: "accounts",
    courseCollection: "catalog",
  });

  const lookups = pipeline.filter((stage) => stage.$lookup);

  assert.equal(lookups[0].$lookup.from, "accounts");
  assert.equal(lookups[1].$lookup.from, "catalog");
});

// -- shaping -----------------------------------------------------------------

test("the summary folds the buckets into the block the dashboard renders", () => {
  const summary = buildSummary([
    { _id: "successful", count: 8, revenue: 4000 },
    { _id: "failed", count: 2, revenue: 900 },
    { _id: "pending", count: 1, revenue: 100 },
  ]);

  assert.equal(summary.totalTransactions, 11);
  assert.equal(summary.successful, 8);
  assert.equal(summary.failed, 2);
  assert.equal(summary.pending, 1);
  // Revenue counts successful payments only, as it always has.
  assert.equal(summary.totalRevenue, 4000);
});

test("an empty result set summarises as zeroes, not as NaN", () => {
  assert.deepEqual(buildSummary([]), {
    totalTransactions: 0,
    successful: 0,
    pending: 0,
    failed: 0,
    // #128 added this bucket. A student can leave a course now, and the
    // payment row is kept and marked rather than deleted, so it needs
    // somewhere to be counted that is not `pending` — nothing is pending, and
    // pending is a number an admin reads as work to do.
    withdrawn: 0,
    totalRevenue: 0,
  });
  assert.deepEqual(buildSummary(undefined), buildSummary([]));
});

// #55 removed cardnumber from the schema and stores cardLast4 instead. The old
// controller only ever read cardnumber, so every payment written since then
// rendered a blank card column.
test("the card column reads the field that is actually stored now", () => {
  assert.equal(
    maskStoredCard({ cardLast4: "4242" }),
    "•••• •••• •••• 4242",
  );
});

test("a row written before #55 still masks from the old field", () => {
  assert.equal(
    maskStoredCard({ cardNumber: "4111111111111111" }),
    "•••• •••• •••• 1111",
  );
});

test("a payment with no card details masks to null rather than to dots", () => {
  assert.equal(maskStoredCard({}), null);
  assert.equal(maskCardNumber("12"), null);
  assert.equal(maskCardNumber(undefined), null);
});

test("a missing user or course is named rather than left blank", () => {
  const row = toPaymentRow({ _id: "abc", amount: 0, status: "pending" });

  assert.equal(row.student.email, UNKNOWN_EMAIL);
  assert.equal(row.course.title, MISSING_COURSE_TITLE);
  assert.equal(row.student.id, null);
  assert.equal(row.course.id, null);
});

test("pagination is derived from the database's count", () => {
  const result = readPaymentFacet(
    { rows: [], summary: [], total: [{ value: 47 }] },
    { page: 2, limit: 10 },
  );

  assert.equal(result.pagination.totalItems, 47);
  assert.equal(result.pagination.totalPages, 5);
  assert.equal(result.pagination.hasNextPage, true);
  assert.equal(result.pagination.hasPreviousPage, true);
});

test("an empty facet reads as an empty page, not as a crash", () => {
  const result = readPaymentFacet(undefined, { page: 1, limit: 10 });

  assert.deepEqual(result.data, []);
  assert.equal(result.pagination.totalItems, 0);
  assert.equal(result.pagination.hasNextPage, false);
});

test("a page past the end is detected from the count and re-run", () => {
  assert.equal(clampedPage({ page: 9, limit: 10 }, 47), 5);
  assert.equal(clampedPage({ page: 2, limit: 10 }, 47), null);
  assert.equal(clampedPage({ page: 9, limit: 10 }, 0), null);
});

// -- end to end --------------------------------------------------------------

test("the endpoint returns one page and the true total", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?page=1&limit=10")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(body.success, true);
  assert.equal(body.data.length, 10);
  assert.equal(body.pagination.totalItems, 25);
  assert.equal(body.pagination.totalPages, 3);
});

test("page two is a different page, not the same rows again", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const first = await request(app)
    .get("/api/admin/payments?page=1&limit=10")
    .set("Authorization", `Bearer ${token}`);

  const second = await request(app)
    .get("/api/admin/payments?page=2&limit=10")
    .set("Authorization", `Bearer ${token}`);

  const firstIds = new Set(first.body.data.map((row) => row.id));

  assert.equal(second.body.data.length, 10);
  assert.equal(
    second.body.data.some((row) => firstIds.has(row.id)),
    false,
  );
});

test("the summary counts every matching payment, not the ten on the page", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?page=1&limit=10")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(body.summary.totalTransactions, 25);
  assert.equal(
    body.summary.successful + body.summary.pending + body.summary.failed,
    25,
  );
});

test("the stored spellings fold into the buckets the dashboard shows", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?status=successful&limit=50")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  // "enrolled" is a successful payment; "queued" is not a known spelling and
  // falls through to pending.
  assert.ok(body.data.length > 0);
  assert.equal(
    body.data.every((row) => row.status === "successful"),
    true,
  );
  assert.equal(body.summary.totalTransactions, body.pagination.totalItems);
});

test("the status filter runs over the whole collection, not over one page", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const failed = await request(app)
    .get("/api/admin/payments?status=failed&page=1&limit=2")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  // Five of the twenty-five rows are stored as "failed". A page size of two
  // must not change how many the filter found.
  assert.equal(failed.body.pagination.totalItems, 5);
  assert.equal(failed.body.data.length, 2);
});

test("search matches a student the current page does not contain", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?search=rahul&limit=50")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.ok(body.data.length > 0);
  assert.equal(
    body.data.every((row) => row.student.email === "rahul@example.com"),
    true,
  );
});

test("search also matches a course title", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?search=Advanced%20Node&limit=50")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.ok(body.data.length > 0);
  assert.equal(
    body.data.every((row) => row.course.title === "Advanced Node"),
    true,
  );
});

test("a regex metacharacter in the search box is a search, not a 500", async () => {
  await seedPayments({ count: 5 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?search=%28")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(body.success, true);
  assert.deepEqual(body.data, []);
});

test("a grouped price sorts as a number, not as a string", async () => {
  await seedPayments({ count: 6 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?sort=amount-desc&limit=50")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  // "1,299" has to read as 1299 and a free course as 0.
  assert.equal(body.data[0].amount, 1299);
  assert.equal(body.data.at(-1).amount, 0);

  const amounts = body.data.map((row) => row.amount);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
});

test("revenue counts the successful payments across the whole result set", async () => {
  await seedPayments({ count: 6 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?limit=2")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  const all = await request(app)
    .get("/api/admin/payments?limit=50")
    .set("Authorization", `Bearer ${token}`);

  const expected = all.body.data
    .filter((row) => row.status === "successful")
    .reduce((sum, row) => sum + row.amount, 0);

  assert.equal(body.summary.totalRevenue, expected);
});

test("a date range narrows the result set in the database", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?startDate=2026-01-01&endDate=2026-01-05&limit=50")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(body.pagination.totalItems, 5);
  assert.equal(body.filters.startDate, new Date("2026-01-01").toISOString());
});

test("a payment whose course was deleted stays on the dashboard", async () => {
  const { paid } = await seedPayments({ count: 4 });
  await Course.deleteOne({ _id: paid._id });

  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?limit=50")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(body.pagination.totalItems, 4);
  assert.ok(
    body.data.some((row) => row.course.title === MISSING_COURSE_TITLE),
  );
});

test("a page past the end returns the last page rather than nothing", async () => {
  await seedPayments({ count: 25 });
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?page=99&limit=10")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.equal(body.pagination.page, 3);
  assert.equal(body.data.length, 5);
});

test("an empty collection is an empty page, not an error", async () => {
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  assert.deepEqual(body.data, []);
  assert.equal(body.pagination.totalItems, 0);
  assert.equal(body.summary.totalTransactions, 0);
});

test("the full card number is never in the response", async () => {
  await seedPayments({ count: 3 });

  await CoursePayment.collection.updateMany(
    {},
    { $set: { "cardDetails.cardnumber": "4111111111111111" } },
  );

  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?limit=50")
    .set("Authorization", `Bearer ${token}`)
    .expect(200);

  const serialized = JSON.stringify(body);

  assert.equal(serialized.includes("4111111111111111"), false);
  assert.ok(body.data.every((row) => row.maskedCard.endsWith("1111")));
});

test("a bad filter is still a 400 with the old message", async () => {
  const token = await adminToken();

  const { body } = await request(app)
    .get("/api/admin/payments?status=refunded")
    .set("Authorization", `Bearer ${token}`)
    .expect(400);

  assert.equal(body.success, false);
  assert.equal(body.message, "Invalid payment status filter.");
});

test("the endpoint still requires an admin", async () => {
  await request(app).get("/api/admin/payments").expect(401);
});
