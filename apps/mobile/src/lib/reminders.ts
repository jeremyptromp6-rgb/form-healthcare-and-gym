import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { TodayKind, XpLedgerEntry } from './types';

/**
 * Local reminders: helpful, never spammy. Everything is scheduled on the phone (no push server), as
 * one-off notifications for the coming week that are re-planned whenever the app opens or what it
 * knows changes. That lets a reminder be skipped on a day the user has already trained, keeps
 * every day to at most two, and keeps them out of quiet hours. If the app isn't opened for a
 * week the reminders simply run out; nothing nags a lapsed user.
 */

export const CHANNEL_ID = 'reminders';
const ID_PREFIX = 'form.reminder.';

/** At most this many reminders on any one day. */
export const MAX_PER_DAY = 2;
/** Two reminders on the same day are at least this far apart. */
export const MIN_GAP_MINUTES = 60;
/** Nothing is delivered from the start of quiet hours until their end (22:00–08:00). */
export const QUIET_HOURS = { start: 22 * 60, end: 8 * 60 };
/** How many days ahead reminders are planned (today included). */
export const WINDOW_DAYS = 7;

const WEEKLY_AT = 18 * 60; // Sunday 18:00
const REST_AT = 10 * 60;
const PHOTO_AT = 10 * 60; // the 1st of the month

export type ReminderKind = 'workout' | 'streak' | 'weekly' | 'rest' | 'photo';
/** Where tapping a reminder goes. */
export type ReminderRoute = 'train' | 'streak' | 'progress' | 'bodyProgress';

