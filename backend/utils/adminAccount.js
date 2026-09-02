// The admin identity, in one place.
//
// #125. The admin is not a `users` row. `adminLoginController` signs
// `{ id: "admin", role: "admin" }` and `authMiddleware` recognises that id
// without a database lookup:
//
//   if (decode.id === "admin") {
//     req.user = { _id: "admin", id: "admin", role: "admin", type: "admin" };
//     return next();
//   }
//
// That literal was written twice — once here in the middleware, and nowhere
// else, because the login response carried no account at all. It returned
// `{ success, token, message }`, and the browser's session layer needs both a
// token and a stored user with an id:
//
//   // frontend/src/auth/session.js
//   return parsed._id || parsed.id ? parsed : null;   // parseStoredUser
//
// So there was nothing to store under the `user` key, `isAuthenticated` was
// false, and the admin dashboard could not be reached even by an operator who
// called the endpoint by hand.
//
// The account the login returns and the account the middleware builds are the
// same object now, so the two cannot describe the admin differently.

const ADMIN_ID = "admin";

/**
 * Whether a decoded token id belongs to the configured admin rather than to a
 * `users` document.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
function isAdminId(id) {
  return String(id ?? "") === ADMIN_ID;
}

/**
 * The account payload for the configured admin.
 *
 * Shaped like the `userData` that `POST /api/user/login` returns, so the client
 * stores one kind of thing: `_id` for `parseStoredUser`, `type` for
 * `getUserRole`, `name` for the navbar's greeting.
 *
 * `name` is the configured `ADMIN_USERNAME` so an operator can see which
 * account they are signed in as. There is no email, because the admin is not an
 * account with a mailbox — it is a credential pair in the environment — and a
 * fabricated address would be worse than an absent one.
 *
 * @param {string} [username]
 * @returns {object}
 */
function buildAdminAccount(username) {
  const name = String(username ?? "").trim();

  return {
    _id: ADMIN_ID,
    id: ADMIN_ID,
    name: name || "Administrator",
    // `type` is what userModel calls the role and what lib/roles reads first.
    // `role` is carried too because several controllers accept either.
    type: "admin",
    role: "admin",
    // There is no verification flow for an account that does not have a
    // mailbox, and the UI reads this field when it renders an account.
    isVerified: true,
  };
}

module.exports = {
  ADMIN_ID,
  buildAdminAccount,
  isAdminId,
};
