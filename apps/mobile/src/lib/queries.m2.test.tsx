import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import { qk, usePlanAction } from './queries';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('./config', () => ({ ...jest.requireActual('./config'), config: { ...jest.requireActual('./config').config, apiUrl: 'http://api.test', requestTimeoutMs: 5000 } }));
jest.mock('./auth', () => ({ useAuth: () => ({ token: 'tok', authed: (fn: (t: string) => Promise<unknown>) => fn('tok') }) }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

const eaten = { kind: 'eaten', planId: 'p1', mealId: 'm1', clientLogId: 'l1' } as const;

describe('marking a meal eaten that has turned unsafe', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refetches the meal plan on meal_unsuitable, so the unsafe flag shows at once', async () => {
    jest.spyOn(api, 'planAction').mockRejectedValue(new ApiError('validation', 'meal_unsuitable', 'Contains eggs', 422, false, { mealId: 'm1', reason: 'Contains eggs' }));
    const { client, wrapper } = setup();
    client.setQueryData(qk.plan, { plan: { seeded: true } });
    const { result } = await renderHook(() => usePlanAction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(eaten).catch(() => undefined);
    });
    expect(client.getQueryState(qk.plan)!.isInvalidated).toBe(true);
  });

  it('leaves the plan alone for other failures', async () => {
    jest.spyOn(api, 'planAction').mockRejectedValue(new ApiError('network', 'network', 'offline', null, true));
    const { client, wrapper } = setup();
    client.setQueryData(qk.plan, { plan: { seeded: true } });
    const { result } = await renderHook(() => usePlanAction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(eaten).catch(() => undefined);
    });
    expect(client.getQueryState(qk.plan)!.isInvalidated).toBe(false);
  });
});

describe('Train history covers a whole week', () => {
  afterEach(() => jest.restoreAllMocks());

  it('asks for 50 workouts (the API has no date range; 100 is its cap), not 10', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"workouts":[]}', json: async () => ({ workouts: [] }) });
    const original = global.fetch;
    global.fetch = fetchMock as never;
    try {
      await api.workouts('tok');
    } finally {
      global.fetch = original;
    }
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://api.test/workouts?limit=100');
  });
});