export interface ReminderPrefs {
  /** Daily at `time` on the chosen days (0 = Monday … 6 = Sunday). */
  workout: { on: boolean; time: string; days: number[] };
  /** One evening nudge, only on a day with an active streak and no workout yet. */
  streak: { on: boolean; time: string };
  /** Sunday 18:00. */
  weekly: { on: boolean };
  /** A short note on a rest day. Off unless asked for. */
  rest: { on: boolean };
  /** The 1st of each month, 10:00: time for a progress photo. Off unless asked for. */
  photo: { on: boolean };
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_PREFS: ReminderPrefs = {
  workout: { on: false, time: '18:00', days: ALL_DAYS },
  streak: { on: false, time: '20:00' },
  weekly: { on: false },
  rest: { on: false },
  photo: { on: false },
};

export const anyReminderOn = (p: ReminderPrefs): boolean => p.workout.on || p.streak.on || p.weekly.on || p.rest.on || p.photo.on;

/** What the app knows when it plans: Home's numbers for the user's day and week. */
export interface ReminderContext {
  trainedToday: boolean;
  /** Current workout streak, in days. */
  streak: number;
  workoutsThisWeek: number;
  plannedDaysPerWeek: number | null;
  todayKind: TodayKind | null;
  /** XP earned so far this (Monday-first) week. */
  weekXp: number;
}

export interface PlannedReminder {
  /** Stable: planning the same thing twice replaces it instead of doubling it. */
  id: string;
  kind: ReminderKind;
  at: Date;
  title: string;
  body: string;
  route: ReminderRoute;
}

// ---------------------------------------------------------------------------------------------
// Times

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTime(hhmm: string, fallback: number): number {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

export function formatTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const inQuietHours = (minutes: number): boolean => minutes >= QUIET_HOURS.start || minutes < QUIET_HOURS.end;

/** A time inside quiet hours moves out of them: early morning to their end, late evening to the minute before they begin. */
export function outOfQuietHours(minutes: number): number {
  if (!inQuietHours(minutes)) return minutes;
  return minutes < QUIET_HOURS.end ? QUIET_HOURS.end : QUIET_HOURS.start - 1;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const atMinutes = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
const pad = (n: number) => String(n).padStart(2, '0');
/** The device-local calendar day as YYYY-MM-DD (notifications fire on the phone's clock). */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;

const idFor = (kind: ReminderKind, day: Date) => `${ID_PREFIX}${kind}.${dayKey(day)}`;

/** XP earned from this week's Monday on, from the recent ledger entries. */
export function weekXpFrom(events: readonly XpLedgerEntry[], now: Date): number {
  const monday = dayKey(addDays(startOfDay(now), -weekdayIndex(now)));
  return events.reduce((total, e) => (e.localDate !== null && e.localDate >= monday && e.xp > 0 ? total + e.xp : total), 0);
}

// ---------------------------------------------------------------------------------------------
// Planning (pure)

const PRIORITY: Record<ReminderKind, number> = { streak: 0, weekly: 1, photo: 2, workout: 3, rest: 4 };
const RESTING: readonly TodayKind[] = ['rest_suggested', 'recover', 'weekly_goal_met'];

function weeklyBody(workouts: number, xp: number): string {
  if (workouts <= 0) return 'A fresh week starts tomorrow — begin it with one workout.';
  return `Your week: ${workouts} workout${workouts === 1 ? '' : 's'}, ${xp} XP — see your progress`;
}

/** Everything that could be sent in the coming week, before the per-day limits. */
function candidates(prefs: ReminderPrefs, ctx: ReminderContext, now: Date): PlannedReminder[] {
  const today = startOfDay(now);
  const out: PlannedReminder[] = [];
  const resting = ctx.todayKind !== null && RESTING.includes(ctx.todayKind);
  // The weekly goal is met: no more training nudges for the rest of this Monday-first week.
  const goalMet = ctx.todayKind === 'weekly_goal_met' || (ctx.plannedDaysPerWeek !== null && ctx.plannedDaysPerWeek > 0 && ctx.workoutsThisWeek >= ctx.plannedDaysPerWeek);
  const daysLeftInWeek = 6 - weekdayIndex(today);

  for (let i = 0; i < WINDOW_DAYS; i++) {
    const day = addDays(today, i);
    const isToday = i === 0;

    if (prefs.workout.on && prefs.workout.days.includes(weekdayIndex(day))) {
      const skip = (isToday && (ctx.trainedToday || resting)) || (goalMet && i <= daysLeftInWeek);
      if (!skip) {
        const at = atMinutes(day, outOfQuietHours(parseTime(prefs.workout.time, 18 * 60)));
        out.push({ id: idFor('workout', day), kind: 'workout', at, title: 'Time to train', body: "Today's plan is ready.", route: 'train' });
      }
    }

    if (isToday && prefs.streak.on && ctx.streak >= 2 && !ctx.trainedToday && !resting) {
      const at = atMinutes(day, outOfQuietHours(parseTime(prefs.streak.time, 20 * 60)));
      out.push({ id: idFor('streak', day), kind: 'streak', at, title: `${ctx.streak}-day streak at risk`, body: 'A short session today keeps it going.', route: 'streak' });
    }

    if (prefs.weekly.on && weekdayIndex(day) === 6) {
      out.push({ id: idFor('weekly', day), kind: 'weekly', at: atMinutes(day, WEEKLY_AT), title: 'Your week in FORM', body: weeklyBody(ctx.workoutsThisWeek, ctx.weekXp), route: 'progress' });
    }

    if (prefs.photo.on && day.getDate() === 1) {
      out.push({ id: idFor('photo', day), kind: 'photo', at: atMinutes(day, PHOTO_AT), title: 'Monthly progress photo', body: 'Same spot, same light. Your photo stays on this phone.', route: 'bodyProgress' });
    }

    if (isToday && prefs.rest.on && ctx.todayKind !== null && (ctx.todayKind === 'rest_suggested' || ctx.todayKind === 'recover') && !ctx.trainedToday) {
      out.push({ id: idFor('rest', day), kind: 'rest', at: atMinutes(day, REST_AT), title: 'Rest day', body: 'Recovery is part of the plan. Take it easy today.', route: 'progress' });
    }
  }
  return out;
}

/**
 * The reminders to have scheduled right now: future ones only, at most two a day (most useful first),
 * never two within an hour of each other, none inside quiet hours.
 */
export function planReminders(prefs: ReminderPrefs, ctx: ReminderContext, now: Date = new Date()): PlannedReminder[] {
  const future = candidates(prefs, ctx, now)
    .filter((r) => r.at.getTime() > now.getTime() + 60_000)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  const kept: PlannedReminder[] = [];
  for (const r of future) {
    const sameDay = kept.filter((k) => dayKey(k.at) === dayKey(r.at));
    if (sameDay.length >= MAX_PER_DAY) continue;
    if (sameDay.some((k) => Math.abs(k.at.getTime() - r.at.getTime()) < MIN_GAP_MINUTES * 60_000)) continue;
    kept.push(r);
  }
  return kept.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ---------------------------------------------------------------------------------------------
// Deep links

const ROUTES: Record<ReminderRoute, string> = { train: '/train', streak: '/progress/streak', progress: '/progress', bodyProgress: '/progress/body-progress' };

/** Where a tapped reminder goes; null for anything that isn't one of ours. */
export function routeForReminder(data: unknown): string | null {
  const route = data && typeof data === 'object' ? (data as { route?: unknown }).route : null;
  return typeof route === 'string' && Object.hasOwn(ROUTES, route) ? ROUTES[route as ReminderRoute] : null;
}

// ---------------------------------------------------------------------------------------------
// Saved choices (on this phone only)

const PREFS_KEY = 'form.reminders.v1';
let cached: ReminderPrefs | null = null;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): ReminderPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ReminderPrefs, Record<string, unknown>>>;
  const time = (v: unknown, fallback: string) => (typeof v === 'string' && HHMM.test(v) ? v : fallback);
  const days = Array.isArray(r.workout?.days) ? (r.workout.days as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) : ALL_DAYS;
  return {
    workout: { on: r.workout?.on === true, time: time(r.workout?.time, DEFAULT_PREFS.workout.time), days },
    streak: { on: r.streak?.on === true, time: time(r.streak?.time, DEFAULT_PREFS.streak.time) },
    weekly: { on: r.weekly?.on === true },
    rest: { on: r.rest?.on === true },
    photo: { on: r.photo?.on === true },
  };
}

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  if (cached) return cached;
  try {
    const raw = await SecureStore.getItemAsync(PREFS_KEY);
    cached = raw ? sanitize(JSON.parse(raw)) : DEFAULT_PREFS;
  } catch {
    cached = DEFAULT_PREFS;
  }
  return cached;
}

export async function saveReminderPrefs(next: ReminderPrefs): Promise<void> {
  cached = next;
  listeners.forEach((l) => l());
  try {
    await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Not persisted (no secure store here): the choices still hold for this session.
  }
}

export function subscribeReminderPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Test hook: forget the in-memory copy. */
export function resetReminderPrefsCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------------------------
// Device: permission, channel, scheduling

export const remindersSupported = (): boolean => Platform.OS === 'android' || Platform.OS === 'ios';

export type ReminderPermission = 'granted' | 'undetermined' | 'blocked' | 'unsupported';

function toPermission(r: { granted: boolean; canAskAgain: boolean }): ReminderPermission {
  return r.granted ? 'granted' : r.canAskAgain ? 'undetermined' : 'blocked';
}

/** Does FORM currently have permission to notify? Never shows a prompt. */
export async function getReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported()) return 'unsupported';
  try {
    return toPermission(await Notifications.getPermissionsAsync());
  } catch {
    return 'unsupported';
  }
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  // Android 13+ only shows the permission dialog once a channel exists.
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Reminders', importance: Notifications.AndroidImportance.DEFAULT, enableVibrate: false });
}

