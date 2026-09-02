import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOKMARK_DENIAL,
  BOOKMARK_ROLES,
  bookmarkDenialMessage,
  bookmarkDenialReason,
  canUseBookmarks,
  shouldLoadBookmarks,
} from './bookmarkAccess.js';

// #115. The API gates every bookmark route on the student role. The client
// knew that in the `/saved-courses` route guard and nowhere else, so the navbar
// offered educators and admins a link the guard immediately bounced, and the
// provider fetched a wishlist they cannot have — one 403 per page load.

test('a student has a wishlist', () => {
  assert.equal(canUseBookmarks({ type: 'student' }), true);
});

test('an educator and an admin do not', () => {
  // The two accounts the navbar was offering the link to.
  assert.equal(canUseBookmarks({ type: 'teacher' }), false);
  assert.equal(canUseBookmarks({ type: 'admin' }), false);
});

test('a capitalised role from an older document still resolves', () => {
  // Accounts written before #55 added `lowercase: true` to the schema. This is
  // why the check goes through lib/roles rather than comparing a literal.
  assert.equal(canUseBookmarks({ type: 'Student' }), true);
  assert.equal(canUseBookmarks({ type: '  STUDENT  ' }), true);
  assert.equal(canUseBookmarks({ type: 'Teacher' }), false);
});

test('the `role` alias is accepted, like everywhere else', () => {
  assert.equal(canUseBookmarks({ role: 'student' }), true);
  assert.equal(canUseBookmarks({ role: 'teacher' }), false);
});

test('a missing or malformed user has no wishlist', () => {
  assert.equal(canUseBookmarks(null), false);
  assert.equal(canUseBookmarks(undefined), false);
  assert.equal(canUseBookmarks({}), false);
  assert.equal(canUseBookmarks('student'), false);
  assert.equal(canUseBookmarks({ type: 42 }), false);
});

test('the role list is what the route guard is handed', () => {
  // App.jsx passes this array straight to ProtectedRoute. Sharing the value is
  // what stops the guard and this module disagreeing, which is the whole bug.
  assert.deepEqual([...BOOKMARK_ROLES], ['student']);
});

// -- why, not just whether ---------------------------------------------------

test('a signed-out visitor is told to sign in, not that it is not for them', () => {
  // The feature *is* theirs. Two different reasons used to get one answer.
  const reason = bookmarkDenialReason(null, false);

  assert.equal(reason, BOOKMARK_DENIAL.SIGNED_OUT);
  assert.equal(bookmarkDenialMessage(reason), 'Sign in to save courses.');
});

test('an educator is told the feature is not theirs', () => {
  // Signing in again will not help, so the control should not be offered.
  const reason = bookmarkDenialReason({ type: 'teacher' }, true);

  assert.equal(reason, BOOKMARK_DENIAL.ROLE);
  assert.equal(bookmarkDenialMessage(reason), 'Saved courses are a student feature.');
});

test('a signed-in student is not denied', () => {
  const reason = bookmarkDenialReason({ type: 'student' }, true);

  assert.equal(reason, null);
  assert.equal(bookmarkDenialMessage(reason), '');
});

test('a stale user object with no session is signed out, not wrong-role', () => {
  // Order matters. localStorage can hold a student while the token has
  // expired, and "sign in" is the useful answer there.
  assert.equal(
    bookmarkDenialReason({ type: 'student' }, false),
    BOOKMARK_DENIAL.SIGNED_OUT,
  );
});

// -- the request the provider was making -------------------------------------

test('only a signed-in student causes the wishlist to be fetched', () => {
  assert.equal(shouldLoadBookmarks({ type: 'student' }, true), true);
  assert.equal(shouldLoadBookmarks({ type: 'teacher' }, true), false);
  assert.equal(shouldLoadBookmarks({ type: 'admin' }, true), false);
  assert.equal(shouldLoadBookmarks({ type: 'student' }, false), false);
  assert.equal(shouldLoadBookmarks(null, true), false);
  assert.equal(shouldLoadBookmarks(null, false), false);
});

test('an unknown message reason is empty rather than undefined', () => {
  assert.equal(bookmarkDenialMessage(null), '');
  assert.equal(bookmarkDenialMessage('something-else'), '');
});
