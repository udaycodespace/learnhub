const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");

const {
  MAX_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  toAccountView,
  validatePasswordChange,
  validateProfileUpdate,
} = require("../utils/accountUpdates");

const {
  createAccountControllers,
  getAccountId,
} = require("../controllers/accountController");

const { ACTIONS } = require("../utils/activityLog");

// #126. There was no route that read or wrote the signed-in account. Changing a
// password meant signing out and completing the emailed reset flow, which
// trades a claim the application can check ("I hold a valid session for this
// account") for one it cannot ("I can read this mailbox") — and marks the
// address verified and discards any pending OTP on the way through.
//
// Models are injected, so these run without a database. The 16 suites that do
// start one already run in parallel and adding another tips the run into
// startup timeouts.

const USER_ID = "64a000000000000000000001";
const CURRENT_PASSWORD = "current-password";
const NEW_PASSWORD = "a-better-password";

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

function userStub(overrides = {}) {
  const stored = {
    _id: USER_ID,
    name: "Original Name",
    email: "learner@example.com",
    type: "student",
    isVerified: true,
    password: bcrypt.hashSync(CURRENT_PASSWORD, 4),
    ...overrides,
  };

  const model = {
    stored,
    updates: [],
    findById(id) {
      if (String(id) !== String(stored._id)) {
        return { select: () => null, lean: async () => null };
      }

      const doc = { ...stored };

      return {
        select: () => doc,
        lean: async () => {
          // `lean()` on a query with no projection would still carry password;
          // the controller's read path never selects it, so it is dropped here
          // the way the schema's `select: false` drops it.
          const { password, ...rest } = doc;
          return rest;
        },
      };
    },
    // Not `async`: the controller calls `.lean()` on what this returns, the
    // way it would on a Mongoose query.
    findByIdAndUpdate(id, update) {
      if (String(id) !== String(stored._id)) {
        return { lean: async () => null };
      }

      Object.assign(stored, update.$set || {});

      const { password, ...rest } = stored;
      return { lean: async () => ({ ...rest }) };
    },
    async updateOne(filter, update) {
      model.updates.push({ filter, update });
      Object.assign(stored, update.$set || {});
      return { modifiedCount: 1 };
    },
  };

  return model;
}

function build(User, recorded = []) {
  return createAccountControllers({
    User,
    logActivity: async (entry) => {
      recorded.push(entry);
      return null;
    },
    logger: { error() {}, warn() {} },
  });
}

const asStudent = (body) => ({
  user: { _id: USER_ID, type: "student" },
  body,
  headers: {},
});

// -- the rules ---------------------------------------------------------------

test("a profile update accepts a name and nothing else", () => {
  const result = validateProfileUpdate({
    name: "  New Name  ",
    // The two fields a client must never set: #72 made the address the
    // account's unique identity, and #55 stopped clients choosing a role.
    email: "attacker@example.com",
    type: "admin",
    isVerified: true,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { name: "New Name" });
});

test("a profile update requires a name of a sane length", () => {
  assert.equal(validateProfileUpdate({ name: "" }).valid, false);
  assert.equal(validateProfileUpdate({ name: "   " }).valid, false);
  assert.equal(validateProfileUpdate({}).valid, false);
  assert.equal(
    validateProfileUpdate({ name: "x".repeat(MAX_NAME_LENGTH + 1) }).valid,
    false,
  );
  assert.equal(
    validateProfileUpdate({ name: "x".repeat(MAX_NAME_LENGTH) }).valid,
    true,
  );
});

test("a password change always requires the current password", () => {
  // The requirement is the point of the endpoint: possession of an unattended
  // tab must not be enough to lock the owner out.
  const result = validatePasswordChange({ newPassword: NEW_PASSWORD });

  assert.equal(result.valid, false);
  assert.ok(result.errors.currentPassword);
});

test("the new password has to meet the registration minimum", () => {
  const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);

  assert.equal(
    validatePasswordChange({
      currentPassword: CURRENT_PASSWORD,
      newPassword: short,
    }).valid,
    false,
  );

  assert.equal(
    validatePasswordChange({
      currentPassword: CURRENT_PASSWORD,
      newPassword: "x".repeat(MIN_PASSWORD_LENGTH),
    }).valid,
    true,
  );
});

