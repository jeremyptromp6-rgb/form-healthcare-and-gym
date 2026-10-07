import { DomainValidationError } from "./errors";

/** Calendar day keys (YYYY-MM-DD) in the user's local time zone. */
export type DateKey = string;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  if (!DATE_KEY.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Days since the Unix epoch for a date key. Throws on malformed or impossible dates. */
export function dayNumber(dateKey: DateKey): number {
  if (!isDateKey(dateKey)) throw new DomainValidationError(`invalid date: ${dateKey}`, "date");
  return Math.round(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
}

export function addDays(dateKey: DateKey, days: number): DateKey {
  return new Date((dayNumber(dateKey) + days) * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return dayNumber(to) - dayNumber(from);
}

/** Monday of the week containing `dateKey` (weeks run Monday–Sunday). */
export function weekStart(dateKey: DateKey): DateKey {
  const n = dayNumber(dateKey);
  const weekday = (n + 3) % 7; // 1970-01-01 was a Thursday → Monday = 0
  return addDays(dateKey, -weekday);
}

// ---- Time zones --------------------------------------------------------------------

const zoneCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = zoneCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23", hour: "2-digit" });
    zoneCache.set(timeZone, f);
  }
  return f;
}

/** True for any IANA zone the runtime knows (e.g. "Europe/London", "Pacific/Kiritimati"). */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date at `instant` in `timeZone` — the authoritative "today" for a user.
 * Handles DST and zones up to UTC+14 / UTC−12 via the runtime's tz database.
 */
export function localDateIn(timeZone: string, instant: Date): DateKey {
  if (!isValidTimeZone(timeZone)) throw new DomainValidationError(`unknown time zone: ${timeZone}`, "timezone");
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Local hour (0–23) at `instant` in `timeZone`, for time-of-day greetings. */
export function localHourIn(timeZone: string, instant: Date): number {
  if (!isValidTimeZone(timeZone)) throw new DomainValidationError(`unknown time zone: ${timeZone}`, "timezone");
  return Number(formatterFor(timeZone).formatToParts(instant).find((p) => p.type === "hour")!.value);
}
