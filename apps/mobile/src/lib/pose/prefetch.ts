import { useEffect } from 'react';
import { config } from '@/lib/config';
import { FormPoseCameraModule } from '../../../modules/form-pose-camera';
import { nativeCameraFailedOnThisBuild } from './nativeFallback';
import { nativePoseAvailable } from './nativePose';

/** Wait this long after the Train tab or a workout opens before downloading: the screen's own requests go first. */
export const PREFETCH_DELAY_MS = 3000;
/** A failed prefetch (offline, a stalled download) is tried again on a later call, but not sooner than this. */
export const PREFETCH_RETRY_MS = 60_000;

let inFlight: Promise<boolean> | null = null;
let done = false;
let failedAt = 0;

/** Forgets what happened so far (tests only). */
export function resetPoseModelPrefetch(): void {
  inFlight = null;
  done = false;
  failedAt = 0;
}

/**
 * Downloads the native pose model ahead of the first camera open, so "Turn on camera" finds it on disk.
 * Android native engine only (the WebView engine has nothing to fetch outside its page). Safe to call as
 * often as you like: one download at a time, nothing once it succeeded, a pause after a failure. Resolves
 * true when the model is on disk, false when nothing was done or it failed; never rejects.
 */
export function prefetchPoseModels(): Promise<boolean> {
  if (done) return Promise.resolve(true);
  if (inFlight) return inFlight;
  const mod = FormPoseCameraModule;
  // No module, a build that predates the function, switched off, or the native camera already failed here
  // (the WebView engine runs instead): nothing to prefetch.
  if (!mod || typeof mod.prefetchModels !== 'function' || !nativePoseAvailable() || nativeCameraFailedOnThisBuild()) return Promise.resolve(false);
  if (failedAt !== 0 && Date.now() - failedAt < PREFETCH_RETRY_MS) return Promise.resolve(false);
  const run = (async () => {
    try {
      return (await mod.prefetchModels!(config.poseModelUrl, config.poseLiteModelUrl)) === true;
    } catch {
      return false;
    }
  })().then((ok) => {
    inFlight = null;
    if (ok) done = true;
    else failedAt = Date.now();
    return ok;
  });
  inFlight = run;
  return run;
}

/** Prefetches the pose model shortly after the screen opens (not at app launch). Does nothing on other engines. */
export function usePrefetchPoseModels(): void {
  useEffect(() => {
    const t = setTimeout(() => void prefetchPoseModels(), PREFETCH_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
}
