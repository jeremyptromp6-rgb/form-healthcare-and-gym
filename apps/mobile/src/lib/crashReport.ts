import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { request } from './api';

/**
 * Reports an unexpected crash to FORM's own API (no third-party SDK). Fire-and-forget: reporting
 * must never cause a second failure. The server scrubs anything personal and only logs it.
 */
export function reportCrash(error: unknown): void {
  const e = error instanceof Error ? error : new Error(String(error));
  const route = Platform.OS === 'web' && typeof location !== 'undefined' ? location.pathname : undefined;
  request('/client-errors', {
    method: 'POST',
    timeoutMs: 5000,
    body: {
      name: e.name.slice(0, 80),
      message: e.message.slice(0, 1000),
      ...(e.stack ? { stack: e.stack.slice(0, 8000) } : {}),
      ...(route ? { route: route.slice(0, 200) } : {}),
      platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
      appVersion: Constants.expoConfig?.version ?? 'unknown',
    },
  }).catch(() => undefined);
}
