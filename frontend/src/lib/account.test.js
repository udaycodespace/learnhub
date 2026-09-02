import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  isEditable,
  mergeAccountIntoUser,
  readAccount,
  readAccountError,
  validatePasswordChange,
  validateProfile,
} from './account.js';

// #126. There was no account screen and no route behind one. These are the
// browser's half of the rules; `backend/utils/accountUpdates.js` enforces the
// same ones. Nothing can import across the wire, so the same table is asserted
// on both sides — the pattern #114 established for the pricing rule.

// The table both sides answer. Any disagreement here is the class of bug #114
// was filed for.
const PASSWORD_CASES = [
  {
    label: 'a valid change',
    values: { currentPassword: 'old-password', newPassword: 'new-password', confirmPassword: 'new-password' },
    valid: true,
  },
  {
    label: 'no current password',
    values: { newPassword: 'new-password', confirmPassword: 'new-password' },
    valid: false,
    field: 'currentPassword',
  },
  {
    label: 'no new password',
    values: { currentPassword: 'old-password' },
    valid: false,
    field: 'newPassword',
  },
  {
    label: 'a new password below the minimum',
    values: { currentPassword: 'old-password', newPassword: 'x'.repeat(MIN_PASSWORD_LENGTH - 1), confirmPassword: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) },
    valid: false,
    field: 'newPassword',
  },
  {
    label: 'a new password exactly at the minimum',
    values: { currentPassword: 'old-password', newPassword: 'x'.repeat(MIN_PASSWORD_LENGTH), confirmPassword: 'x'.repeat(MIN_PASSWORD_LENGTH) },
    valid: true,
  },
  {
    label: 'the same password again',
    values: { currentPassword: 'old-password', newPassword: 'old-password', confirmPassword: 'old-password' },
    valid: false,
    field: 'newPassword',
  },
  {
    label: 'a mistyped confirmation',
    values: { currentPassword: 'old-password', newPassword: 'new-password', confirmPassword: 'new-passwrod' },
    valid: false,
    field: 'confirmPassword',
  },
];

test('every password case is answered the way the table says', () => {
  for (const { label, values, valid, field } of PASSWORD_CASES) {
    const result = validatePasswordChange(values);

    assert.equal(result.valid, valid, label);

    if (field) assert.ok(result.errors[field], `${label}: expected ${field}`);
  }
});

test('the confirmation field is a browser-side concern only', () => {
  // The server takes one new password and has nothing to compare a second
  // field against, so this rule exists here and nowhere else.
  const result = validatePasswordChange({
    currentPassword: 'old-password',
    newPassword: 'new-password',
    confirmPassword: '',
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.confirmPassword);
  assert.equal(result.errors.newPassword, undefined);
});

test('a name is required and bounded', () => {
  assert.equal(validateProfile({ name: 'A Real Name' }).valid, true);
  assert.equal(validateProfile({ name: '' }).valid, false);
  assert.equal(validateProfile({ name: '   ' }).valid, false);
  assert.equal(validateProfile({}).valid, false);
  assert.equal(validateProfile({ name: 'x'.repeat(MAX_NAME_LENGTH) }).valid, true);
  assert.equal(
    validateProfile({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) }).valid,
    false,
  );
});

test('the bounds match the ones the server enforces', () => {
  // registrationValidation.MIN_PASSWORD_LENGTH and accountUpdates.MAX_NAME_LENGTH.
  assert.equal(MIN_PASSWORD_LENGTH, 6);
  assert.equal(MAX_NAME_LENGTH, 60);
});

// -- reading the response ----------------------------------------------------

test('the account comes out of the response envelope', () => {
  const account = { _id: 'u1', name: 'A', email: 'a@example.com', type: 'student' };

  assert.deepEqual(readAccount({ success: true, data: account }), account);
});

test('a response with no account does not throw', () => {
  for (const body of [null, undefined, {}, { data: null }, { data: [] }, 'nope']) {
    assert.equal(readAccount(body), null, `expected null for ${JSON.stringify(body)}`);
  }
});

test('an account is editable unless the server says otherwise', () => {
  assert.equal(isEditable({ name: 'A' }), true);
  assert.equal(isEditable({ name: 'A', editable: true }), true);
  // The configured admin: a credential pair in the environment, not a users row.
  assert.equal(isEditable({ name: 'A', editable: false }), false);
  assert.equal(isEditable(null), false);
});

// -- reporting a failure -----------------------------------------------------

test('the server sentence and its per-field markers are both read', () => {
  const { message, errors } = readAccountError(
    {
      response: {
        status: 400,
        data: {
          message: 'Your current password is not correct',
          errors: { currentPassword: 'Your current password is not correct' },
        },
      },
    },
    'fallback',
  );

  assert.equal(message, 'Your current password is not correct');
  assert.ok(errors.currentPassword);
});

test('a response with no message falls back rather than showing nothing', () => {
  const { message, errors } = readAccountError(
    { response: { status: 500, data: {} } },
    'Your password could not be changed.',
  );

  assert.equal(message, 'Your password could not be changed.');
  assert.deepEqual(errors, {});
});

test('a request that never reached the server says so', () => {
  const { message } = readAccountError(new Error('Network Error'), 'fallback');

  assert.match(message, /could not be reached/i);
});

test('a non-object errors field is ignored rather than rendered', () => {
  const { errors } = readAccountError(
    { response: { status: 400, data: { message: 'no', errors: 'oops' } } },
    'fallback',
  );

  assert.deepEqual(errors, {});
});

// -- keeping the session in step ---------------------------------------------

test('a changed name is folded into the stored session user', () => {
  // The navbar greeting, the certificate and every review byline read `name`
  // off this object, so leaving it stale shows the old name until the next
  // sign-in.
  const stored = { _id: 'u1', name: 'Old Name', type: 'student', email: 'a@example.com' };
  const merged = mergeAccountIntoUser(stored, { name: 'New Name' });

  assert.equal(merged.name, 'New Name');
  assert.equal(merged._id, 'u1');
  assert.equal(merged.type, 'student');
  assert.equal(merged.email, 'a@example.com');
});

test('the merge never invents a session that was not there', () => {
  assert.equal(mergeAccountIntoUser(null, { name: 'New Name' }), null);
  assert.equal(mergeAccountIntoUser(undefined, { name: 'N' }), undefined);
});

test('an account with no name leaves the stored one alone', () => {
  const stored = { _id: 'u1', name: 'Old Name' };

  assert.equal(mergeAccountIntoUser(stored, {}).name, 'Old Name');
  assert.equal(mergeAccountIntoUser(stored, null).name, 'Old Name');
});
