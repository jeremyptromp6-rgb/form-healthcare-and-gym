import type { RepTrace } from "../analysis/repVerification";
import { analyzeSet, keepRecorded, type AssessedRep, type SetAnalysis } from "../analysis/setAnalysis";
import { workoutXp, type PainLevel, type XpAward } from "../progression/progressionEngine";
import { DomainValidationError } from "../shared/errors";
import { EXERCISES } from "./exercises";
import type { VerificationStatus, WorkoutSet } from "./workouts";

/**
 * Workout Engine — the source of truth for completing a workout. Validates every set
 * against the exercise catalog, runs rep verification over any pose trace, and asks the
 * ProgressionEngine for the XP award. The client can report reps; it can never report
 * verified reps.
 */

export interface SubmittedSet {
  exerciseId: string;
  reps: number;
  loadKg: number;
  trace?: RepTrace;
}

/**
 * Real-time bound on camera traces. The traces of a workout's verified sets must fit inside the time
 * the workout really took (server-measured for a live session, the stated duration for a one-shot log),
 * plus this tolerance. A trace that doesn't fit is not trusted: its set is kept as unverified reps.
 */
export const TRACE_TIME_TOLERANCE = { fraction: 0.1, extraMs: 30_000 } as const;

/** The total trace time that fits in `realMs` of real workout time. */
export function traceBudgetMs(realMs: number): number {
  return Math.round(Math.max(0, realMs) * (1 + TRACE_TIME_TOLERANCE.fraction) + TRACE_TIME_TOLERANCE.extraMs);
}

/**
 * Personal records ignore sets above this load (kg): the API accepts up to 1,000 kg, but nobody
 * records a verified set that heavy, so it is far more likely a typo or a fabricated entry.
 * (Smaller implausible jumps are already held for review by the PR rules.)
 */
export const MAX_PR_LOAD_KG = 500;

export interface WorkoutSubmission {
  sets: SubmittedSet[];
  durationMinutes: number;
  priorTrainingMinutesToday: number;
  painLevel: PainLevel;
  priorXpWorkoutsToday?: number;
}

/** "trace_exceeds_time": the camera trace was longer than the time the workout really took, so it wasn't trusted. */
export type EvaluatedVerificationStatus = VerificationStatus | "trace_exceeds_time";

export interface EvaluatedSet extends Omit<WorkoutSet, "verificationStatus"> {
  verificationStatus: EvaluatedVerificationStatus;
  verifiedRepDetails: AssessedRep[];
  /** Camera analysis of the set (attempts, rejections, quality, gates) — persisted for audit. Null without a trace. */
  analysis: SetAnalysisRecord | null;
}

/** What's stored per set for audit/debugging: everything except the per-rep list (stored separately). */
export type SetAnalysisRecord = Omit<SetAnalysis, "reps">;

const KNOWN = new Set(EXERCISES.map((e) => e.id));

/**
 * Evaluates one recorded set: checks the exercise exists and runs server-side rep verification,
 * form and ROM analysis over any pose trace. Verified reps never exceed the reps the user recorded;
 * form score and ROM are averages over the verified reps that are kept.
 *
 * `traceBudgetRemainingMs`, when given, is the real time left for traces (see traceBudgetMs): a trace
 * spanning more than that is rejected (status "trace_exceeds_time", no verified reps).
 */
export function evaluateSet(s: SubmittedSet, setIndex: number, traceBudgetRemainingMs?: number): EvaluatedSet {
  if (!KNOWN.has(s.exerciseId)) throw new DomainValidationError(`unknown exercise: ${s.exerciseId}`, "exerciseId");

  let verificationStatus: EvaluatedVerificationStatus = s.trace ? "unsupported_exercise" : "not_tracked";
  let analysis: SetAnalysis | null = null;
  if (s.trace) {
    const full = analyzeSet(s.exerciseId, s.trace);
    if (full && traceBudgetRemainingMs !== undefined && full.spanMs > traceBudgetRemainingMs) {
      verificationStatus = "trace_exceeds_time";
    } else if (full) {
      analysis = keepRecorded(s.exerciseId, full, s.reps);
      verificationStatus = full.status;
    }
  }
  const { reps: kept = [], ...record } = analysis ?? {};
  return {
    setIndex,
    exerciseId: s.exerciseId,
    reps: s.reps,
    loadKg: s.loadKg,
    verifiedReps: kept.length,
    verificationStatus,
    romPercent: analysis?.quality.averageRomPercent ?? null,
    formScore: analysis?.quality.averageFormScore ?? null,
    verifiedRepDetails: kept,
    analysis: analysis ? (record as SetAnalysisRecord) : null,
  };
}

export function evaluateWorkout(input: WorkoutSubmission): { sets: EvaluatedSet[]; award: XpAward } {
  let traceBudget = traceBudgetMs(input.durationMinutes * 60_000);
  const sets = input.sets.map((s, i) => {
    const set = evaluateSet(s, i, traceBudget);
    traceBudget -= set.analysis?.spanMs ?? 0;
    return set;
  });

  const award = workoutXp({
    sets: sets.map((s) => ({ reps: s.reps, verifiedReps: s.verifiedReps, repQuality: s.verifiedRepDetails.map((r) => ({ formScore: (r as { formScore?: number }).formScore ?? null, romPercent: r.romPercent })) })),
    durationMinutes: input.durationMinutes,
    priorTrainingMinutesToday: input.priorTrainingMinutesToday,
    painLevel: input.painLevel,
    priorXpWorkoutsToday: input.priorXpWorkoutsToday,
  });
  return { sets, award };
}
