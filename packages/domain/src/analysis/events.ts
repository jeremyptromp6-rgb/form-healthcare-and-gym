import type { SetAnalysis } from "./setAnalysis";

/**
 * Exercise domain events: what the exercise-intelligence layer tells the rest of FORM. Emitted
 * once per camera-analyzed set when a workout completes (so deleted/edited sets never leak),
 * idempotent on `key`. Progression, achievements and quests (later stages) consume these; this
 * layer contains no XP, PR or quest rules.
 */

export interface SetVerifiedEvent {
  type: "exercise.set_verified";
  version: 1;
  /** Unique per user: `${workoutId}:${setIndex}`. */
  key: string;
  workoutId: string;
  exerciseId: string;
  setIndex: number;
  recordedReps: number;
  attemptedReps: number;
  verifiedReps: number;
  averageFormScore: number | null;
  averageRomPercent: number | null;
  perfectReps: number;
  analyzerVersion: string;
  reps: { index: number; formScore: number; romPercent: number; perfect: boolean }[];
  occurredAt: string;
}

export type ExerciseDomainEvent = SetVerifiedEvent;

export function setVerifiedEvent(input: {
  workoutId: string;
  exerciseId: string;
  setIndex: number;
  recordedReps: number;
  analysis: SetAnalysis;
  occurredAt: Date;
}): SetVerifiedEvent {
  const { analysis: a } = input;
  return {
    type: "exercise.set_verified",
    version: 1,
    key: `${input.workoutId}:${input.setIndex}`,
    workoutId: input.workoutId,
    exerciseId: input.exerciseId,
    setIndex: input.setIndex,
    recordedReps: input.recordedReps,
    attemptedReps: a.quality.attemptedReps,
    verifiedReps: a.quality.verifiedReps,
    averageFormScore: a.quality.averageFormScore,
    averageRomPercent: a.quality.averageRomPercent,
    perfectReps: a.quality.perfectReps,
    analyzerVersion: a.analyzerVersion,
    reps: a.reps.map((r) => ({ index: r.index, formScore: r.formScore, romPercent: r.romPercent, perfect: r.perfect })),
    occurredAt: input.occurredAt.toISOString(),
  };
}
