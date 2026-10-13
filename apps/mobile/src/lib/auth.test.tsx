import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import { AuthProvider, useAuth } from './auth';

const mockGet = jest.fn();
const mockClear = jest.fn();
const mockSet = jest.fn();

jest.mock('./tokenStore', () => ({
  tokenStore: { get: () => mockGet(), clear: () => mockClear(), set: (t: string) => mockSet(t) },
}));
jest.mock('./privateFiles', () => ({ purgeLocalExports: jest.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('AuthProvider startup', () => {
  let meSpy: jest.SpyInstance;
  beforeEach(() => {
    mockGet.mockReset();
    mockClear.mockReset().mockResolvedValue(undefined);
    mockSet.mockReset().mockResolvedValue(undefined);
    meSpy = jest.spyOn(api, 'me').mockImplementation(() => new Promise(() => {})); // a sleeping server: never answers
  });
  afterEach(() => meSpy.mockRestore());

  it('a saved token signs in at once; it does not wait on a server round trip', async () => {
    mockGet.mockResolvedValue('tok');
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    expect(result.current.token).toBe('tok');
    expect(meSpy).not.toHaveBeenCalled();
  });

  it('no saved token means signed out', async () => {
    mockGet.mockResolvedValue(null);
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
  });

  it('a token store that rejects counts as signed out instead of hanging, and the bad key is cleared', async () => {
    mockGet.mockRejectedValue(new Error('keystore unavailable'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    expect(mockClear).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('still signs out when clearing the broken key fails too', async () => {
    mockGet.mockRejectedValue(new Error('keystore unavailable'));
    mockClear.mockRejectedValue(new Error('still broken'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    warn.mockRestore();
  });

  it('an expired session found later (a 401 on an authed call) signs the user out', async () => {
    mockGet.mockResolvedValue('stale');
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signedIn'));
    await act(async () => {
      await result.current.authed(() => Promise.reject(new ApiError('unauthorized', 'unauthorized', 'nope', 401, false))).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.status).toBe('signedOut'));
    expect(mockClear).toHaveBeenCalled();
  });
});
