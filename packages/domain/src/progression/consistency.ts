import { addDays, daysBetween, weekStart, type DateKey } from "../shared/dates";

/**
 * Consistency rules: a small XP decay for a missed training day, and a reset of *active*
 * progression after too long without training. Pure and deterministic — the server applies the
 * results as append-only ledger entries, each keyed by its date so it can happen at most once.
 *
 * What counts as missed is decided against the user's own plan (training days per week), never
 * against "train every day":
 * - Rest days are flexible within a week. A day is missed only once the week's remaining days can
 *   no longer fit the sessions still owed — so planned rest is never punished, whichever days it
 *   falls on.
 * - Recovery is protected: the days after a workout with serious pain reported are recovery days.
 *   They never decay, don't count towards the reset, and lower that week's target.
 * - Nothing applies before the first qualifying workout.
 */

export const CONSISTENCY_RULES = {
  decayPerMissedDay: 10,
  /** Reset when MORE than this many consecutive days pass without a qualifying workout… */
  resetAfterDays: 5,
  /** Days after a serious-pain workout that are protected as recovery. */
  recoveryDaysAfterPain: 3,
  /** Used when the user hasn't said how often they train. */
  defaultTrainingDaysPerWeek: 3,
} as const;

export type DayKind = "before_start" | "trained" | "recovery" | "rest" | "missed";

export interface ConsistencyInput {
  /** Local dates of qualifying (completed) workouts. */
  workoutDates: readonly DateKey[];
  /** Local dates of workouts where serious pain was reported. */
  seriousPainDates: readonly DateKey[];
  trainingDaysPerWeek: number | null;
}

function planned(n: number | null): number {
  const v = n ?? CONSISTENCY_RULES.defaultTrainingDaysPerWeek;
  return Math.min(7, Math.max(1, Math.round(v)));
}

export function isRecoveryDay(date: DateKey, input: Pick<ConsistencyInput, "seriousPainDates" | "workoutDates">): boolean {
  if (input.workoutDates.includes(date)) return false;
  return input.seriousPainDates.some((p) => {
    const d = daysBetween(p, date);
    return d >= 1 && d <= CONSISTENCY_RULES.recoveryDaysAfterPain;
  });
}

/** Classifies one finished day for the decay rule. */
export function classifyDay(date: DateKey, input: ConsistencyInput, firstWorkout: DateKey | null): DayKind {
  if (!firstWorkout || date <= firstWorkout) return input.workoutDates.includes(date) ? "trained" : "before_start";
  if (input.workoutDates.includes(date)) return "trained";
  if (isRecoveryDay(date, input)) return "recovery";
  const start = weekStart(date);
  const end = addDays(start, 6);
  let trained = 0;
  let recovery = 0;
  for (let d = start; d <= date; d = addDays(d, 1)) {
    if (input.workoutDates.includes(d)) trained++;
    else if (isRecoveryDay(d, input)) recovery++;
  }
  const owed = Math.max(0, planned(input.trainingDaysPerWeek) - trained - recovery);
  const daysLeft = daysBetween(date, end); // days after `date` in this week
  return owed > daysLeft ? "missed" : "rest";
}

/**
 * The reset threshold. It's the rule's 5 days — except for plans that legitimately need longer
 * gaps (training once a week means 6 rest days), where it becomes that plan's longest planned gap,
 * so planned rest never triggers a reset.
 */
export function resetThreshold(trainingDaysPerWeek: number | null): number {
  const n = planned(trainingDaysPerWeek);
  const longestPlannedGap = Math.ceil(7 / n) - 1;
  return Math.max(CONSISTENCY_RULES.resetAfterDays, longestPlannedGap);
}

/**
 * Consecutive days without a qualifying workout up to and including `date`, counted from the
 * later of the last workout and the last reset. Recovery days don't count.
 */
export function daysWithoutTraining(date: DateKey, input: ConsistencyInput, lastReset: DateKey | null): number {
  const last = input.workoutDates.filter((d) => d <= date).sort().at(-1) ?? null;
  const anchor = [last, lastReset].filter((x): x is DateKey => x !== null).sort().at(-1) ?? null;
  if (anchor === null) return 0;
  let n = 0;
  for (let d = addDays(anchor, 1); d <= date; d = addDays(d, 1)) if (!isRecoveryDay(d, input)) n++;
  return n;
}

/** The decay for a missed day: small, and never taking active XP below zero. */
export function decayAmount(activeXp: number): number {
  return Math.max(0, Math.min(CONSISTENCY_RULES.decayPerMissedDay, Math.floor(activeXp)));
}

export type DayOutcome = { kind: "none" } | { kind: "decay"; amount: number } | { kind: "reset"; gapDays: number; threshold: number };

/**
 * What happens at the end of `date`: a reset (gap past the threshold, and there is active progress
 * to reset), else a decay for a missed day, else nothing.
 */
export function dayOutcome(input: ConsistencyInput & { date: DateKey; firstWorkout: DateKey | null; lastReset: DateKey | null; activeXp: number }): DayOutcome {
  if (!input.firstWorkout || input.date <= input.firstWorkout) return { kind: "none" };
  const threshold = resetThreshold(input.trainingDaysPerWeek);
  const gap = daysWithoutTraining(input.date, input, input.lastReset);
  if (gap > threshold && input.activeXp > 0) return { kind: "reset", gapDays: gap, threshold };
  if (classifyDay(input.date, input, input.firstWorkout) === "missed") {
    const amount = decayAmount(input.activeXp);
    return amount > 0 ? { kind: "decay", amount } : { kind: "none" };
  }
  return { kind: "none" };
}

/**
 * For the UI: the number of days, counting today, within which a workout keeps active progress
 * (null before the first workout). 1 means "today".
 */
export function daysUntilReset(today: DateKey, input: ConsistencyInput, lastReset: DateKey | null): number | null {
  const firstWorkout = [...input.workoutDates].sort()[0] ?? null;
  if (!firstWorkout) return null;
  const gapThroughYesterday = daysWithoutTraining(addDays(today, -1), input, lastReset);
  if (input.workoutDates.includes(today)) return resetThreshold(input.trainingDaysPerWeek) + 1;
  // The reset happens at the end of the day the gap first exceeds the threshold.
  return Math.max(1, resetThreshold(input.trainingDaysPerWeek) + 1 - gapThroughYesterday);
}
