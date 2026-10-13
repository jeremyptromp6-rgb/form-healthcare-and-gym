import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { api } from './api';
import { qk, SEARCH_DEBOUNCE_MS, useFoodSearch, usePatchPreferences, usePatchProfile } from './queries';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('./auth', () => ({ useAuth: () => ({ token: 'tok', authed: (fn: (t: string) => Promise<unknown>) => fn('tok') }) }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

/** Every key a diet or profile change can make stale. */
const SUITABILITY_KEYS = [
  ['recipes', '{"saved":true}'],
  ['recipe', 'red_lentil_soup'],
  ['meal-plan', 'current'],
  ['meal-plan', 'alternatives', 'meal1'],
  qk.grocery,
  qk.todayWorkout,
  ['workout', 'w1'],
] as const;

function seed(client: QueryClient) {
  for (const key of SUITABILITY_KEYS) client.setQueryData(key, { seeded: true });
  client.setQueryData(['achievements'], { seeded: true }); // not affected: must stay fresh
}
const isInvalidated = (client: QueryClient, key: readonly unknown[]) => client.getQueryState(key)!.isInvalidated;

describe('diet and profile changes refresh what depends on them', () => {
  afterEach(() => jest.restoreAllMocks());

  it('usePatchPreferences invalidates recipes, plan, alternatives, grocery and workouts', async () => {
    jest.spyOn(api, 'patchPreferences').mockResolvedValue({ preferences: {}, movedToAllergies: [], onboarding: {} } as never);
    const { client, wrapper } = setup();
    seed(client);
    const { result } = await renderHook(() => usePatchPreferences(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ allergies: ['peanut'] } as never);
    });
    for (const key of SUITABILITY_KEYS) expect(isInvalidated(client, key)).toBe(true);
    expect(isInvalidated(client, ['achievements'])).toBe(false);
  });

  it('usePatchProfile invalidates the same set', async () => {
    jest.spyOn(api, 'patchProfile').mockResolvedValue({ profile: {}, targets: null, onboarding: {}, personalization: {} } as never);
    const { client, wrapper } = setup();
    seed(client);
    const { result } = await renderHook(() => usePatchProfile(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ weightKg: 80 } as never);
    });
    for (const key of SUITABILITY_KEYS) expect(isInvalidated(client, key)).toBe(true);
    expect(isInvalidated(client, ['achievements'])).toBe(false);
  });
});

describe('useFoodSearch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sends one request after typing pauses, not one per keystroke', async () => {
    const search = jest.spyOn(api, 'searchFoods').mockResolvedValue({ query: '', foods: [] });
    const { wrapper } = setup();
    const { rerender } = await renderHook(({ q }: { q: string }) => useFoodSearch(q), { wrapper, initialProps: { q: '' } });
    for (const q of ['c', 'ch', 'chi', 'chic']) {
      await rerender({ q });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
    }
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('tok', 'chic');
  });
});