/** Asks the system for permission (Android 13+: POST_NOTIFICATIONS). Call only when the user turns a reminder on. */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!remindersSupported()) return 'unsupported';
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) return 'blocked';
    const asked = await Notifications.requestPermissionsAsync();
    return toPermission(asked);
  } catch {
    return 'unsupported';
  }
}

/** Banner, no sound or badge, while the app is open. Safe to call more than once. */
export function configureReminders(): void {
  if (!remindersSupported()) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  } catch {
    // Notifications are unavailable on this device: reminders just don't happen.
  }
}

let queue: Promise<unknown> = Promise.resolve();
/** Scheduling changes run one at a time, so two quick re-plans can't interleave. */
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

async function cancelOurs(keep: ReadonlySet<string> = new Set()): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter((n) => n.identifier.startsWith(ID_PREFIX) && !keep.has(n.identifier)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/** Removes every FORM reminder (turned off, signed out, or permission gone). */
export function cancelAllReminders(): Promise<void> {
  if (!remindersSupported()) return Promise.resolve();
  return serial(() => cancelOurs()).catch(() => undefined);
}

/**
 * Makes the phone's scheduled reminders match the plan. Without permission nothing is scheduled.
 * Returns what was scheduled (empty when off or not allowed).
 */
export function syncReminders(prefs: ReminderPrefs, ctx: ReminderContext, now: Date = new Date()): Promise<PlannedReminder[]> {
  if (!remindersSupported()) return Promise.resolve([]);
  return serial(async () => {
    if (!anyReminderOn(prefs) || (await getReminderPermission()) !== 'granted') {
      await cancelOurs();
      return [];
    }
    await ensureChannel();
    const plan = planReminders(prefs, ctx, now);
    // Stable ids: re-scheduling an id replaces it, so only the ones no longer wanted need cancelling.
    await cancelOurs(new Set(plan.map((p) => p.id)));
    for (const p of plan) {
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: { title: p.title, body: p.body, data: { route: p.route } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.at, channelId: CHANNEL_ID },
      });
    }
    return plan;
  }).catch(() => []);
}

/** A workout was just completed: today's training and streak nudges are no longer wanted. */
export function onWorkoutCompleted(now: Date = new Date()): Promise<void> {
  if (!remindersSupported()) return Promise.resolve();
  const today = startOfDay(now);
  return serial(async () => {
    await Promise.all((['workout', 'streak', 'rest'] as const).map((k) => Notifications.cancelScheduledNotificationAsync(idFor(k, today))));
  }).catch(() => undefined);
}
