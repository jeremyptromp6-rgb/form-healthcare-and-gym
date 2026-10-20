import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './auth';
import { useHome, useXpEvents } from './queries';
import { cancelAllReminders, configureReminders, getReminderPermission, loadReminderPrefs, requestReminderPermission, routeForReminder, saveReminderPrefs, subscribeReminderPrefs, syncReminders, weekXpFrom, type ReminderContext, type ReminderPermission, type ReminderPrefs } from './reminders';

/** The saved reminder choices, kept in step across every screen that reads them. `null` until loaded. */
export function useReminderPrefs(): { prefs: ReminderPrefs | null; save: (next: ReminderPrefs) => Promise<void> } {
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void loadReminderPrefs().then((p) => alive && setPrefs(p));
    refresh();
    const unsubscribe = subscribeReminderPrefs(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { prefs, save: saveReminderPrefs };
}

/** The device's notification permission, re-read whenever the app comes back to the foreground (e.g. from system settings). */
export function useReminderPermission(): { permission: ReminderPermission | null; request: () => Promise<ReminderPermission> } {
  const [permission, setPermission] = useState<ReminderPermission | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => void getReminderPermission().then((p) => alive && setPermission(p));
    read();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && read());
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const request = useCallback(async () => {
    const result = await requestReminderPermission();
    setPermission(result);
    return result;
  }, []);
  return { permission, request };
}

let lastHandledTap: string | null = null;

/**
 * Mounted once at the root. When signed in it keeps the phone's reminders matching the user's
 * choices and Home's numbers (re-planned on open, on foreground and whenever they change), opens the
 * right screen when a reminder is tapped, and clears every reminder on sign-out.
 * `ready` is true once the main navigator is on screen.
 */
export function useReminders(ready: boolean): void {
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const home = useHome();
  const xp = useXpEvents();
  const { prefs } = useReminderPrefs();
  const [foregrounds, setForegrounds] = useState(0);
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    configureReminders();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setForegrounds((n) => n + 1));
    return () => sub.remove();
  }, []);

  // Sign-out ends reminders for this phone; the next sign-in re-plans them.
  useEffect(() => {
    if (status === 'signedOut') void cancelAllReminders();
  }, [status]);

  // Re-plan. Held until Home's numbers are known: a wrong guess ("not trained yet") could send a needless nudge.
  const today = home.data?.today ?? null;
  const progression = home.data?.progression ?? null;
  const ctx: ReminderContext | null = today
    ? {
        trainedToday: today.trainedToday,
        streak: progression?.streak.current ?? 0,
        workoutsThisWeek: today.workoutsThisWeek,
        plannedDaysPerWeek: today.plannedDaysPerWeek,
        todayKind: today.suggestion.kind,
        weekXp: weekXpFrom(xp.data?.events ?? [], new Date()),
      }
    : null;
  const ctxKey = ctx ? JSON.stringify(ctx) : null;
  const prefsKey = prefs ? JSON.stringify(prefs) : null;
  useEffect(() => {
    if (!signedIn || !ready || !prefs || !ctx) return;
    void syncReminders(prefs, ctx);
    // prefs/ctx are covered by their keys, so an unrelated re-render doesn't re-plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, ready, prefsKey, ctxKey, foregrounds, home.data?.date]);

  // A tapped reminder opens its screen.
  useEffect(() => {
    if (!ready || !signedIn || !lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const href = routeForReminder(lastResponse.notification.request.content.data);
    if (!href) return;
    const key = `${lastResponse.notification.request.identifier}:${lastResponse.notification.date}`;
    // After the navigator has mounted (a cold start lands here in the same commit).
    const t = setTimeout(() => {
      if (lastHandledTap === key) return;
      lastHandledTap = key;
      router.push(href as Href);
    }, 0);
    return () => clearTimeout(t);
  }, [ready, signedIn, lastResponse]);
}
