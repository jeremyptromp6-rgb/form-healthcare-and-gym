import { assertFiniteInRange, assertInteger } from "../shared/errors";

/**
 * PersonalRecord system.
 *
 * Records come only from authoritative data: camera-verified reps scored by the server, and the
 * server's own workout history. Each metric declares its comparison direction, unit and minimum
 * meaningful improvement. The first value for a metric is a baseline (stored, celebrated quietly,
 * never rewarded); beating it is a record. A jump that is implausibly large compared with the
 * previous best is held for review instead of awarded.
 */

/** Epley estimate. Beyond 12 reps the estimate is unreliable, so null is returned. */
export function estimateOneRepMax(loadKg: number, reps: number): number | null {
  assertFiniteInRange(loadKg, 0, 1_000, "loadKg");
  assertInteger(reps, "reps");
  assertFiniteInRange(reps, 0, 1_000, "reps");
  if (reps === 0 || loadKg === 0) return null;
  if (reps === 1) return loadKg;
  if (reps > 12) return null;
  return Math.round(loadKg * (1 + reps / 30) * 10) / 10;
}

export type PrKind = "max_load" | "estimated_1rm" | "max_reps" | "best_form" | "best_rom" | "workout_verified_reps" | "longest_streak";

export interface PrMetric {
  label: string;
  unit: "kg" | "reps" | "score" | "%" | "days";
  /** Which way is better. Every metric compares through this. */
  direction: "higher" | "lower";
  /** Per exercise, or across all training ("*"). */
  scope: "exercise" | "global";
  /** The smallest change that counts as a new record. */
  minStep: number;
  /** Hold implausibly large jumps for review. */
  jumpCheck: boolean;
  /** Earns the PR bonus through the progression ledger (consistency records are recognition only). */
  rewarded: boolean;
}

export const PR_METRICS: Record<PrKind, PrMetric> = {
  max_load: { label: "Heaviest weight", unit: "kg", direction: "higher", scope: "exercise", minStep: 0, jumpCheck: true, rewarded: true },
  estimated_1rm: { label: "Estimated one-rep max", unit: "kg", direction: "higher", scope: "exercise", minStep: 0, jumpCheck: true, rewarded: true },
  max_reps: { label: "Most verified reps", unit: "reps", direction: "higher", scope: "exercise", minStep: 0, jumpCheck: true, rewarded: true },
  best_form: { label: "Best form score", unit: "score", direction: "higher", scope: "exercise", minStep: 2, jumpCheck: false, rewarded: true },
  best_rom: { label: "Best range of motion", unit: "%", direction: "higher", scope: "exercise", minStep: 2, jumpCheck: false, rewarded: true },
  workout_verified_reps: { label: "Most verified reps in a workout", unit: "reps", direction: "higher", scope: "global", minStep: 0, jumpCheck: true, rewarded: true },
  longest_streak: { label: "Longest training streak", unit: "days", direction: "higher", scope: "global", minStep: 0, jumpCheck: false, rewarded: false },
};

/** The exercise id used for records that span all training. */
export const GLOBAL_RECORD = "*";

/** Relative improvement over the previous best above which a PR is held for review. */
export const PLAUSIBLE_JUMP = 0.25;
/** A set needs this many verified reps before its form or range of motion can be a record. */
export const MIN_REPS_FOR_QUALITY_RECORD = 3;

export interface PrCandidate {
  kind: PrKind;
  value: number;
  previous: number | null;
  status: "awarded" | "needs_review";
}

/** Direction-aware comparison for any metric: does `value` beat `previous` (null = no record yet)? */
export function improves(m: Pick<PrMetric, "direction" | "minStep">, value: number, previous: number | null): boolean {
  if (previous === null) return true;
  const gain = m.direction === "higher" ? value - previous : previous - value;
  return gain > 0 && gain >= m.minStep;
}

export function isImprovement(kind: PrKind, value: number, previous: number | null): boolean {
  return improves(PR_METRICS[kind], value, previous);
}

/** Judges one value against the current best. Null when it is not a record. */
export function judgeRecord(kind: PrKind, value: number | null, previous: number | null): PrCandidate | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (!isImprovement(kind, value, previous)) return null;
  const m = PR_METRICS[kind];
  const change = previous === null || previous <= 0 ? 0 : m.direction === "higher" ? (value - previous) / previous : (previous - value) / previous;
  const implausible = m.jumpCheck && previous !== null && change > PLAUSIBLE_JUMP;
  return { kind, value, previous, status: implausible ? "needs_review" : "awarded" };
}

/** Current bests for one exercise (awarded records only). */
export type RecordBests = Partial<Record<PrKind, number>>;

export interface ExerciseBests {
  bestLoadKg: number | null;
  bestEstimated1RmKg: number | null;
  bestReps: number | null;
}

export interface SetForRecords {
  loadKg: number;
  verifiedReps: number;
  /** Server form score for the set's verified reps (null when not scored). */
  formScore?: number | null;
  /** Average range of motion of the set's verified reps (null when not measured). */
  romPercent?: number | null;
}

/** Records one verified set sets for its exercise. Only verified reps count. */
export function detectSetRecords(bests: RecordBests, set: SetForRecords): PrCandidate[] {
  assertFiniteInRange(set.loadKg, 0, 1_000, "loadKg");
  assertInteger(set.verifiedReps, "verifiedReps");
  if (set.verifiedReps <= 0) return [];
  const out: PrCandidate[] = [];
  const consider = (kind: PrKind, value: number | null) => {
    const c = judgeRecord(kind, value, bests[kind] ?? null);
    if (c) out.push(c);
  };
  if (set.loadKg > 0) {
    consider("max_load", set.loadKg);
    consider("estimated_1rm", estimateOneRepMax(set.loadKg, set.verifiedReps));
  } else {
    // Bodyweight movement: rep records.
    consider("max_reps", set.verifiedReps);
  }
  if (set.verifiedReps >= MIN_REPS_FOR_QUALITY_RECORD) {
    if (set.formScore != null) consider("best_form", Math.min(100, set.formScore));
    if (set.romPercent != null) consider("best_rom", Math.min(100, set.romPercent));
  }
  return out;
}

/** Load/rep records for a set (kept for existing callers). */
export function detectPrs(bests: ExerciseBests, set: { loadKg: number; verifiedReps: number }): PrCandidate[] {
  return detectSetRecords({ max_load: bests.bestLoadKg ?? undefined, estimated_1rm: bests.bestEstimated1RmKg ?? undefined, max_reps: bests.bestReps ?? undefined }, set);
}

/** A beaten record (not a baseline, not held for review) that the progression ledger rewards. */
export function isRewardedRecord(c: Pick<PrCandidate, "kind" | "previous" | "status">): boolean {
  return c.status === "awarded" && c.previous !== null && PR_METRICS[c.kind].rewarded;
}

/** How a record value reads, e.g. "60 kg", "12 reps", "form 92". */
export function formatRecordValue(kind: PrKind, value: number): string {
  const unit = PR_METRICS[kind].unit;
  const v = Math.round(value * 10) / 10;
  return unit === "score" ? `form ${v}` : unit === "%" ? `${v}%` : `${v} ${unit === "reps" && v === 1 ? "rep" : unit === "days" && v === 1 ? "day" : unit}`;
}
