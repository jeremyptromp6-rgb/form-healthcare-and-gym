import { addDays, dayNumber, weekStart } from "../shared/dates";

/**
 * StreakEngine.
 *
 * Rest is part of training, so a streak survives rest days. Streaks are derived: always computed
 * from the authoritative activity dates (in the user's own time zone), never stored, so there is no
 * second source of truth to drift out of sync.
 *
 * - Workout streak: consecutive training days, where the rest a user's plan schedules never breaks
 *   it (3 days a week allows 2 rest days in a row; once a week allows 6). A workout with serious
 *   pain is not a streak day, and it plus the recovery days after it never break a streak — nobody
 *   should train hurt to protect a number.
 * - Nutrition streak: consecutive finished days on track with the calorie target (never below the
 *   safe minimum — that day isn't "on track").
 * - Quest streak: consecutive days with at least one daily quest completed.
 * - Weekly consistency: consecutive weeks (Mon–Sun) where the training plan was met.
 */

export const MAX_REST_DAYS = 2;
/** Days after a serious-pain workout that never break a workout streak. */
export const STREAK_RECOVERY_DAYS = 3;

/** The Streak model. */
export interface StreakState {
  /** Days in the current unbroken chain. */
  current: number;
  longest: number;
  activeToday: boolean;
  /**
   * Rest days still allowed, counting today if not yet active. 0 means today must be
   * active to keep the streak. Null when there is no live streak.
   */
  restDaysRemaining: number | null;
  /** First day of the current chain (null when there is none). Identifies the run for milestones. */
  startDate: string | null;
}

export interface DailyStreakOptions {
  /** Inactive days allowed between two active days. */
  maxGapDays: number;
  /** Days that neither count nor break the chain (e.g. recovery after reported pain). */
  excusedDates?: readonly string[];
}

const toKey = (n: number) => addDays("1970-01-01", n);

/** A chain of active days in which gaps of up to `maxGapDays` (not counting excused days) are allowed. */
export function dailyStreak(activeDates: readonly string[], today: string, opts: DailyStreakOptions): StreakState {
  const todayN = dayNumber(today);
  const days = [...new Set(activeDates.map(dayNumber))].filter((d) => d <= todayN).sort((a, b) => a - b);
  if (days.length === 0) return { current: 0, longest: 0, activeToday: false, restDaysRemaining: null, startDate: null };

  const excused = new Set((opts.excusedDates ?? []).map(dayNumber));
  const gapBetween = (from: number, to: number) => {
    let gap = 0;
    for (let d = from + 1; d < to; d++) if (!excused.has(d)) gap++;
    return gap;
  };

  let longest = 1;
  let run = 1;
  let runStart = days[0]!;
  for (let i = 1; i < days.length; i++) {
    if (gapBetween(days[i - 1]!, days[i]!) <= opts.maxGapDays) run++;
    else {
      run = 1;
      runStart = days[i]!;
    }
    longest = Math.max(longest, run);
  }

  const last = days[days.length - 1]!;
  const activeToday = last === todayN;
  // Inactive days since the last active day, excluding today (today is not over yet).
  const gapSoFar = gapBetween(last, todayN);
  const alive = activeToday || gapSoFar <= opts.maxGapDays;
  return {
    current: alive ? run : 0,
    longest,
    activeToday,
    restDaysRemaining: !alive ? null : activeToday ? opts.maxGapDays : opts.maxGapDays - gapSoFar,
    startDate: alive ? toKey(runStart) : null,
  };
}

/** The generic workout streak (no plan known): up to two rest days in a row. */
export function computeStreak(activeDates: string[], today: string): StreakState {
  return dailyStreak(activeDates, today, { maxGapDays: MAX_REST_DAYS });
}

/** Rest days in a row the user's plan schedules: 3 days a week → 2, twice a week → 3, once → 6. */
export function plannedRestDays(trainingDaysPerWeek: number | null): number {
  const n = Math.min(7, Math.max(1, trainingDaysPerWeek ?? 3));
  return Math.max(MAX_REST_DAYS, Math.ceil(7 / n) - 1);
}

