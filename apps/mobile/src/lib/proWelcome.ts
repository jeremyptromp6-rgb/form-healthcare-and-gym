import { useIsFocused } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { useBillingCatalog } from './pro';
import { useActiveSession, useCelebrations, useEntitlements, useMe } from './queries';
import type { BillingCatalog } from './types';

/**
 * The FORM Pro welcome: shown once, the first time a free user reaches Home after onboarding.
 * "Once" is per account on this device — a flag in the secure store, written the moment the sheet
 * appears, so closing the app mid-sheet never brings it back.
 */

const key = (userId: string) => `form.proWelcome.${userId}`;
// Where the secure store isn't there (web, a failing keystore) the flag lives for the session only: it still never repeats within a session.
const memory = new Set<string>();

export async function readProWelcomeSeen(userId: string): Promise<boolean> {
  if (memory.has(userId)) return true;
  try {
    return (await SecureStore.getItemAsync(key(userId))) === '1';
  } catch {
    return false;
  }
}

export async function writeProWelcomeSeen(userId: string): Promise<void> {
  memory.add(userId);
  try {
    await SecureStore.setItemAsync(key(userId), '1');
  } catch {
    // Not persisted: the in-memory flag above still holds for this session.
  }
}

/** Test hook: forget the in-session flags. */
export function resetProWelcomeMemory(): void {
  memory.clear();
}

/**
 * Whether the welcome should show now, and how to dismiss it. It waits for everything else that
 * may take over Home: the account must have finished onboarding and be on the free plan, Home must
 * be the screen in front, no workout may be open, and no celebration may be waiting. If prices
 * can't be loaded it stays away (and tries again next time) rather than show a plan with no price.
 */
export function useProWelcome(): { visible: boolean; catalog: BillingCatalog | null; dismiss: () => void } {
  const me = useMe();
  const entitlements = useEntitlements();
  const catalog = useBillingCatalog();
  const celebrations = useCelebrations();
  const session = useActiveSession();
  const focused = useIsFocused();
  const userId = me.data?.user.id ?? null;

  const [seen, setSeen] = useState<boolean | null>(null);
  const [shown, setShown] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    readProWelcomeSeen(userId).then((v) => live && setSeen(v));
    return () => {
      live = false;
    };
  }, [userId]);

  const eligible =
    !!userId &&
    seen === false &&
    !closed &&
    focused &&
    !!me.data?.onboarding.completed &&
    entitlements.data?.tier === 'free' &&
    !!catalog.data &&
    // Celebrations first: they are earned moments, the offer can wait. If the feed can't load, don't hold the offer back.
    (celebrations.isError || (celebrations.isSuccess && celebrations.data.celebrations.length === 0)) &&
    // Never over a workout: wait until we know there isn't one open.
    session.isSuccess &&
    session.data === null;

  // Latch: once it is on screen it stays until the user closes it, and the flag is written right away.
  if (eligible && !shown) setShown(true);
  useEffect(() => {
    if (shown && userId) void writeProWelcomeSeen(userId);
  }, [shown, userId]);

  const dismiss = useCallback(() => setClosed(true), []);
  return { visible: shown && !closed, catalog: catalog.data ?? null, dismiss };
}
