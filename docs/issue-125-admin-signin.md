# A way into the admin dashboard (#125)

## The defect

There was no way to sign in as an admin.

```
$ grep -rn "api/admin/login" frontend/src
$
```

`POST /api/admin/login` is the only issuer of a token carrying `role: "admin"`,
and nothing in the browser called it. `App.jsx` declared eight routes and none
of them was `/admin`; `Login.jsx` posts to `/api/user/login` and nothing else.

The normal sign-in is not a way in either. `validateRegistration` refuses a
self-assigned role — that is the whole point of #55 — so no account created
through `/register` can hold `type: "admin"`, and `backend/scripts/` contains
`dedupeUserEmails.js` and nothing else.

Both ends of the feature were complete and neither could reach the other:

| built | unreachable |
| --- | --- |
| `adminLoginController`, constant-time credential check, activity log entry | no caller |
| eight routes behind `[authMiddleware, checkRole(["admin"])]` | no token |
| `AdminHome`, `PaymentRecords`, `ActivityLogs`, admin `AllCourses` | never rendered |

## Calling the endpoint by hand did not help either

Suppose an operator ran the request in a console and wrote the token into
storage. The session layer still refused it:

```js
// frontend/src/auth/session.js
return parsed._id || parsed.id ? parsed : null;      // parseStoredUser
...
if (!user || !isTokenValid(token, nowMs)) {          // readSession
  return { isAuthenticated: false, user: null, token: null, role: '' };
}
```

`readSession` needs **both** a valid token and a stored user object with an id,
and the endpoint returned neither an account nor an id:

```js
return res.status(200).send({ success: true, token, message: "Admin login successful" });
```

So there was nothing to put under the `user` key, `isAuthenticated` stayed
false, `ProtectedRoute` bounced back to `/login`, and `getUserRole(undefined)`
returned `''` — which would have rendered "This account has no dashboard yet"
even if the guard had let it through.

## What is here

**`utils/adminAccount.js`.** The admin is not a `users` row: `authMiddleware`
recognises the reserved id without a lookup and built the identity inline.

```js
if (decode.id === "admin") {
  req.user = { _id: "admin", id: "admin", role: "admin", type: "admin" };
  return next();
}
```

That literal now comes from `buildAdminAccount`, and so does the account in the
login response, so the two cannot describe the admin differently. It carries
`_id` for `parseStoredUser`, `type` and `role` for `getUserRole`, and `name`
from `ADMIN_USERNAME` so the navbar greeting says which operator account is
signed in. It carries **no** email: the admin is a credential pair in the
environment, not an account with a mailbox, and a fabricated address would be
worse than an absent one.

**The login response carries that account** under `userData`, the same key
`POST /api/user/login` uses, so the client stores one kind of thing.

**`/admin/login`**, wrapped in `PublicOnlyRoute` like `/login`, rendering
`components/admin/AdminLogin.jsx`. It posts the credentials, reads the response
through `lib/adminSession.js`, writes the session with the same `writeSession`
helper the learner sign-in uses, and calls `refresh()` on the auth context
before navigating — `AuthProvider` reads storage on mount and on the `storage`
event, which only fires in *other* tabs, so without that call the redirect would
arrive before the provider knew there was a session and `ProtectedRoute` would
bounce it straight back.

**A link in the footer**, under Legal, rather than in the main navigation: it is
for the operator account configured on the server, not for learners. But it has
to exist somewhere, and until now it existed nowhere.

**`lib/adminSession.js`** holds the rules for turning the response into a
session, apart from React. It refuses a response that carries a token with no
account — the exact shape the endpoint used to return — and refuses a non-admin
role at the form, where there is still somewhere to show a message, rather than
at the dashboard where the only outcome is a blank panel. `describeAdminLoginError`
keeps a 500 from an unconfigured server ("Admin access is not configured on this
server") verbatim, because that sentence tells an operator to set the
environment variables instead of retyping a password that can never work.

## Behaviour that did not change

- The credential check, its constant-time comparison, the production refusal of
  a plaintext `ADMIN_PASSWORD`, and the activity log entries on success and
  failure.
- The token: same claims, same secret, same lifetime. `admin-auth.test.js`
  passes untouched.
- Every admin route and every admin screen. None of them needed editing; they
  needed reaching.

## Tests

`backend/tests/admin-account.test.js` — 7 tests on the account object itself.
No database: what it carries, what it deliberately does not carry, and that a
fresh object is returned each call, because `authMiddleware`'s other branch
assigns to `req.user` and a shared singleton would make that a cross-request
mutation.

`backend/tests/admin-auth.test.js` — 5 tests added to the suite that already has
a database running. The account satisfies the browser's own `parseStoredUser`
rule, restated on this side so the two cannot drift, and survives the JSON round
trip `localStorage` puts it through; the account in the login response and the
one `authMiddleware` builds are compared field by field through a probe route;
a rejected sign-in carries no account; and the response body is checked for the
configured password and for anything shaped like a bcrypt hash.

These went into the existing file rather than a new one on purpose. Sixteen test
files each start their own `MongoMemoryServer`, and `node --test` runs them in
parallel; a seventeenth tipped this machine into `Instance failed to start
within 10000ms` across unrelated suites.

`frontend/src/lib/adminSession.test.js` — 15 tests, including the defect itself:
a body of `{ success: true, token }` with no account is refused, because that is
precisely what could not produce a session.
