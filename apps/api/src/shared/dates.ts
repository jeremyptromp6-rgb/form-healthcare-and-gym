import { dayNumber } from "@form/domain";
import { z } from "zod";
import { HttpError } from "../http/errors";

export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Server's UTC calendar date. */
export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Clients send their local calendar date. Time zones span UTC-12 to UTC+14, so a
 * genuine local date is within one day of the server's UTC date. `maxPastDays` lets
 * some endpoints accept back-dated entries (e.g. a forgotten meal).
 */
export function assertPlausibleLocalDate(localDate: string, now: Date, maxPastDays = 0): void {
  const utcToday = dayNumber(utcDateKey(now));
  const d = dayNumber(localDate);
  if (d > utcToday + 1 || d < utcToday - 1 - maxPastDays) {
    throw new HttpError(422, "implausible_date", "Date is outside the allowed range", { localDate });
  }
}
