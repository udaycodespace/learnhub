const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ADMIN_ID,
  buildAdminAccount,
  isAdminId,
} = require("../utils/adminAccount");

// #125. `POST /api/admin/login` returned `{ success, token, message }`. The
// browser's session layer needs both a token and a stored user with an id:
//
//   parseStoredUser -> `parsed._id || parsed.id ? parsed : null`
//   readSession     -> `if (!user || !isTokenValid(token)) return { ... }`
//
// so there was nothing to store under the `user` key, `isAuthenticated` was
// false, and the admin dashboard was unreachable even for an operator who
// called the endpoint by hand.
//
// The account is built in one place now, shared by the login response and by
// authMiddleware. These are the rules for that object; the round trip through
// the endpoint is asserted in admin-auth.test.js, which already has a database
// running — a seventeenth in-memory MongoDB is more than the test run will
// start in parallel.

const USERNAME = "test-admin";

test("the admin account carries everything the session layer reads", () => {
  const account = buildAdminAccount(USERNAME);

  // parseStoredUser
  assert.ok(account._id || account.id);
  // getUserRole reads `type` first, then `role`
  assert.equal(account.type, "admin");
  assert.equal(account.role, "admin");
  // the navbar greeting
  assert.equal(account.name, USERNAME);
});

test("the reserved id is the one authMiddleware recognises", () => {
  assert.equal(ADMIN_ID, "admin");
  assert.equal(buildAdminAccount(USERNAME)._id, ADMIN_ID);
  assert.equal(buildAdminAccount(USERNAME).id, ADMIN_ID);
});

test("an unconfigured username still produces a usable account", () => {
  for (const value of [undefined, null, "", "   "]) {
    const account = buildAdminAccount(value);

    assert.equal(account._id, ADMIN_ID);
    assert.equal(account.name, "Administrator");
  }
});

test("the account carries no fabricated email address", () => {
  // The admin is a credential pair in the environment, not an account with a
  // mailbox. An invented address would be worse than an absent one.
  assert.equal("email" in buildAdminAccount(USERNAME), false);
});

test("the account is marked verified, since there is nothing to verify", () => {
  assert.equal(buildAdminAccount(USERNAME).isVerified, true);
});

test("isAdminId recognises the reserved id and nothing else", () => {
  assert.equal(isAdminId("admin"), true);
  assert.equal(isAdminId(ADMIN_ID), true);
  assert.equal(isAdminId("64a000000000000000000001"), false);
  assert.equal(isAdminId(undefined), false);
  assert.equal(isAdminId(null), false);
  assert.equal(isAdminId(""), false);
});

test("a fresh account object is returned each time", () => {
  // Callers put it on `req.user`, and authMiddleware's consumers assign to it
  // — `req.user.role = user.type` on the non-admin branch. A shared frozen
  // singleton would make that a cross-request mutation.
  const first = buildAdminAccount(USERNAME);
  const second = buildAdminAccount(USERNAME);

  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});
