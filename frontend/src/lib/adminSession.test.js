import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_HOME_PATH,
  ADMIN_LOGIN_URL,
  describeAdminLoginError,
  readAdminLogin,
} from './adminSession.js';

// #125. The admin dashboard could not be signed in to. The endpoint existed,
// the guards existed, the four admin screens existed — and no code path in the
// browser connected them.
//
// The half of the defect these tests pin is the response shape. Even an
// operator who called the endpoint by hand could not produce a session,
// because `readSession` needs a stored user with an id and the response
// carried only a token.

const TOKEN = 'header.payload.signature';

const ADMIN_ACCOUNT = {
  _id: 'admin',
  id: 'admin',
  name: 'test-admin',
  type: 'admin',
  role: 'admin',
  isVerified: true,
};

test('the endpoint and landing path are the ones the API and dashboard use', () => {
  assert.equal(ADMIN_LOGIN_URL, '/api/admin/login');
  // UserHome already renders <AdminHome /> for this role; there is no separate
  // admin dashboard route to send them to.
  assert.equal(ADMIN_HOME_PATH, '/dashboard');
});

test('a successful response yields both halves of a session', () => {
  const result = readAdminLogin({
    success: true,
    token: TOKEN,
    userData: ADMIN_ACCOUNT,
    message: 'Admin login successful',
  });

  assert.equal(result.ok, true);
  assert.equal(result.token, TOKEN);
  assert.deepEqual(result.user, ADMIN_ACCOUNT);
});

test('the defect: a token with no account is refused', () => {
  // Exactly what the endpoint used to return. `parseStoredUser` requires an
  // object with an id, so there was nothing to write under the `user` key and
  // `readSession` reported no session at all.
  const result = readAdminLogin({
    success: true,
    token: TOKEN,
    message: 'Admin login successful',
  });

  assert.equal(result.ok, false);
  assert.ok(result.message);
});

test('an account with no id is refused', () => {
  // `parseStoredUser` would return null for it, which is the same dead end.
  const result = readAdminLogin({
    success: true,
    token: TOKEN,
    userData: { name: 'test-admin', type: 'admin' },
  });

  assert.equal(result.ok, false);
});

test('an id under either key is accepted', () => {
  for (const key of ['_id', 'id']) {
    const result = readAdminLogin({
      success: true,
      token: TOKEN,
      userData: { [key]: 'admin', type: 'admin' },
    });

    assert.equal(result.ok, true, `expected ${key} to be enough`);
  }
});

test('an account with no token is refused', () => {
  const result = readAdminLogin({
    success: true,
    userData: ADMIN_ACCOUNT,
  });

  assert.equal(result.ok, false);
});

test('a non-admin role is refused at the form, not at the dashboard', () => {
  // A session built from this would pass ProtectedRoute and then render
  // UserHome's "This account has no dashboard yet" panel, with no way back to
  // a message explaining why.
  const result = readAdminLogin({
    success: true,
    token: TOKEN,
    userData: { _id: 'admin', type: 'student' },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /not an administrator/i);
});

test('the role comparison is case-insensitive, like the rest of the app', () => {
  const result = readAdminLogin({
    success: true,
    token: TOKEN,
    userData: { _id: 'admin', type: 'Admin' },
  });

  assert.equal(result.ok, true);
});

test('role is read from `role` when `type` is absent', () => {
  const result = readAdminLogin({
    success: true,
    token: TOKEN,
    userData: { _id: 'admin', role: 'admin' },
  });

  assert.equal(result.ok, true);
});

test('an unsuccessful body carries the server message through', () => {
  const result = readAdminLogin({
    success: false,
    message: 'Invalid admin credentials',
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, 'Invalid admin credentials');
});

test('a body that is not an object does not throw', () => {
  for (const body of [null, undefined, '', 'nope', 42, []]) {
    const result = readAdminLogin(body);
    assert.equal(result.ok, false, `expected failure for ${String(body)}`);
    assert.ok(result.message);
  }
});

// -- what the form says when the request itself fails -------------------------

test('401 is a credentials problem', () => {
  const message = describeAdminLoginError({ response: { status: 401 } });

  assert.match(message, /credentials/i);
});

test('a 500 from an unconfigured server is passed through verbatim', () => {
  // "Admin access is not configured on this server" tells an operator to go
  // and set ADMIN_USERNAME and ADMIN_PASSWORD_HASH. Collapsing it into
  // "try again" would have them retyping a password that can never work.
  const message = describeAdminLoginError({
    response: {
      status: 500,
      data: { message: 'Admin access is not configured on this server' },
    },
  });

  assert.equal(message, 'Admin access is not configured on this server');
});

test('a request that never reached the server says so', () => {
  const message = describeAdminLoginError(new Error('Network Error'));

  assert.match(message, /could not be reached/i);
});

test('an unexpected status falls back to a generic sentence', () => {
  const message = describeAdminLoginError({ response: { status: 418 } });

  assert.ok(message.length > 0);
  assert.doesNotMatch(message, /418/);
});
