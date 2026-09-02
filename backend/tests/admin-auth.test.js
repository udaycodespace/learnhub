const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const request = require("supertest");

const {
  startTestDatabase,
  clearTestDatabase,
  stopTestDatabase,
} = require("./setup");

// adminLoginController signed with JWT_KEY while authMiddleware verified with
// JWT_SECRET. JWT_KEY is defined nowhere, so jwt.sign threw inside an async
// handler, Express 4 swallowed the rejection and the request hung. Even a
// populated JWT_KEY would have produced tokens authMiddleware always rejected.
// These tests drive the full mint-then-verify round trip.

const ADMIN_USERNAME = "test-admin";
const ADMIN_PASSWORD = "test-admin-password";

let app;
let User;
let adminController;
let originalEnv;

// Mounted standalone so the suite covers admin auth without depending on the
// rest of the route tree.
function buildAdminApp() {
  const instance = express();

  instance.use(express.json());
  instance.use("/api/admin", require("../routers/adminRoutes"));

  // #125. Reports whatever authMiddleware put on the request, so the account
  // in the login response and the server's own view of the caller can be
  // compared directly rather than assumed to match.
  instance.get(
    "/probe/whoami",
    require("../middlewares/authMiddleware"),
    (req, res) => res.status(200).send({ success: true, user: req.user }),
  );

  return instance;
}

test.before(async () => {
  await startTestDatabase();

  originalEnv = {
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };

  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  delete process.env.ADMIN_PASSWORD;

  app = buildAdminApp();
  User = require("../schemas/userModel");
  adminController = require("../controllers/adminController");
});

test.beforeEach(async () => {
  await clearTestDatabase();

  process.env.ADMIN_USERNAME = ADMIN_USERNAME;
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  process.env.JWT_SECRET = originalEnv.JWT_SECRET || "learnhub-test-secret";
});

test.after(async () => {
  Object.entries(originalEnv).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });

  await stopTestDatabase();
});

async function login(credentials) {
  return request(app).post("/api/admin/login").send(credentials);
}

test("admin login returns a token for the configured credentials", async () => {
  const response = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(typeof response.body.token, "string");
  assert.ok(response.body.token.length > 0);
});

