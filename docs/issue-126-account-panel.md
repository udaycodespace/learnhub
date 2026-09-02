# An account a signed-in user owns (#126)

## The defect

Sixteen routes on `/api/user`, and not one of them read or wrote the account.
No `/me`, no `/profile`, no `/change-password`. The ⚙️ Settings dropdown held
one control, a theme toggle. `grep -rn "profile" frontend/src` returned nothing.

The only way to set a new password was Log Out → Forgot password? → check
email.

## Why that is a security problem and not only a missing screen

**Rotating a password required giving up the session and using a weaker path.**
The signed-in user has already proved something the application can check: they
hold a valid token for this account. Sending them to `/forgot-password` makes
them prove something it cannot — that they can read a mailbox. That channel is
outside the application, #95 had to harden it precisely because it answers
uniformly to strangers, and anybody with mailbox access can drive it too. The
strongest available proof was discarded in favour of the weakest.

**The recovery path has side effects a rotation should not cause.**

```js
$set: { password: hashedPassword, isVerified: true },
$unset: { resetToken: "", resetTokenExpiry: "", resetTokenAttempts: "",
          otp: "", otpExpiry: "", otpAttempts: "" },
```

Marking the address verified is correct for a reset — holding the emailed code
*is* proof of the mailbox — but it is a state change a routine password change
has no business making, and it silently discards a pending verification code.

**A password change left no trace.** `activityLogModel`'s `action` enum was
`["login", "logout", "login_failed"]`. The log could not answer "was this
account's password changed, and from where" — the successor to the question #87
added `login_failed` for.

**Nothing else could be corrected.** A name typed wrong at registration was
permanent, and it is read by the navbar, the certificate and every review
byline.

## What is here

**`GET /api/user/account`** — what the application stores about you. There was
no way for anyone to see it. `toAccountView` is an explicit allow-list rather
than a list of fields to strip: `adminController` projects with
`-password -otp -resetToken …`, which is correct but has to be extended every
time a sensitive field is added to the schema. An allow-list cannot leak a field
nobody thought about.

**`PUT /api/user/account`** — the display name, and only that. Deliberately not
`email`: the address is the account's identity, unique-indexed since #72, and
moving it has to be proved against the new mailbox before it takes effect, which
is a verification flow of its own rather than a text input. Deliberately not
`type`: that is the field #55 stopped clients writing. The updated account comes
back in the response so the client can replace the stored session user instead of
rendering a stale name until the next sign-in.

**`POST /api/user/change-password`** — requires the current password, and that
requirement is the point of the endpoint. Possession of an unattended tab must
not be enough to lock the owner out of their own account.

It clears any reset code that was in flight, so one somebody else requested does
not still work afterwards. It deliberately does **not** touch `isVerified` or
the OTP fields: the reset flow sets them because holding the emailed code proves
the mailbox, and this route proves nothing about the mailbox, so it must not
claim to. An unverified account stays unverified with its pending code intact.

The success message says plainly that sessions signed in elsewhere stay signed
in until their token expires. The token is stateless; there is no server-side
session to revoke, and anything else would be a promise the application cannot
keep.

**Three new activity log actions** — `password_changed`,
`password_change_failed` and `profile_updated` — added to the schema enum, to
the listing filter's allow-list and to the admin table's dropdown and badge
labels. `password_change_failed` is the one that matters most: a run of them
against a signed-in account is somebody working on a session they should not
have. A test asserts the storable set and the filterable set are identical, so
an action the log can write but the filter refuses cannot appear again.

**The Account panel** at `/dashboard?panel=account`, listed in the navbar for
every role. `lib/account.js` mirrors the server's rules for the browser — the
same table asserted on both sides, the pattern #114 established, because nothing
can import across the wire. The confirmation field exists only here: the server
takes one new password and has nothing to compare a second field against.

`styles/account.css` is its own file rather than another block appended to
`theme.css`, for the reason `theme.css`'s own header gives: several branches
each appending to one shared file conflicts on every pair of them.

## Rate limiting

`/change-password` gets the same per-client rate limiter every credential
endpoint has. It is already behind a valid token, which is the bound that
matters, but it also takes a password and tells you whether the guess was right.

It gets **no** failure throttle. That mechanism locks an email address, and
locking the owner of a live session out of the rest of the application because
they mistyped their current password twice is worse than the thing it prevents.
The failures go to the activity log instead.

## The configured admin

`authMiddleware` recognises the reserved id `"admin"` without a database lookup
— it is a credential pair in the environment, not a `users` row. Every route
here would otherwise hand `"admin"` to `findById`, which casts it to an ObjectId
and throws. It reads its account from what the middleware already knows, marked
`editable: false`, and both write routes answer 403 with a sentence saying where
those credentials actually live.

## Tests

`backend/tests/account-management.test.js` — 21 tests with injected models, so
no database: an update cannot reach `type`, `email` or `isVerified`; the wrong
current password changes nothing and is recorded; a change clears the reset
credential but leaves `isVerified` and the OTP alone; the account view is
checked against a document carrying a field nobody has declared yet; and the
admin branch is asserted with a `User` stub whose `findById` throws, so the test
fails if the lookup is ever reached.

`frontend/src/lib/account.test.js` — 16 tests, including a seven-row table of
password cases the server asserts too.

`frontend/src/lib/dashboardPanels.test.js` — the existing expectations updated
for the new panel, plus tests that every real role may open it and an unreadable
role falls back to home.
