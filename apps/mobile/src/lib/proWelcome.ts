import { useQuery } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from './api';
import { useAuth } from './auth';
import { purchaseSupport, useBillingCatalog } from './pro';
import { qk, useActiveSession, useCelebrations, useEntitlements, useMe } from './queries';
import type { BillingCatalog, WorkoutSummary } from './types';

/** The offer waits until the user has finished this many workouts: they get to see what Free gives them first. */
export const PRO_OFFER_AFTER_WORKOUTS = 3;
/** The offer waits until the user is back in a rhythm: their latest workout is at most this many days old. */
export const PRO_OFFER_RECENT_DAYS = 7;

export function trainedRecently(latestLocalDate: string | undefined, now: Date): boolean {
  if (!latestLocalDate) return false;
  const days = (now.getTime() - new Date(`${latestLocalDate}T12:00:00`).getTime()) / 86_400_000;
  return days <= PRO_OFFER_RECENT_DAYS;
}

/**
 * The FORM Pro welcome: shown once, the first time a free user is on Home after finishing their third workout.
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
 * may take over Home: the account must have finished onboarding and at least PRO_OFFER_AFTER_WORKOUTS
 * workouts, be on the free plan, Home must be the screen in front, no workout may be open, and no
 * celebration may be waiting. The workout count is only fetched once everything else is in order. If prices
 * can't be loaded it stays away (and tries again next time) rather than show a plan with no price.
 * It also stays away while Pro can't be bought (no store connected: "coming soon"), so it never
 * offers plans that don't exist.
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
  const { authed, token } = useAuth();

  useEffect(() => {
    if (!userId) return;
    let live = true;
    readProWelcomeSeen(userId).then((v) => live && setSeen(v));
    return () => {
      live = false;
    };
  }, [userId]);

  const ready =
    !!userId &&
    seen === false &&
    !closed &&
    focused &&
    !!me.data?.onboarding.completed &&
    entitlements.data?.tier === 'free' &&
    !!catalog.data &&
    purchaseSupport(catalog.data).available &&
    catalog.data.products.some((p) => p.price) &&
    // Celebrations first: they are earned moments, the offer can wait. If the feed can't load, don't hold the offer back.
    (celebrations.isError || (celebrations.isSuccess && celebrations.data.celebrations.length === 0)) &&
    // Never over a workout: wait until we know there isn't one open.
    session.isSuccess &&
    session.data === null;

  // Same query (and cache) as the workout history; only asked once the offer could otherwise show.
  const workouts = useQuery<{ workouts: WorkoutSummary[] }, ApiError>({ queryKey: qk.workouts, queryFn: () => authed(api.workouts), enabled: !!token && ready });
  // Only for someone training now: never the first thing a returning user sees after a break.
  const list = workouts.data?.workouts ?? [];
  const eligible = ready && list.length >= PRO_OFFER_AFTER_WORKOUTS && trainedRecently(list[0]?.localDate, new Date());

  // Latch: once it is on screen it stays until the user closes it, and the flag is written right away.
  if (eligible && !shown) setShown(true);
  useEffect(() => {
    if (shown && userId) void writeProWelcomeSeen(userId);
  }, [shown, userId]);

  const dismiss = useCallback(() => setClosed(true), []);
  return { visible: shown && !closed, catalog: catalog.data ?? null, dismiss };
}
