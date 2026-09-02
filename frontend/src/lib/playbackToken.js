// When the course player should ask for a new playback token.
//
// #124. `/coursecontent` mints a token that lives for thirty minutes, and
// `CourseContent` fetched it once, in a `useEffect` keyed on `courseId`.
// Nothing renewed it. Half an hour into a course the value in state was a
// credential the stream route refuses, and because the request is issued by a
// `<video>` element rather than by `axiosInstance`, the 401 never reached the
// interceptor: no message, no redirect, an empty player.
//
// The rules live here, apart from React, so they can be asserted directly
// against a clock instead of through a rendered component.

// Renew this far ahead of the deadline. Long enough to cover a slow request and
// a backgrounded tab whose timers were throttled; short enough that a session
// is not renewing constantly.
export const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

// A token whose expiry is unknown is still worth renewing on a schedule, so
// there is a floor to fall back to. Below the leeway on purpose: if the server
// ever shortens the lifetime, the fallback still lands inside it.
export const FALLBACK_REFRESH_MS = 10 * 60 * 1000;

// Never schedule a timer tighter than this. Protects against a clock skew that
// puts the deadline in the past turning into a request-per-tick loop.
const MIN_REFRESH_DELAY_MS = 5 * 1000;

/**
 * Reads the expiry the API sent alongside the token.
 *
 * Accepts epoch milliseconds (what `issuePlaybackToken` returns), an ISO
 * string, or a `Date`. Anything else — including the `undefined` an older
 * server would send — comes back as `null`, which callers treat as "unknown"
 * rather than "expired".
 *
 * @param {unknown} value
 * @returns {number|null} epoch milliseconds
 */
export function readExpiry(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    // A bare numeric string is epoch ms; anything else is left to Date.parse.
    const asNumber = Number(value);
    if (value.trim() !== '' && Number.isFinite(asNumber)) return asNumber;

    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

/**
 * @param {unknown} expiresAt
 * @param {number} [now]
 * @returns {number|null} milliseconds left, or null when the expiry is unknown
 */
export function millisecondsUntilExpiry(expiresAt, now = Date.now()) {
  const expiry = readExpiry(expiresAt);

  return expiry === null ? null : expiry - now;
}

/**
 * Whether the token should be replaced before it is used again.
 *
 * A missing token always needs one. A token with an unknown expiry does not —
 * it was just issued as far as this module can tell, and the scheduled refresh
 * will pick it up on the fallback interval.
 *
 * @param {object} state
 * @param {string} state.token
 * @param {unknown} state.expiresAt
 * @param {number} [now]
 * @returns {boolean}
 */
export function needsRefresh({ token, expiresAt } = {}, now = Date.now()) {
  if (!token) return true;

  const remaining = millisecondsUntilExpiry(expiresAt, now);

  if (remaining === null) return false;

  return remaining <= REFRESH_LEEWAY_MS;
}

/**
 * How long to wait before renewing.
 *
 * The deadline minus the leeway, floored so a stale or skewed expiry cannot
 * schedule a tight loop, and falling back to a fixed interval when the server
 * did not say when the token expires.
 *
 * @param {unknown} expiresAt
 * @param {number} [now]
 * @returns {number} milliseconds
 */
export function refreshDelay(expiresAt, now = Date.now()) {
  const remaining = millisecondsUntilExpiry(expiresAt, now);

  if (remaining === null) return FALLBACK_REFRESH_MS;

  return Math.max(MIN_REFRESH_DELAY_MS, remaining - REFRESH_LEEWAY_MS);
}

/**
 * Pulls the token and its expiry out of an API response body.
 *
 * `/coursecontent/:courseid` and `/playbacktoken/:courseid` both carry the same
 * three fields, so both responses are read the same way.
 *
 * @param {object|null|undefined} body
 * @returns {{ token: string, expiresAt: number|null }}
 */
export function readTokenResponse(body) {
  if (!body || typeof body !== 'object') return { token: '', expiresAt: null };

  return {
    token: typeof body.playbackToken === 'string' ? body.playbackToken : '',
    expiresAt: readExpiry(body.playbackTokenExpiresAt),
  };
}
