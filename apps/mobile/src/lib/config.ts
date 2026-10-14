/**
 * App configuration from EXPO_PUBLIC_* variables (inlined at build time — never put secrets here).
 * Web and the iOS simulator reach a dev API on localhost; Android emulators and devices need
 * EXPO_PUBLIC_API_URL set to the machine's LAN address.
 */

import { POSE_MODEL_URLS } from './pose/poseModels';

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

/**
 * The API address, or why there isn't one. A missing or unsafe address never crashes the app at
 * launch — the welcome page still works, and every request explains that this build has no server.
 */
export function apiSettings(raw: string | undefined, isDev: boolean): { apiUrl: string | null; apiProblem: string | null } {
  try {
    return { apiUrl: resolveApiUrl(raw, isDev), apiProblem: null };
  } catch (e) {
    return { apiUrl: null, apiProblem: e instanceof Error ? e.message : String(e) };
  }
}

export type AdsMode = 'test' | 'production' | 'off';
export interface AdsSettings {
  mode: AdsMode;
  /** Production interstitial unit ids (only read in production mode). Test mode uses Google's test ids. */
  interstitial: { android: string | null; ios: string | null };
}

/**
 * Free-tier ads (Prompt S). Development builds can only ever use Google's official test ads — a
 * production unit id is never used for testing. A release build serves ads only when explicitly
 * configured: EXPO_PUBLIC_ADS_MODE=test (test ads, for test builds) or =production together with
 * the production unit ids. Anything else is "off", and the app simply continues without an ad.
 */
export function adsSettings(env: { mode?: string; android?: string; ios?: string }, isDev: boolean): AdsSettings {
  const none = { android: null, ios: null };
  if (env.mode === 'off') return { mode: 'off', interstitial: none };
  if (isDev) return { mode: 'test', interstitial: none };
  if (env.mode === 'test') return { mode: 'test', interstitial: none };
  if (env.mode === 'production') return { mode: 'production', interstitial: { android: env.android || null, ios: env.ios || null } };
  return { mode: 'off', interstitial: none };
}

/**
 * Which pipeline built this app: CI sets EXPO_PUBLIC_BUILD_CHANNEL=preview on preview/** branches.
 * Anything else (including unset) is the main channel.
 */
export function resolveBuildChannel(raw: string | undefined): string {
  const value = raw?.trim();
  return value ? value : 'main';
}

/** Kill switch for the native Android pose camera: on unless EXPO_PUBLIC_POSE_NATIVE is 0/false/off. */
export function nativePoseEnabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return !(value === '0' || value === 'false' || value === 'off');
}

const buildChannel = resolveBuildChannel(process.env.EXPO_PUBLIC_BUILD_CHANNEL);

const api = apiSettings(process.env.EXPO_PUBLIC_API_URL, typeof __DEV__ === 'undefined' ? true : __DEV__);
if (api.apiProblem && typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`[config] ${api.apiProblem}`);

export const config = {
  apiUrl: api.apiUrl,
  /** Set when this build has no usable API address (e.g. a downloadable APK built without one). */
  apiProblem: api.apiProblem,
  requestTimeoutMs: 15_000,
  /** How long a read keeps retrying when it gets no response (a waking server, a blip). Off under Jest. */
  requestRetryMs: process.env.NODE_ENV === 'test' ? 0 : 30_000,
  /**
   * On-device pose model (MediaPipe Pose Landmarker full, ~9 MB, fetched once and cached by the
   * browser; frames never leave the device). Override with EXPO_PUBLIC_POSE_MODEL_URL to self-host.
   */
  poseModelUrl: process.env.EXPO_PUBLIC_POSE_MODEL_URL ?? POSE_MODEL_URLS.full,
  /**
   * The lite model (~5.5 MB) a slow device quietly falls back to. Override with
   * EXPO_PUBLIC_POSE_LITE_MODEL_URL. A self-hosted full model with no lite override means no fallback.
   */
  poseLiteModelUrl: (process.env.EXPO_PUBLIC_POSE_LITE_MODEL_URL ?? (process.env.EXPO_PUBLIC_POSE_MODEL_URL ? null : POSE_MODEL_URLS.lite)) as string | null,
  /** 'preview' for builds from preview/** branches, 'main' otherwise. */
  buildChannel,
  /** Camera diagnostics chip and feed stats: preview builds only, never shown in main builds. */
  diagnostics: buildChannel === 'preview',
  /** Use the native Android pose camera when the module is present. EXPO_PUBLIC_POSE_NATIVE=0 turns it off. */
  nativePose: nativePoseEnabled(process.env.EXPO_PUBLIC_POSE_NATIVE),
  /** Development only: a simulated kitchen scale (never real readings). No real scale integration exists yet. */
  simulatedScale: (typeof __DEV__ === 'undefined' ? true : __DEV__) && process.env.EXPO_PUBLIC_SIMULATED_SCALE === '1',
  ads: adsSettings(
    {
      mode: process.env.EXPO_PUBLIC_ADS_MODE,
      android: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID,
      ios: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS,
    },
    typeof __DEV__ === 'undefined' ? true : __DEV__,
  ),
} as const;