test("a token from admin login is accepted by an admin-only route", async () => {
  const { body } = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  // This is the assertion the JWT_KEY / JWT_SECRET mismatch broke: the token
  // was minted with one secret and verified with another.
  const response = await request(app)
    .get("/api/admin/getallusers")
    .set("Authorization", `Bearer ${body.token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.ok(Array.isArray(response.body.data));
});

test("admin login rejects a wrong password", async () => {
  const response = await login({
    username: ADMIN_USERNAME,
    password: "not-the-password",
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
  assert.equal(response.body.message, "Invalid admin credentials");
});

test("admin login rejects a wrong username", async () => {
  const response = await login({
    username: "someone-else",
    password: ADMIN_PASSWORD,
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test("admin login rejects an empty body without throwing", async () => {
  const response = await request(app).post("/api/admin/login").send({});

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test("admin login no longer accepts the previously hardcoded credentials", async () => {
  const response = await login({ username: "admin", password: "admin123" });

  assert.equal(response.status, 401);
});

test("admin login answers with 500 instead of hanging when JWT_SECRET is missing", async () => {
  delete process.env.JWT_SECRET;

  const response = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  assert.equal(response.status, 500);
  assert.equal(response.body.success, false);
  assert.equal(
    response.body.message,
    "Authentication is not configured on this server",
  );
});

test("admin login answers with 500 when no credentials are configured", async () => {
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD_HASH;
  delete process.env.ADMIN_PASSWORD;

  const response = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  assert.equal(response.status, 500);
  assert.equal(
    response.body.message,
    "Admin access is not configured on this server",
  );
});

test("a plaintext admin password is refused in production", async () => {
  delete process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.NODE_ENV = "production";

  try {
    assert.equal(adminController.getAdminCredentials(), null);
  } finally {
    process.env.NODE_ENV = "test";
    delete process.env.ADMIN_PASSWORD;
  }
});


// -- #125: the response has to carry an account, not only a token -------------
//
// The endpoint returned `{ success, token, message }`. The browser needs both
// halves — `parseStoredUser` requires an object with an id and `readSession`
// refuses a token without one — so the admin dashboard could not be reached
// even by an operator who called this endpoint by hand.

test("admin login returns an account beside the token", async () => {
  const response = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  assert.equal(response.status, 200);

  const account = response.body.userData;

  assert.ok(account, "the response carried no account");
  assert.ok(account._id || account.id, "the account has no id to store");
  assert.equal(account.type, "admin");
  assert.equal(account.name, ADMIN_USERNAME);
});

test("the returned account satisfies what parseStoredUser requires", async () => {
  const { body } = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  // The browser's rule, restated on this side so the two cannot drift: an
  // object, not an array, carrying an id — and it has to survive the round
  // trip through JSON that localStorage puts it through.
  const stored = JSON.parse(JSON.stringify(body.userData));

  assert.equal(typeof stored, "object");
  assert.equal(Array.isArray(stored), false);
  assert.ok(stored._id || stored.id);
});

test("the account in the response is the account authMiddleware builds", async () => {
  const { body } = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  const probe = await request(app)
    .get("/probe/whoami")
    .set("Authorization", `Bearer ${body.token}`);

  assert.equal(probe.status, 200);
  assert.equal(probe.body.user._id, body.userData._id);
  assert.equal(probe.body.user.type, body.userData.type);
  assert.equal(probe.body.user.role, body.userData.role);
  assert.equal(probe.body.user.name, body.userData.name);
});

test("a rejected sign-in carries no account", async () => {
  const response = await login({
    username: ADMIN_USERNAME,
    password: "wrong",
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.userData, undefined);
  assert.equal(response.body.token, undefined);
});

test("the sign-in response never carries the configured password or its hash", async () => {
  const { text } = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  assert.doesNotMatch(text, new RegExp(ADMIN_PASSWORD));
  assert.doesNotMatch(text, /\$2[aby]\$/);
});

test("GET /getallusers never returns password, otp or reset token fields", async () => {
  await User.create({
    name: "Leaky User",
    email: "leaky@example.com",
    password: await bcrypt.hash("leaky-password", 10),
    type: "student",
    isVerified: false,
    otp: "123456",
    otpExpiry: new Date(Date.now() + 600000),
    resetToken: "654321",
    resetTokenExpiry: new Date(Date.now() + 600000),
  });

  const { body: loginBody } = await login({
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  const response = await request(app)
    .get("/api/admin/getallusers")
    .set("Authorization", `Bearer ${loginBody.token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);

  const [user] = response.body.data;

  for (const field of adminController.SENSITIVE_USER_FIELDS) {
    assert.equal(
      Object.hasOwn(user, field),
      false,
      `the response still exposes ${field}`,
    );
  }

  // The safe fields are still there, so the dashboard keeps working.
  assert.equal(user.name, "Leaky User");
  assert.equal(user.email, "leaky@example.com");
  assert.equal(user.type, "student");

  const serialised = JSON.stringify(response.body);
  assert.ok(!serialised.includes("123456"), "the live OTP leaked");
  assert.ok(!serialised.includes("654321"), "the live reset token leaked");
});

test("a bare find() cannot reach the sensitive fields", async () => {
  await User.create({
    name: "Schema Guard",
    email: "guard@example.com",
    password: await bcrypt.hash("guard-password", 10),
    type: "student",
    otp: "111111",
    resetToken: "222222",
  });

  const [user] = await User.find();

  // select: false at the schema level means the next controller that forgets a
  // projection still cannot leak these.
  assert.equal(user.password, undefined);
  assert.equal(user.otp, undefined);
  assert.equal(user.resetToken, undefined);

  const withPassword = await User.findOne({ email: "guard@example.com" }).select(
    "+password +otp +resetToken",
  );

  assert.equal(typeof withPassword.password, "string");
  assert.equal(withPassword.otp, "111111");
  assert.equal(withPassword.resetToken, "222222");
});

test("serialising a user document drops the sensitive fields", async () => {
  const user = await User.create({
    name: "Serialise Me",
    email: "serialise@example.com",
    password: await bcrypt.hash("serialise-password", 10),
    type: "student",
    otp: "999999",
  });

  const plain = JSON.parse(JSON.stringify(user));

  assert.equal(plain.password, undefined);
  assert.equal(plain.otp, undefined);
  assert.equal(plain.name, "Serialise Me");
});