export interface WorkoutStreakInput {
  workouts: readonly { localDate: string; painLevel: "none" | "mild" | "serious" | string }[];
  trainingDaysPerWeek: number | null;
}

/** Workout streak that respects the user's scheduled rest and recovery after reported pain. */
export function workoutStreak(input: WorkoutStreakInput, today: string): StreakState {
  const serious = new Set(input.workouts.filter((w) => w.painLevel === "serious").map((w) => w.localDate));
  const active = input.workouts.filter((w) => w.painLevel !== "serious").map((w) => w.localDate);
  const excused: string[] = [];
  for (const d of serious) for (let i = 0; i <= STREAK_RECOVERY_DAYS; i++) excused.push(addDays(d, i));
  // A day with a pain-free workout stays a streak day even if it falls in a recovery window.
  const activeSet = new Set(active);
  return dailyStreak(active, today, { maxGapDays: plannedRestDays(input.trainingDaysPerWeek), excusedDates: excused.filter((d) => !activeSet.has(d)) });
}

/** Strict daily chain (no gaps), where today still counts as pending. */
export function consecutiveDayStreak(dates: readonly string[], today: string): StreakState {
  return dailyStreak(dates, today, { maxGapDays: 0 });
}

export interface WeeklyStreakState {
  /** Weeks in the current unbroken chain (the current week counts once it is met). */
  current: number;
  longest: number;
  /** True when this week's target is already met. */
  metThisWeek: boolean;
  /** Monday of the first week of the current chain. */
  startWeek: string | null;
}

/** Consecutive weeks (Monday keys) that met the target. The current week is pending until it ends. */
export function weeklyStreak(metWeeks: readonly string[], today: string): WeeklyStreakState {
  const thisWeek = weekStart(today);
  const weeks = [...new Set(metWeeks.map((w) => dayNumber(weekStart(w))))].filter((w) => w <= dayNumber(thisWeek)).sort((a, b) => a - b);
  if (weeks.length === 0) return { current: 0, longest: 0, metThisWeek: false, startWeek: null };
  let longest = 1;
  let run = 1;
  let runStart = weeks[0]!;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i]! - weeks[i - 1]! === 7) run++;
    else {
      run = 1;
      runStart = weeks[i]!;
    }
    longest = Math.max(longest, run);
  }
  const last = weeks[weeks.length - 1]!;
  const metThisWeek = last === dayNumber(thisWeek);
  const alive = metThisWeek || last === dayNumber(thisWeek) - 7;
  return { current: alive ? run : 0, longest, metThisWeek, startWeek: alive ? toKey(runStart) : null };
}

/** Weeks (Monday keys) in which distinct pain-free training days reached the plan (capped at 6). */
export function weeksMeetingPlan(input: WorkoutStreakInput): string[] {
  const target = Math.min(6, Math.max(1, input.trainingDaysPerWeek ?? 3));
  const byWeek = new Map<string, Set<string>>();
  for (const w of input.workouts) {
    if (w.painLevel === "serious") continue;
    const k = weekStart(w.localDate);
    byWeek.set(k, (byWeek.get(k) ?? new Set()).add(w.localDate));
  }
  return [...byWeek.entries()].filter(([, days]) => days.size >= target).map(([k]) => k);
}

export type StreakType = "workout" | "nutrition" | "quest" | "weekly";

/** Milestones worth a celebration. Units: days, except weekly (weeks). */
export const STREAK_MILESTONES: Record<StreakType, readonly number[]> = {
  workout: [3, 7, 14, 30, 60, 100],
  nutrition: [3, 7, 14, 30, 60],
  quest: [3, 7, 14, 30, 60],
  weekly: [2, 4, 8, 12, 26, 52],
};

/** Milestones the current chain has reached (each celebrated once per chain). */
export function reachedMilestones(type: StreakType, current: number): number[] {
  return STREAK_MILESTONES[type].filter((m) => current >= m);
}
