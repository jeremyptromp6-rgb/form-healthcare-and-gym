import { Linking, Platform } from 'react-native';
import { aggregateRecord, getGrantedPermissions, getSdkStatus, initialize, openHealthConnectSettings, requestPermission, SdkAvailabilityStatus } from 'react-native-health-connect';
import { localDateKey } from './dates';

/**
 * Daily steps from Android Health Connect. Health Connect already merges the phone and a smartwatch
 * without counting the same steps twice, so the app asks it for the day's total instead of reading
 * any sensor itself. Android only: on iOS and the web every call here says "unavailable".
 */

export const DEFAULT_STEP_GOAL = 8_000;

/** Where a user with no Health Connect app (Android 13 and older) can get it. */
export const HEALTH_CONNECT_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

export type StepsAvailability = 'unavailable' | 'needs_install' | 'available';

const READ_STEPS = { accessType: 'read', recordType: 'Steps' } as const;

const isAndroid = () => Platform.OS === 'android';

/** Is Health Connect usable here? Not on this platform or device → 'unavailable'; not installed or too old → 'needs_install'. */
export async function stepsAvailability(): Promise<StepsAvailability> {
  if (!isAndroid()) return 'unavailable';
  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs_install';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Does the app already have read access to steps? Never shows a prompt. */
export async function hasStepsPermission(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    if (!(await initialize())) return false;
    const granted = await getGrantedPermissions();
    return granted.some((p) => 'recordType' in p && p.recordType === 'Steps' && p.accessType === 'read');
  } catch {
    return false;
  }
}

/** Asks for read access to steps (the system dialog). Call only from a button press. */
export async function requestStepsPermission(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    if (!(await initialize())) return false;
    const granted = await requestPermission([READ_STEPS]);
    return granted.some((p) => 'recordType' in p && p.recordType === 'Steps' && p.accessType === 'read');
  } catch {
    return false;
  }
}

/** The device's local midnight that starts the day containing `d`. */
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** One local day's step total, or null if it can't be read. Today runs up to `now`; a past day to the next midnight. */
async function stepsBetween(start: Date, end: Date): Promise<number | null> {
  try {
    const res = await aggregateRecord({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() } });
    const n = Math.round(Number(res.COUNT_TOTAL));
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export interface DaySteps {
  /** Local date, YYYY-MM-DD. */
  localDate: string;
  steps: number;
}

/** Today's and yesterday's totals (either may be missing if it couldn't be read). */
export async function readRecentSteps(now: Date = new Date()): Promise<{ today: DaySteps | null; yesterday: DaySteps | null }> {
  const midnight = startOfDay(now);
  const yesterdayStart = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - 1);
  const [t, y] = await Promise.all([stepsBetween(midnight, now), stepsBetween(yesterdayStart, midnight)]);
  return {
    today: t === null ? null : { localDate: localDateKey(now), steps: t },
    yesterday: y === null ? null : { localDate: localDateKey(yesterdayStart), steps: y },
  };
}

export function openStepsInstall(): void {
  void Linking.openURL(HEALTH_CONNECT_PLAY_URL).catch(() => undefined);
}

/** Health Connect's own settings, where a user who said no can switch FORM's steps access back on. */
export function openStepsSettings(): void {
  try {
    openHealthConnectSettings();
  } catch {
    // Nothing to open on this device.
  }
}

/**
 * Sends day totals to the server a moment after the last change, one request per day whose total went up
 * (the server keeps the highest value, so a repeat or a lower number would change nothing). Fire and
 * forget: a failed send is forgotten so the next sync tries again.
 */
export function createStepsSyncer(initialSend: (day: DaySteps) => Promise<unknown> = () => Promise.resolve(), delayMs = 2_000) {
  let send = initialSend;
  const sent = new Map<string, number>();
  let pending: DaySteps[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const batch = pending;
    pending = [];
    for (const day of batch) {
      if (day.steps <= (sent.get(day.localDate) ?? -1)) continue;
      sent.set(day.localDate, day.steps);
      send(day).catch(() => {
        if (sent.get(day.localDate) === day.steps) sent.delete(day.localDate);
      });
    }
  };

  return {
    /** Swaps the sender (the signed-in session can change between syncs). */
    setSend(next: (day: DaySteps) => Promise<unknown>) {
      send = next;
    },
    schedule(days: DaySteps[]) {
      pending = [...pending.filter((p) => !days.some((d) => d.localDate === p.localDate)), ...days];
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
  };
}
