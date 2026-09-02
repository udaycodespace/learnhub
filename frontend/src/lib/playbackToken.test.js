import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_REFRESH_MS,
  REFRESH_LEEWAY_MS,
  millisecondsUntilExpiry,
  needsRefresh,
  readExpiry,
  readTokenResponse,
  refreshDelay,
} from './playbackToken.js';

// #124. The player held one token for the life of the page. Thirty minutes in,
// the stream route refused it and the <video> element failed with nothing on
// screen — its 401 does not pass through the axios interceptor.
//
// The clock is injected everywhere here, so the half hour the defect needs is
// asserted directly rather than waited for.

const NOW = 1_700_000_000_000;
const MINUTE = 60 * 1000;
const TOKEN = 'a.playback.token';

// -- reading what the server sent --------------------------------------------

test('an epoch-millisecond expiry is read as-is', () => {
  assert.equal(readExpiry(NOW), NOW);
});

test('an ISO timestamp is accepted', () => {
  assert.equal(readExpiry(new Date(NOW).toISOString()), NOW);
});

test('a numeric string is epoch milliseconds, not a date to parse', () => {
  assert.equal(readExpiry(String(NOW)), NOW);
});

test('a Date is accepted', () => {
  assert.equal(readExpiry(new Date(NOW)), NOW);
});

test('an unusable expiry is unknown rather than zero', () => {
  // Zero would read as 1970 and mark every token permanently expired.
  for (const value of [undefined, null, '', 'soon', {}, [], NaN, new Date('x')]) {
    assert.equal(readExpiry(value), null, `expected null for ${String(value)}`);
  }
});

test('millisecondsUntilExpiry counts down against the injected clock', () => {
  assert.equal(millisecondsUntilExpiry(NOW + 5 * MINUTE, NOW), 5 * MINUTE);
  assert.equal(millisecondsUntilExpiry(NOW - MINUTE, NOW), -MINUTE);
  assert.equal(millisecondsUntilExpiry(undefined, NOW), null);
});

// -- when to renew -----------------------------------------------------------

test('no token always needs one', () => {
  assert.equal(needsRefresh({ token: '', expiresAt: NOW + 30 * MINUTE }, NOW), true);
  assert.equal(needsRefresh(undefined, NOW), true);
});

test('a token with most of its life left is left alone', () => {
  assert.equal(
    needsRefresh({ token: TOKEN, expiresAt: NOW + 30 * MINUTE }, NOW),
    false,
  );
});

test('a token inside the leeway is renewed before it is used', () => {
  assert.equal(
    needsRefresh({ token: TOKEN, expiresAt: NOW + REFRESH_LEEWAY_MS - 1 }, NOW),
    true,
  );
});

test('the leeway boundary itself renews', () => {
  assert.equal(
    needsRefresh({ token: TOKEN, expiresAt: NOW + REFRESH_LEEWAY_MS }, NOW),
    true,
  );
});

test('the defect: a token issued thirty minutes ago is renewed, not used', () => {
  // The exact state CourseContent was in. `expiresAt` is the deadline the
  // server set when the page mounted; `now` is half an hour later, when the
  // student clicks Play Video on the next section.
  const mountedAt = NOW;
  const expiresAt = mountedAt + 30 * MINUTE;
  const clickedAt = mountedAt + 30 * MINUTE + 1;

  assert.equal(needsRefresh({ token: TOKEN, expiresAt }, clickedAt), true);
});

test('an unknown expiry is not treated as expired', () => {
  // An older server that sends the token without a deadline. Renewing on every
  // play would be worse than letting the fallback interval handle it.
  assert.equal(needsRefresh({ token: TOKEN, expiresAt: null }, NOW), false);
});

// -- when to schedule the renewal --------------------------------------------

test('the timer is set to the deadline minus the leeway', () => {
  assert.equal(refreshDelay(NOW + 30 * MINUTE, NOW), 30 * MINUTE - REFRESH_LEEWAY_MS);
});

test('an expiry already in the past does not schedule a tight loop', () => {
  const delay = refreshDelay(NOW - MINUTE, NOW);

  assert.ok(delay >= 5000, `expected a floor, got ${delay}`);
});

test('an unknown expiry falls back to a fixed interval', () => {
  assert.equal(refreshDelay(undefined, NOW), FALLBACK_REFRESH_MS);
});

test('the fallback interval lands well inside the token lifetime', () => {
  // PLAYBACK_TTL_SECONDS is thirty minutes on the server. The fallback is what
  // runs when the server did not state a deadline, so it has to fire with room
  // to spare even against a lifetime shorter than the one in use today.
  const SERVER_TTL_MS = 30 * MINUTE;

  assert.ok(
    FALLBACK_REFRESH_MS < SERVER_TTL_MS - REFRESH_LEEWAY_MS,
    `${FALLBACK_REFRESH_MS}ms leaves no margin inside a ${SERVER_TTL_MS}ms token`,
  );
});

// -- reading either response the same way ------------------------------------

test('the coursecontent and playbacktoken bodies are read identically', () => {
  const body = {
    success: true,
    playbackToken: TOKEN,
    playbackTokenExpiresAt: NOW + 30 * MINUTE,
    playbackTokenExpiresIn: 1800,
  };

  assert.deepEqual(readTokenResponse(body), {
    token: TOKEN,
    expiresAt: NOW + 30 * MINUTE,
  });
});

test('a body with no token reads as no token', () => {
  assert.deepEqual(readTokenResponse({ success: true }), {
    token: '',
    expiresAt: null,
  });
  assert.deepEqual(readTokenResponse(null), { token: '', expiresAt: null });
  assert.deepEqual(readTokenResponse('nope'), { token: '', expiresAt: null });
});

test('a token without an expiry is still adopted', () => {
  // What an older server returns. The token is usable; only the schedule falls
  // back.
  assert.deepEqual(readTokenResponse({ playbackToken: TOKEN }), {
    token: TOKEN,
    expiresAt: null,
  });
});
