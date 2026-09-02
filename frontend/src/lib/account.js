// The account rules, mirrored for the browser.
//
// #126. There was no account screen and no route behind one. A signed-in user
// could not change their password, could not correct a name typed wrong at
// registration, and could not see what the application stores about them. The
// only path to a new password was Log Out → Forgot password? → check email:
// trading a proof the application can check ("I hold a valid session for this
// account") for one it cannot ("I can read this mailbox").
//
// These are the same rules `backend/utils/accountUpdates.js` enforces. Nothing
// can import across the wire, so the same table is asserted on both sides —
// the pattern #114 established for the pricing rule. The server stays
// authoritative; this only avoids a round trip to be told a field is empty.

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_NAME_LENGTH = 60;

const asTrimmedString = (value) =>
  typeof value === 'string' ? value.trim() : '';

/**
 * @param {object} [values]
 * @returns {{ valid: boolean, errors: object }}
 */
export function validateProfile(values = {}) {
  const errors = {};
  const name = asTrimmedString(values.name);

  if (!name) {
    errors.name = 'Name is required';
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be at most ${MAX_NAME_LENGTH} characters`;
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * @param {object} [values]
 * @returns {{ valid: boolean, errors: object }}
 */
export function validatePasswordChange(values = {}) {
  const errors = {};

  const currentPassword =
    typeof values.currentPassword === 'string' ? values.currentPassword : '';
  const newPassword =
    typeof values.newPassword === 'string' ? values.newPassword : '';
  const confirmPassword =
    typeof values.confirmPassword === 'string' ? values.confirmPassword : '';

  if (!currentPassword) {
    errors.currentPassword = 'Your current password is required';
  }

  if (!newPassword) {
    errors.newPassword = 'A new password is required';
  } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  } else if (currentPassword && newPassword === currentPassword) {
    errors.newPassword = 'The new password must be different';
  }

  // Confirmation is a browser-side concern only — the server takes one new
  // password and has nothing to compare a second field against.
  if (newPassword && confirmPassword !== newPassword) {
    errors.confirmPassword = 'The two passwords do not match';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * The account object out of a GET or PUT response.
 *
 * @param {unknown} body
 * @returns {object|null}
 */
export function readAccount(body) {
  if (!body || typeof body !== 'object') return null;

  const data = body.data;

  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  return data;
}

/**
 * Whether this account can be edited here.
 *
 * The configured admin is a credential pair in the environment rather than a
 * `users` row, so its name and password are not this screen's to change. The
 * server says so with `editable: false`; an older response that says nothing is
 * read as editable, which is what every real account is.
 *
 * @param {object|null} account
 * @returns {boolean}
 */
export function isEditable(account) {
  return Boolean(account) && account.editable !== false;
}

/**
 * The sentence to show for a failed request, and the per-field markers under
 * it. `errors` is the map the server sends beside `message`, the shape #114
 * introduced for the enrolment form.
 *
 * @param {object} error an axios error
 * @param {string} fallback
 * @returns {{ message: string, errors: object }}
 */
export function readAccountError(error, fallback) {
  const data = error?.response?.data;

  const message =
    typeof data?.message === 'string' && data.message.trim()
      ? data.message
      : error?.response
        ? fallback
        : 'The server could not be reached.';

  const errors =
    data?.errors && typeof data.errors === 'object' && !Array.isArray(data.errors)
      ? data.errors
      : {};

  return { message, errors };
}

/**
 * Folds a changed name back into the stored session user.
 *
 * The navbar greeting, the certificate and every review byline read `name` off
 * the session object, so leaving it stale would show the old name until the
 * next sign-in.
 *
 * @param {object|null} storedUser
 * @param {object|null} account
 * @returns {object|null}
 */
export function mergeAccountIntoUser(storedUser, account) {
  if (!storedUser || typeof storedUser !== 'object') return storedUser;
  if (!account || typeof account !== 'object') return storedUser;

  return {
    ...storedUser,
    ...(typeof account.name === 'string' ? { name: account.name } : {}),
  };
}
