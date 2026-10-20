import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { aggregateRecord, getGrantedPermissions, getSdkStatus, requestPermission } from 'react-native-health-connect';
import { api } from './api';
import { useSteps } from './useSteps';

jest.mock('expo-router', () => {
  const { useEffect: useMockEffect } = jest.requireActual('react');
  return { useFocusEffect: (cb: () => void) => useMockEffect(cb, [cb]) };
});
jest.mock('./auth', () => ({ useAuth: () => ({ token: 'tok', authed: (fn: (t: string) => Promise<unknown>) => fn('tok') }) }));

const mockStatus = getSdkStatus as jest.Mock;
const mockGranted = getGrantedPermissions as jest.Mock;
const mockRequest = requestPermission as jest.Mock;
const mockAggregate = aggregateRecord as jest.Mock;
const READ_STEPS = { accessType: 'read', recordType: 'Steps' };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper };
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(api, 'steps').mockResolvedValue({ goal: 8000, days: [{ date: '2026-10-19', steps: 4000, xp: 4 }, { date: '2026-10-20', steps: 8000, xp: 8 }] });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  mockStatus.mockResolvedValue(1);
  mockGranted.mockResolvedValue([]);
  mockRequest.mockResolvedValue([]);
  mockAggregate.mockResolvedValue({ COUNT_TOTAL: 0 });
});

describe('useSteps', () => {
  it('stays unavailable off Android', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const { wrapper } = setup();
    const { result } = await renderHook(() => useSteps(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('unavailable'));
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it('asks for permission only from the button, then reads and syncs the day totals', async () => {
    mockStatus.mockResolvedValue(3);
    mockGranted.mockResolvedValue([]);
    const post = jest.spyOn(api, 'postSteps').mockResolvedValue({ localDate: '2026-10-20', steps: 6500, xp: 6, goal: 8000 });
    mockAggregate.mockResolvedValue({ COUNT_TOTAL: 6500 });
    const { wrapper } = setup();
    const { result } = await renderHook(() => useSteps(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('needs_permission'));
    expect(mockRequest).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();

    mockRequest.mockResolvedValue([READ_STEPS]);
    mockGranted.mockResolvedValue([READ_STEPS]);
    await act(async () => result.current.onConnect());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockRequest).toHaveBeenCalledWith([READ_STEPS]);
    expect(result.current.today).toBe(6500);
    expect(result.current.xpToday).toBe(6);
    await waitFor(() => expect(result.current.weekAverage).toBe(6000));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(post).toHaveBeenCalledWith('tok', expect.objectContaining({ steps: 6500 }));
  });

  it('explains a refusal and offers Health Connect settings', async () => {
    mockStatus.mockResolvedValue(3);
    mockGranted.mockResolvedValue([]);
    mockRequest.mockResolvedValue([]);
    const { wrapper } = setup();
    const { result } = await renderHook(() => useSteps(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('needs_permission'));
    await act(async () => result.current.onConnect());
    await waitFor(() => expect(result.current.status).toBe('denied'));
  });

  it('reports when Health Connect has to be installed', async () => {
    mockStatus.mockResolvedValue(2);
    const { wrapper } = setup();
    const { result } = await renderHook(() => useSteps(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('needs_install'));
  });
});
