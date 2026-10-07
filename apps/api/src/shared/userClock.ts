import { dayNumber, localDateIn, localHourIn, weekStart, type DateKey } from "@form/domain";
import { HttpError } from "../http/errors";
import type { AppContext } from "./context";
import { assertPlausibleLocalDate, utcDateKey } from "./dates";

export interface UserClock {
  today: DateKey;
  weekStart: DateKey;
  hour: number;
  timezone: string;
  /** "stored": from the user's saved time zone (authoritative). "client"/"utc": fallbacks before one is saved. */
  source: "stored" | "client" | "utc";
}

/**
 * The user's "today". Once the user's time zone is stored, the server decides the date — the
 * client can't pick one. Before that, a client-supplied date is accepted only if it is a
 * plausible local date right now (within ±1 day of UTC).
 */
export function userClock(ctx: AppContext, userId: string, clientToday?: string): UserClock {
  const now = ctx.now();
  const row = ctx.db.prepare("SELECT timezone FROM user_settings WHERE user_id = ?").get(userId) as { timezone: string | null } | undefined;
  if (row?.timezone) {
    const today = localDateIn(row.timezone, now);
    return { today, weekStart: weekStart(today), hour: localHourIn(row.timezone, now), timezone: row.timezone, source: "stored" };
  }
  if (clientToday) {
    assertPlausibleLocalDate(clientToday, now);
    return { today: clientToday, weekStart: weekStart(clientToday), hour: now.getUTCHours(), timezone: "UTC", source: "client" };
  }
  const today = utcDateKey(now);
  return { today, weekStart: weekStart(today), hour: now.getUTCHours(), timezone: "UTC", source: "utc" };
}

/**
 * Checks a date the client sends for a new entry (a workout, a weight, water). Once the user's
 * time zone is stored, it is judged against *their* today: never in the future, and at most
 * `maxPastDays` back — with one extra day so a request queued just before midnight still lands
 * when it syncs just after. Before a zone is stored, the generic plausibility check applies.
 */
export function assertEntryDate(ctx: AppContext, userId: string, localDate: string, maxPastDays = 0): void {
  const clock = userClock(ctx, userId);
  if (clock.source !== "stored") return assertPlausibleLocalDate(localDate, ctx.now(), maxPastDays);
  const d = dayNumber(localDate);
  const today = dayNumber(clock.today);
  if (d > today || d < today - Math.max(1, maxPastDays)) {
    throw new HttpError(422, "implausible_date", "Date is outside the allowed range", { localDate, today: clock.today });
  }
}
