// Reading an admin sign-in response.
//
// #125. The API has had `POST /api/admin/login` since the project started, the
// admin router guards eight routes behind the token it mints, and `AdminHome`,
// `PaymentRecords`, `ActivityLogs` and the admin course table have all been
// built and tested against those routes. Nothing in the browser ever called the
// endpoint:
//
//   $ grep -rn "api/admin/login" frontend/src
//   $
//
// `App.jsx` had no `/admin` route and `Login.jsx` posts to `/api/user/login`
// and nothing else, so the only issuer of a token carrying `role: "admin"` was
// unreachable — and `validateRegistration` refuses a self-assigned role (#55),
// so no account created through `/register` can hold it either.
//
// The rules for turning that response into a session live here, apart from
// React, so they can be asserted directly.

import { normalizeRole } from './roles.js';

export const ADMIN_LOGIN_URL = '/api/admin/login';

// Where an admin lands after signing in. The dashboard already renders
// `<AdminHome />` for this role through `UserHome`.
export const ADMIN_HOME_PATH = '/dashboard';

const GENERIC_FAILURE = 'Sign in failed. Please try again.';

/**
 * Turns a successful response body into the pair the session layer stores.
 *
 * `readSession` needs both halves and refuses either one alone:
 *
 *   parseStoredUser -> `parsed._id || parsed.id ? parsed : null`
 *   readSession     -> `if (!user || !isTokenValid(token)) return { ... }`
 *
 * which is exactly why a token-only response could not produce a session.
 *
 * @param {unknown} body
 * @returns {{ ok: true, token: string, user: object }
 *          |{ ok: false, message: string }}
 */
export function readAdminLogin(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, message: GENERIC_FAILURE };
  }

  if (body.success !== true) {
    return {
      ok: false,
      message:
        typeof body.message === 'string' && body.message.trim()
          ? body.message
          : GENERIC_FAILURE,
    };
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const user = body.userData;

  if (!token) {
    return { ok: false, message: GENERIC_FAILURE };
  }

  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    return { ok: false, message: GENERIC_FAILURE };
  }

  if (!user._id && !user.id) {
    return { ok: false, message: GENERIC_FAILURE };
  }

  // A response that says "signed in" but hands back a role the admin screens
  // do not serve would produce a session that renders the "no dashboard yet"
  // panel. Refuse it here where there is still a form to show a message on.
  if (normalizeRole(user.type ?? user.role) !== 'admin') {
    return {
      ok: false,
      message: 'That account is not an administrator.',
    };
  }

  return { ok: true, token, user };
}

/**
 * The message to show for a failed request.
 *
 * `adminLoginController` answers 401 for bad credentials and 500 when the
 * server has no `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` or no `JWT_SECRET`
 * configured. Those are very different problems for whoever is standing at the
 * form, so they are not collapsed into one sentence.
 *
 * @param {object} error an axios error
 * @returns {string}
 */
export function describeAdminLoginError(error) {
  const status = error?.response?.status;
  const message = error?.response?.data?.message;

  if (status === 401) {
    return 'Those credentials were not accepted.';
  }

  if (status === 429) {
    return 'Too many attempts. Please wait and try again.';
  }

  if (status >= 500 && typeof message === 'string' && message.trim()) {
    // "Admin access is not configured on this server" is worth passing
    // through verbatim: it tells an operator to go and set the environment
    // variables rather than to keep retyping a password.
    return message;
  }

  if (!error?.response) {
    return 'The server could not be reached.';
  }

  return GENERIC_FAILURE;
}
