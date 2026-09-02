// What a signed-in account may change about itself.
//
// #126. There was nothing here to change it with. The whole of /api/user is
// sixteen routes, and not one of them reads or writes the account: no /me, no
// /profile, no /change-password. The only way to set a new password was to sign
// out and complete the emailed reset flow.
//
// That is a security problem and not only a missing screen. The authenticated
// user has already proved who they are; sending them to /forgot-password makes
// them prove control of a mailbox instead — a channel outside the application,
// which #95 hardened precisely because it answers uniformly to strangers, and
// which anyone with mailbox access can drive too. The strongest proof available
// was discarded in favour of the weakest.
//
// The rules are an allow-list, the same shape as validateRegistration, for the
// same reason: `{ ...req.body }` is how #55 happened.

const {
  MIN_PASSWORD_LENGTH,
} = require("./registrationValidation");

const MAX_NAME_LENGTH = 60;

const asTrimmedString = (value) =>
  typeof value === "string" ? value.trim() : "";

/**
 * Validates a profile edit.
 *
 * `name` is the only field on it. Deliberately not `email`: the address is the
 * account's identity, it is unique-indexed (#72), and changing it has to be
 * proved against the new mailbox before it takes effect — which is a
 * verification flow of its own, not a text input. And deliberately not `type`:
 * that is the field #55 stopped clients writing.
 *
 * @param {object} [body]
 * @returns {{ valid: boolean, errors: object, value?: { name: string } }}
 */
function validateProfileUpdate(body = {}) {
  const errors = {};
  const name = asTrimmedString(body.name);

  if (!name) {
    errors.name = "Name is required";
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `Name must be at most ${MAX_NAME_LENGTH} characters`;
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: {}, value: { name } };
}

/**
 * Validates a password change.
 *
 * `currentPassword` is required, and that requirement is the point of the
 * endpoint. Possession of an unattended tab must not be enough to lock the
 * owner out of their own account.
 *
 * The two passwords are compared here so an obviously pointless change is
 * refused before a bcrypt round is spent on it. The real check — that
 * `currentPassword` matches what is stored — needs the hash and lives in the
 * controller.
 *
 * @param {object} [body]
 * @returns {{ valid: boolean, errors: object,
 *            value?: { currentPassword: string, newPassword: string } }}
 */
function validatePasswordChange(body = {}) {
  const errors = {};

  const currentPassword =
    typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword =
    typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword) {
    errors.currentPassword = "Your current password is required";
  }

  if (!newPassword) {
    errors.newPassword = "A new password is required";
  } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  } else if (currentPassword && newPassword === currentPassword) {
    errors.newPassword = "The new password must be different";
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: {}, value: { currentPassword, newPassword } };
}

/**
 * The account, as it goes to the client.
 *
 * An explicit allow-list rather than a list of things to strip. `adminController`
 * projects with `-password -otp -resetToken …`, which is correct but has to be
 * extended every time a sensitive field is added to the schema; this cannot
 * leak a field nobody thought about.
 *
 * @param {object} user a user document or lean object
 * @returns {object}
 */
function toAccountView(user) {
  if (!user || typeof user !== "object") return null;

  return {
    _id: user._id,
    id: user._id,
    name: user.name,
    email: user.email,
    type: user.type,
    role: user.type,
    isVerified: Boolean(user.isVerified),
    createdAt: user.createdAt ?? null,
  };
}

/**
 * Turns a validation result into the single sentence the clients render, the
 * same way formatValidationMessage does for registration.
 *
 * @param {object} [errors]
 * @returns {string}
 */
function formatAccountMessage(errors = {}) {
  return Object.values(errors).join(". ");
}

module.exports = {
  MAX_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  formatAccountMessage,
  toAccountView,
  validatePasswordChange,
  validateProfileUpdate,
};
