import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { setUserTimeZone } from './dates';
import { purgeLocalExports } from './privateFiles';
import { tokenStore } from './tokenStore';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  token: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Revokes the session on every device, then signs out here. */
  signOutEverywhere: () => Promise<void>;
  /** Changes the password; other devices are signed out and this one keeps a fresh session. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Wraps an authenticated call; an expired or revoked session signs the user out. */
  authed: <T>(fn: (token: string) => Promise<T>) => Promise<T>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('loading');
  const [token, setToken] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    await tokenStore.clear();
    // Drop every cached response so the next person on this device sees none of this user's data.
    queryClient.clear();
    setUserTimeZone(null);
    // And any data export a crash left behind.
    purgeLocalExports();
    setToken(null);
    setStatus('signedOut');
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A keystore that fails to read (corrupt entry, locked keychain) counts as signed out, and
      // must never leave the startup skeleton up forever.
      let saved: string | null = null;
      try {
        saved = await tokenStore.get();
      } catch (e) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[auth] could not read the saved session', e);
        try {
          await tokenStore.clear();
        } catch {
          // best effort
        }
      }
      if (cancelled) return;
      if (!saved) return setStatus('signedOut');
      // Go straight in: the root waits on useMe, and `authed` signs out on a 401. A sleeping server
      // must not hold the app behind a second, silent bootstrap request.
      setToken(saved);
      setStatus('signedIn');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback(
    async (res: { token: string }) => {
      queryClient.clear();
      await tokenStore.set(res.token);
      setToken(res.token);
      setStatus('signedIn');
    },
    [queryClient],
  );

  const authed = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
      if (!token) throw new ApiError('unauthorized', 'unauthorized', 'Sign in required', 401, false);
      try {
        return await fn(token);
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'unauthorized') await signOut();
        throw e;
      }
    },
    [token, signOut],
  );

  const value = useMemo<AuthValue>(
    () => ({
      status,
      token,
      signIn: async (e, p) => accept(await api.login(e, p)),
      register: async (e, p) => accept(await api.register(e, p)),
      signOut,
      signOutEverywhere: async () => {
        await authed((t) => api.logoutAll(t));
        await signOut();
      },
      changePassword: async (current, next) => {
        const res = await authed((t) => api.changePassword(t, current, next));
        await tokenStore.set(res.token);
        setToken(res.token);
      },
      authed,
    }),
    [status, token, accept, signOut, authed],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
