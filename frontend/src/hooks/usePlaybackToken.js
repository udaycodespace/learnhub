import { useCallback, useEffect, useRef, useState } from 'react';

import axiosInstance from '../components/common/AxiosInstance';
import {
  needsRefresh,
  readTokenResponse,
  refreshDelay,
} from '../lib/playbackToken';

// Keeps a usable playback token for one course (#124).
//
// Two mechanisms, because neither is sufficient alone:
//
//   The timer keeps the token fresh while the tab is open and visible, so a
//   viewer who presses play at minute 45 does not wait for a round trip.
//
//   `ensureFresh()` is the one that actually closes the hole. Background tabs
//   have their timers throttled — Chrome clamps them to once a minute and can
//   suspend them entirely — so a scheduled refresh is a convenience, not a
//   guarantee. Asking again at the moment a video is about to be played is.
//
// Both go through the same `refresh`, and a refresh already in flight is shared
// rather than duplicated: pressing play three times issues one request.

/**
 * @param {string} courseId
 * @returns {{
 *   token: string,
 *   error: string,
 *   adopt: (body: object) => void,
 *   ensureFresh: () => Promise<string>,
 * }}
 */
export default function usePlaybackToken(courseId) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  // Held in a ref as well as in state: `ensureFresh` is called from an event
  // handler and has to read the current value, not the one captured when the
  // handler was created.
  const stateRef = useRef({ token: '', expiresAt: null });
  const inFlightRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const store = useCallback((next) => {
    stateRef.current = next;

    if (mountedRef.current) setToken(next.token);
  }, []);

  /**
   * Takes the token out of a response the caller already made, so loading the
   * course page does not immediately ask for a second token.
   */
  const adopt = useCallback(
    (body) => {
      const next = readTokenResponse(body);

      if (!next.token) return;

      store(next);
      if (mountedRef.current) setError('');
    },
    [store],
  );

  const refresh = useCallback(async () => {
    if (!courseId) return '';

    // One request at a time. Play, a timer firing and a re-focus can all land
    // together.
    if (inFlightRef.current) return inFlightRef.current;

    const request = (async () => {
      try {
        const res = await axiosInstance.get(
          `/api/user/playbacktoken/${courseId}`,
        );

        const next = readTokenResponse(res.data);

        if (!next.token) {
          throw new Error('The server did not return a playback token.');
        }

        store(next);
        if (mountedRef.current) setError('');

        return next.token;
      } catch (requestError) {
        // A 401 is already handled by the axios interceptor, which clears the
        // session and redirects. Anything else is this page's problem to
        // report — silence is what made the original defect invisible.
        const status = requestError?.response?.status;

        if (mountedRef.current && status !== 401) {
          setError(
            status === 403
              ? 'You are no longer enrolled in this course.'
              : 'Video access could not be refreshed. Reload the page to try again.',
          );
        }

        return '';
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = request;
    return request;
  }, [courseId, store]);

  /**
   * Returns a token that is good right now, fetching one first if the one in
   * hand is missing or about to lapse.
   */
  const ensureFresh = useCallback(async () => {
    if (!needsRefresh(stateRef.current)) return stateRef.current.token;

    return refresh();
  }, [refresh]);

  // Reset when the page moves to another course, so a token minted for the
  // previous one is never handed to the player. The stream route would refuse
  // it — `tokenCoversCourse` compares the course id — but not holding it at
  // all is clearer than relying on that.
  useEffect(() => {
    stateRef.current = { token: '', expiresAt: null };
    setToken('');
    setError('');
  }, [courseId]);

  // Renew ahead of the deadline while the page is open.
  useEffect(() => {
    if (!courseId || !token) return undefined;

    const timer = setTimeout(() => {
      refresh();
    }, refreshDelay(stateRef.current.expiresAt));

    return () => clearTimeout(timer);
  }, [courseId, token, refresh]);

  // A tab that was in the background long enough for its timer to be throttled
  // comes back with a token that may already be spent. Check on the way in.
  useEffect(() => {
    if (!courseId) return undefined;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') ensureFresh();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [courseId, ensureFresh]);

  return { token, error, adopt, ensureFresh };
}
