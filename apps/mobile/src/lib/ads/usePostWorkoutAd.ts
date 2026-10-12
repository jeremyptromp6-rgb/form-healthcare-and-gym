import { initialPostWorkoutAd, postWorkoutAdReducer, type PostWorkoutAdPhase } from '@form/domain';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { hasFeature } from '../pro';
import { useEntitlements } from '../queries';
import type { PostWorkoutAdEvent } from '../types';
import { networkAdProvider } from './networkProvider';
import { failureCode, type InterstitialAdProvider, type LoadedInterstitial } from './provider';

/** How long the summary gives the ad to load before the user can leave without one. */
const LOAD_TIMEOUT_MS = 12_000;

/**
 * AdService (client) for the one post-workout ad. Runs only once the workout is committed and its
 * summary is on screen, so nothing about the workout ever depends on it:
 *
 *   summary shown → (Free only) ask the server's AdEligibilityService → load quietly in the background
 *   → the user taps Done → if the ad is ready it shows, then Home; in every other case, straight Home.
 *
 * Pro users never reach the server or the SDK. An ad that fails at any step is reported and
 * forgotten — the user continues as if there had never been an ad.
 */
export function usePostWorkoutAd(workoutId: string | null, provider: InterstitialAdProvider = networkAdProvider) {
  const { authed } = useAuth();
  const entitlements = useEntitlements();
  const isPro = hasFeature(entitlements.data, 'AD_FREE');
  const [state, dispatch] = useReducer(postWorkoutAdReducer, initialPostWorkoutAd);
  const loaded = useRef<LoadedInterstitial | null>(null);
  const adId = useRef<string | null>(null);
  const reported = useRef(new Set<PostWorkoutAdEvent>());

  /** Fire-and-forget: an analytics/cap report that fails never affects the user. */
  const report = useCallback(
    (event: PostWorkoutAdEvent, reason?: string) => {
      const id = adId.current;
      if (!id || reported.current.has(event)) return;
      reported.current.add(event);
      authed((t) => api.postWorkoutAdEvent(t, id, event, reason)).catch(() => undefined);
    },
    [authed],
  );

  // Cancelled only by leaving the screen — never by a re-render (which would strand the flow mid-check).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Decide once per summary, after entitlements are known (Pro never makes a request).
  const started = useRef(false);
  useEffect(() => {
    if (!workoutId || started.current || entitlements.isPending) return;
    started.current = true;
    dispatch({ type: 'check' });
    if (isPro) return dispatch({ type: 'not_eligible', reason: 'pro_user' });
    if (!provider.availability().available) return dispatch({ type: 'not_configured' });

    void (async () => {
      const decision = await authed((t) => api.postWorkoutAd(t, workoutId)).catch(() => null);
      if (!alive.current) return;
      if (!decision) return dispatch({ type: 'not_eligible', reason: 'check_failed' });
      if (!decision.eligible) return dispatch({ type: 'not_eligible', reason: decision.reason });
      adId.current = decision.adId;
      dispatch({ type: 'eligible', adId: decision.adId });
      report('requested');
      try {
        const ad = await provider.load({ personalized: decision.personalized, timeoutMs: LOAD_TIMEOUT_MS });
        if (!alive.current) return ad.dispose();
        loaded.current = ad;
        report('loaded');
        dispatch({ type: 'loaded' });
      } catch (e) {
        if (!alive.current) return;
        const code = failureCode(e);
        report('failed', code);
        dispatch({ type: 'failed', reason: code });
      }
    })();
  }, [workoutId, entitlements.isPending, isPro, provider, authed, report]);

  // Leaving the summary without the ad (or unmounting) releases it.
  useEffect(
    () => () => {
      loaded.current?.dispose();
      loaded.current = null;
    },
    [],
  );

  const busy = useRef(false);
  /**
   * The user is done with the summary. Shows the ad if one is ready (and the user is still Free),
   * then calls `next`; otherwise calls `next` straight away. Never blocks and never throws.
   */
  const finish = useCallback(
    async (next: () => void) => {
      if (busy.current) return;
      busy.current = true;
      const ad = loaded.current;
      const phase: PostWorkoutAdPhase = state.phase;
      if (!ad || phase !== 'READY' || isPro) {
        // Still loading (or bought Pro meanwhile): leave now, and release the reservation.
        if (adId.current && (phase === 'LOADING' || phase === 'CHECKING' || (phase === 'READY' && isPro))) report('failed', isPro ? 'pro_user' : 'not_ready');
        loaded.current?.dispose();
        loaded.current = null;
        next();
        return;
      }
      dispatch({ type: 'show' });
      try {
        await ad.show({ onShown: () => report('shown') });
        report('dismissed');
        dispatch({ type: 'closed' });
      } catch (e) {
        const code = failureCode(e);
        report('failed', code);
        dispatch({ type: 'failed', reason: code });
      } finally {
        loaded.current = null;
        next();
      }
    },
    [state.phase, isPro, report],
  );

  return { phase: state.phase, adReady: state.phase === 'READY' && !isPro, finish };
}