test("changing a password to the same password is refused", () => {
  const result = validatePasswordChange({
    currentPassword: CURRENT_PASSWORD,
    newPassword: CURRENT_PASSWORD,
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.newPassword);
});

test("the account view is an allow-list, not a list of things to strip", () => {
  const view = toAccountView({
    _id: USER_ID,
    name: "Original Name",
    email: "learner@example.com",
    type: "student",
    isVerified: true,
    password: "$2a$10$hash",
    otp: "$2a$10$otp",
    resetToken: "$2a$10$reset",
    // A field nobody has thought about yet. A `-password -otp …` projection
    // would carry it; this cannot.
    secretFutureField: "leak",
  });

  assert.deepEqual(Object.keys(view).sort(), [
    "_id",
    "createdAt",
    "email",
    "id",
    "isVerified",
    "name",
    "role",
    "type",
  ]);

  assert.doesNotMatch(JSON.stringify(view), /hash|otp|reset|leak/);
});

// -- reading the account -----------------------------------------------------

test("the account is returned without the credential fields", async () => {
  const User = userStub();
  const { getAccountController } = build(User);
  const res = mockResponse();

  await getAccountController(asStudent(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.email, "learner@example.com");
  assert.equal(res.body.data.editable, true);
  assert.doesNotMatch(JSON.stringify(res.body), /\$2[aby]\$/);
});

test("an unauthenticated read is a 401", async () => {
  const { getAccountController } = build(userStub());
  const res = mockResponse();

  await getAccountController({ body: {} }, res);

  assert.equal(res.statusCode, 401);
});

// -- updating the name -------------------------------------------------------

test("the name is updated and the new account is returned", async () => {
  const User = userStub();
  const recorded = [];
  const { updateAccountController } = build(User, recorded);
  const res = mockResponse();

  await updateAccountController(asStudent({ name: "Corrected Name" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.name, "Corrected Name");
  assert.equal(User.stored.name, "Corrected Name");

  // Returned so the client can replace the stored session user; the navbar
  // greeting, the certificate and every review byline read `name` off it.
  assert.equal(recorded[0].action, ACTIONS.PROFILE_UPDATED);
});

test("an update cannot reach the role or the address", async () => {
  const User = userStub();
  const { updateAccountController } = build(User);

  await updateAccountController(
    asStudent({
      name: "Corrected Name",
      type: "admin",
      email: "attacker@example.com",
      isVerified: false,
    }),
    mockResponse(),
  );

  assert.equal(User.stored.type, "student");
  assert.equal(User.stored.email, "learner@example.com");
  assert.equal(User.stored.isVerified, true);
});

test("a rejected update names the field", async () => {
  const { updateAccountController } = build(userStub());
  const res = mockResponse();

  await updateAccountController(asStudent({ name: "" }), res);

  assert.equal(res.statusCode, 400);
  assert.ok(res.body.errors.name);
  assert.ok(res.body.message);
});

// -- changing the password ---------------------------------------------------

test("the correct current password changes the stored hash", async () => {
  const User = userStub();
  const recorded = [];
  const { changePasswordController } = build(User, recorded);
  const res = mockResponse();

  const before = User.stored.password;

  await changePasswordController(
    asStudent({
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    }),
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.notEqual(User.stored.password, before);
  assert.equal(await bcrypt.compare(NEW_PASSWORD, User.stored.password), true);
  assert.equal(recorded[0].action, ACTIONS.PASSWORD_CHANGED);
});

test("the wrong current password changes nothing and is recorded", async () => {
  const User = userStub();
  const recorded = [];
  const { changePasswordController } = build(User, recorded);
  const res = mockResponse();

  const before = User.stored.password;

  await changePasswordController(
    asStudent({
      currentPassword: "not-the-password",
      newPassword: NEW_PASSWORD,
    }),
    res,
  );

  assert.equal(res.statusCode, 400);
  assert.equal(User.stored.password, before);
  assert.equal(User.updates.length, 0);

  // A run of these against a signed-in account is what an audit log exists to
  // show, for the same reason #87 added login_failed.
  assert.equal(recorded[0].action, ACTIONS.PASSWORD_CHANGE_FAILED);
});

test("a password change clears any reset code that was in flight", async () => {
  const User = userStub();
  const { changePasswordController } = build(User);

  await changePasswordController(
    asStudent({
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    }),
    mockResponse(),
  );

  const unset = User.updates[0].update.$unset;

  // A reset code somebody else requested must not still work afterwards.
  assert.ok("resetToken" in unset);
  assert.ok("resetTokenExpiry" in unset);
  assert.ok("resetTokenAttempts" in unset);
});

test("a password change does not verify the address or clear a pending OTP", async () => {
  const User = userStub({ isVerified: false });
  const { changePasswordController } = build(User);

  await changePasswordController(
    asStudent({
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    }),
    mockResponse(),
  );

  const { $set, $unset } = User.updates[0].update;

  // resetPasswordController sets isVerified because holding the emailed code
  // proves the mailbox. This route proves nothing about the mailbox, so it
  // must not claim to.
  assert.equal("isVerified" in $set, false);
  assert.equal("otp" in $unset, false);
  assert.equal(User.stored.isVerified, false);
});

test("the response does not promise to revoke other sessions", async () => {
  const { changePasswordController } = build(userStub());
  const res = mockResponse();

  await changePasswordController(
    asStudent({
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    }),
    res,
  );

  // The token is stateless; there is no server-side session to destroy. Saying
  // otherwise would be a promise the application cannot keep.
  assert.match(res.body.message, /stay signed in/i);
});

// -- the configured admin ----------------------------------------------------

test("the admin can read its account without a database lookup", async () => {
  const User = {
    findById() {
      throw new Error("findById must not be called for the admin");
    },
  };

  const { getAccountController } = build(User);
  const res = mockResponse();

  await getAccountController(
    { user: { _id: "admin", id: "admin", type: "admin" }, body: {} },
    res,
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.editable, false);
});

test("the admin cannot edit an account that does not exist", async () => {
  const User = {
    findById() {
      throw new Error("findById must not be called for the admin");
    },
  };

  const { changePasswordController, updateAccountController } = build(User);

  for (const controller of [updateAccountController, changePasswordController]) {
    const res = mockResponse();

    await controller(
      {
        user: { _id: "admin", id: "admin", type: "admin" },
        body: {
          name: "New Admin",
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
        },
      },
      res,
    );

    // "admin" is not an ObjectId; without this branch findById casts it and
    // the request is a 500.
    assert.equal(res.statusCode, 403);
  }
});

test("the account id comes from the middleware, not from the body", () => {
  assert.equal(getAccountId({ user: { _id: USER_ID } }), USER_ID);
  assert.equal(getAccountId({ user: { id: USER_ID } }), USER_ID);
  assert.equal(getAccountId({ body: { userId: USER_ID } }), null);
  assert.equal(getAccountId({}), null);
});

// -- the activity log has to be able to store and filter what this writes -----

test("every action this controller writes is storable and filterable", () => {
  const ActivityLog = require("../schemas/activityLogModel");
  const {
    ALLOWED_ACTIONS,
  } = require("../controllers/activityLogController");

  const storable = new Set(ActivityLog.schema.path("action").enumValues);

  for (const action of [
    ACTIONS.PASSWORD_CHANGED,
    ACTIONS.PASSWORD_CHANGE_FAILED,
    ACTIONS.PROFILE_UPDATED,
  ]) {
    // Without the enum entry, recordActivity's write fails validation and is
    // swallowed — the row simply never appears.
    assert.ok(storable.has(action), `${action} is not in the schema enum`);

    // Without the filter entry, the admin table answers 400 for a filter the
    // dropdown offers.
    assert.ok(
      ALLOWED_ACTIONS.has(action),
      `${action} is not an allowed filter`,
    );
  }
});

test("the storable actions and the filterable actions are the same set", () => {
  const ActivityLog = require("../schemas/activityLogModel");
  const {
    ALLOWED_ACTIONS,
  } = require("../controllers/activityLogController");

  assert.deepEqual(
    [...ActivityLog.schema.path("action").enumValues].sort(),
    [...ALLOWED_ACTIONS].sort(),
  );
});
