import { addDays, dayNumber } from "../shared/dates";

/**
 * Seasons.
 *
 * The year is split into four calendar quarters. A season is a fresh chapter for the streak screen:
 * its reward track counts the pain-free training days inside it. Everything is derived from the
 * workout history (never stored), so a reward cannot be granted by anything but real, counted
 * workouts, and it never touches XP. Rewards are cosmetic chests only.
 */

/** Training days in a season at which a chest opens. */
export const SEASON_MILESTONES = [7, 20, 40, 60] as const;

export interface Season {
  /** e.g. "2026-Q4". */
  id: string;
  year: number;
  /** 1 to 4. */
  quarter: 1 | 2 | 3 | 4;
  /** First day (a date key). */
  start: string;
  /** Last day (a date key), inclusive. */
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar-quarter season that contains `dateKey`. */
export function seasonOf(dateKey: string): Season {
  dayNumber(dateKey); // validates
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const quarter = (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const start = `${year}-${pad((quarter - 1) * 3 + 1)}-01`;
  const nextStart = quarter === 4 ? `${year + 1}-01-01` : `${year}-${pad(quarter * 3 + 1)}-01`;
  return { id: `${year}-Q${quarter}`, year, quarter, start, end: addDays(nextStart, -1) };
}

/** Whole days from `today` to the last day of its season (0 on the last day). */
export function daysLeftInSeason(today: string): number {
  return dayNumber(seasonOf(today).end) - dayNumber(today);
}

/** The first day of each of the season's three months. */
export function seasonMonths(season: Season): [string, string, string] {
  const m = (n: number) => `${season.year}-${pad((season.quarter - 1) * 3 + n)}-01`;
  return [m(1), m(2), m(3)];
}

export interface CountedWorkout {
  localDate: string;
  painLevel: "none" | "mild" | "serious" | string;
}

/**
 * Distinct days in `season` (up to `today`) with a counted workout, ascending. A workout with
 * serious pain is not a counted day, the same rule as the streak engine.
 */
export function seasonTrainingDays(workouts: readonly CountedWorkout[], season: Season, today: string): string[] {
  const last = dayNumber(today) < dayNumber(season.end) ? today : season.end;
  const days = new Set<string>();
  for (const w of workouts) {
    if (w.painLevel === "serious") continue;
    if (w.localDate >= season.start && w.localDate <= last) days.add(w.localDate);
  }
  return [...days].sort();
}

export interface SeasonMilestone {
  /** Training days needed. */
  at: number;
  reached: boolean;
}

export interface SeasonProgress {
  season: Season;
  /** Counted training days so far this season. */
  days: number;
  daysLeft: number;
  milestones: SeasonMilestone[];
  /** The next chest, with the days still to go. Null once every chest is open. */
  next: { at: number; remaining: number } | null;
  /** 0 to 1 toward the next chest, counted from the previous one. 1 once every chest is open. */
  fractionToNext: number;
}

export function seasonProgress(workouts: readonly CountedWorkout[], today: string): SeasonProgress {
  const season = seasonOf(today);
  const days = seasonTrainingDays(workouts, season, today).length;
  const milestones = SEASON_MILESTONES.map((at) => ({ at, reached: days >= at }));
  const nextAt = SEASON_MILESTONES.find((at) => days < at) ?? null;
  const prevAt = [...SEASON_MILESTONES].reverse().find((at) => days >= at) ?? 0;
  return {
    season,
    days,
    daysLeft: daysLeftInSeason(today),
    milestones,
    next: nextAt === null ? null : { at: nextAt, remaining: nextAt - days },
    fractionToNext: nextAt === null ? 1 : (days - prevAt) / (nextAt - prevAt),
  };
}

/**
 * A month as Monday-first weeks of date keys; days outside the month are null. `monthStart` is the
 * first day of the month.
 */
export function monthGrid(monthStart: string): (string | null)[][] {
  const first = `${monthStart.slice(0, 7)}-01`;
  const month = first.slice(5, 7);
  const lead = (dayNumber(first) + 3) % 7; // 1970-01-01 was a Thursday, so Monday = 0
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d.slice(5, 7) === month; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
