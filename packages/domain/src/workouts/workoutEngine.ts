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

export interface WorkoutSubmission {
  sets: SubmittedSet[];
  durationMinutes: number;
  priorTrainingMinutesToday: number;
  painLevel: PainLevel;
}

export interface EvaluatedSet extends WorkoutSet {
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
 */
export function evaluateSet(s: SubmittedSet, setIndex: number): EvaluatedSet {
  if (!KNOWN.has(s.exerciseId)) throw new DomainValidationError(`unknown exercise: ${s.exerciseId}`, "exerciseId");

  let verificationStatus: VerificationStatus = s.trace ? "unsupported_exercise" : "not_tracked";
  let analysis: SetAnalysis | null = null;
  if (s.trace) {
    const full = analyzeSet(s.exerciseId, s.trace);
    if (full) {
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
  const sets = input.sets.map((s, i) => evaluateSet(s, i));

  const award = workoutXp({
    sets: sets.map((s) => ({ reps: s.reps, verifiedReps: s.verifiedReps, repQuality: s.verifiedRepDetails.map((r) => ({ formScore: (r as { formScore?: number }).formScore ?? null, romPercent: r.romPercent })) })),
    durationMinutes: input.durationMinutes,
    priorTrainingMinutesToday: input.priorTrainingMinutesToday,
    painLevel: input.painLevel,
  });
  return { sets, award };
}
