import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from '@/lib/api';
import { tokenStore } from '@/lib/tokenStore';

const KEY = 'form.nativeCamera.failed';

/** The installed build: a new build gets one fresh native attempt (CI sets android.versionCode per run). */
function buildId(): string {
  const c = Constants.expoConfig;
  return `${c?.version ?? 'unknown'}+${c?.android?.versionCode ?? 'unknown'}`;
}

/**
 * Did the native camera already fail on this build? Then the WebView engine starts directly, so the
 * model is not downloaded twice and the screen never flips engines mid-start. Read synchronously; any
 * storage problem means "no".
 */
export function nativeCameraFailedOnThisBuild(): boolean {
  try {
    const raw = SecureStore.getItem(KEY);
    if (!raw) return false;
    return (JSON.parse(raw) as { build?: string }).build === buildId();
  } catch {
    return false;
  }
}

/**
 * Sends the operator one short anonymous line on why the native camera handed over (reason, build,
 * Android version, phone model; no user data, no images). Fire-and-forget: a missing session, no
 * connection or any error is ignored.
 */
export function reportNativeCameraFailure(reason: string): void {
  if (Platform.OS !== 'android') return;
  (async () => {
    const token = await tokenStore.get();
    if (!token) return;
    const c = Platform.constants;
    const device = [c.Brand, c.Model].filter(Boolean).join(' ') || 'unknown';
    await api.reportCameraFailure(token, { reason: reason.slice(0, 200), build: buildId(), os: `Android ${Platform.Version}`, device: device.slice(0, 60), engine: 'native' });
  })().catch(() => undefined);
}

/** Remembers that the native camera failed on this build (reason: fatal:<message> | no_live | no_frame_after_ready). Never shown. */
export function recordNativeCameraFailure(reason: string): void {
  try {
    SecureStore.setItem(KEY, JSON.stringify({ build: buildId(), reason: reason.slice(0, 200), at: Date.now() }));
  } catch {
    // Not saved: the next start tries the native camera again, which is a fine fallback.
  }
}
