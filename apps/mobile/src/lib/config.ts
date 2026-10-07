/**
 * App configuration from EXPO_PUBLIC_* variables (inlined at build time — never put secrets here).
 * Web and the iOS simulator reach a dev API on localhost; Android emulators and devices need
 * EXPO_PUBLIC_API_URL set to the machine's LAN address.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

export function resolveApiUrl(raw: string | undefined, isDev: boolean): string {
  const value = (raw ?? 'http://localhost:4000').replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`EXPO_PUBLIC_API_URL is not a valid URL: ${value}`);
  }
  const local = LOCAL_HOSTS.has(url.hostname) || /^192\.168\.|^10\./.test(url.hostname);
  // Session tokens and health data must never travel over plain HTTP to a remote host.
  if (url.protocol !== 'https:' && !(isDev && local)) {
    throw new Error(`EXPO_PUBLIC_API_URL must use https outside local development: ${value}`);
  }
  return value;
}

export const config = {
  apiUrl: resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, typeof __DEV__ === 'undefined' ? true : __DEV__),
  requestTimeoutMs: 15_000,
  /**
   * On-device pose model (MediaPipe Pose Landmarker lite, ~5.5 MB, fetched once and cached by the
   * browser; frames never leave the device). Override with EXPO_PUBLIC_POSE_MODEL_URL to self-host.
   */
  poseModelUrl:
    process.env.EXPO_PUBLIC_POSE_MODEL_URL ?? 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  /** Development only: a simulated kitchen scale (never real readings). No real scale integration exists yet. */
  simulatedScale: (typeof __DEV__ === 'undefined' ? true : __DEV__) && process.env.EXPO_PUBLIC_SIMULATED_SCALE === '1',
} as const;

