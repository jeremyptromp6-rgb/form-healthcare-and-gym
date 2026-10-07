import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';
import { ApiError } from './api';

/** Retry only failures that can plausibly succeed on retry (network, 5xx, rate limit), at most twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  return error instanceof ApiError && (error.kind === 'network' || error.retryable);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}

/** On native, treat the app coming to the foreground as "window focus" so stale data refreshes. */
export function bindAppFocus(): () => void {
  if (Platform.OS === 'web') return () => {};
  const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
  return () => sub.remove();
}
