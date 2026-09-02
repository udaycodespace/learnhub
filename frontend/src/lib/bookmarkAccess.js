// Who has a wishlist.
//
// The API decides this once, for every bookmark route at the same time:
//
//   router.use(authMiddleware);
//   router.use(checkRole(["student"]));     // backend/routers/courseBookmarkRoutes.js
//
// The client knew it in one place — the `/saved-courses` route guard — and not
// in the two that actually reach for the feature. `NavBar` rendered the Saved
// link for every signed-in account, and `BookmarksProvider` fetched the
// wishlist for anyone holding a token. Signed in as a teacher or an admin that
// meant a `☆ Saved 0` link which navigated to `/saved-courses`, was bounced
// straight back to `/dashboard` by the guard, and a 403 in the console on every
// page load (#115).
//
// `lib/dashboardPanels.js` exists for exactly this reason and says so: the
// navbar renders from `visiblePanelLinks(user)`, which is the same data
// `resolvePanel` validates against, so "the navbar cannot advertise a link the
// dashboard would refuse to open". The Saved link was the one navbar entry
// outside that mechanism. This is the same idea, for the same reason.

import { ROLES, hasAnyRole } from './roles.js';

/**
 * The roles the API accepts on `/api/bookmarks`.
 *
 * A list rather than a boolean so the route guard can hand it straight to
 * `ProtectedRoute`, which is what stops the guard and this file disagreeing.
 */
export const BOOKMARK_ROLES = Object.freeze([ROLES.STUDENT]);

/**
 * Whether an account has a wishlist at all.
 *
 * Goes through `lib/roles`, which is where the "Teacher" vs "teacher"
 * comparison rule already lives — accounts written before #55 still store a
 * capitalised `type`.
 *
 * @param {object|null|undefined} user the stored user object
 * @returns {boolean}
 */
export function canUseBookmarks(user) {
  return hasAnyRole(user, BOOKMARK_ROLES);
}

// Why the feature is unavailable, when it is.
export const BOOKMARK_DENIAL = Object.freeze({
  SIGNED_OUT: 'signed-out',
  ROLE: 'role',
});

/**
 * Why this session cannot use bookmarks, or `null` when it can.
 *
 * The two reasons need different answers and used to get the same one. A
 * signed-out visitor should be sent to the login screen — the feature is
 * theirs, they just are not signed in yet. An educator should not be offered
 * the control in the first place, because signing in again will not help.
 *
 * @param {object|null|undefined} user
 * @param {boolean} isAuthenticated
 * @returns {string|null} a `BOOKMARK_DENIAL` value, or null
 */
export function bookmarkDenialReason(user, isAuthenticated) {
  if (!isAuthenticated) return BOOKMARK_DENIAL.SIGNED_OUT;
  if (!canUseBookmarks(user)) return BOOKMARK_DENIAL.ROLE;

  return null;
}

/**
 * Whether this session should issue bookmark requests at all.
 *
 * `BookmarksProvider` calls the wishlist endpoint on mount, and it wraps the
 * whole application, so a session that cannot use the feature was producing one
 * failed authenticated round trip per page load.
 *
 * @param {object|null|undefined} user
 * @param {boolean} isAuthenticated
 * @returns {boolean}
 */
export function shouldLoadBookmarks(user, isAuthenticated) {
  return bookmarkDenialReason(user, isAuthenticated) === null;
}

/**
 * The message for an action that cannot succeed.
 *
 * @param {string|null} reason a `BOOKMARK_DENIAL` value
 * @returns {string}
 */
export function bookmarkDenialMessage(reason) {
  if (reason === BOOKMARK_DENIAL.SIGNED_OUT) {
    return 'Sign in to save courses.';
  }

  if (reason === BOOKMARK_DENIAL.ROLE) {
    return 'Saved courses are a student feature.';
  }

  return '';
}
