import type { RepVerificationResult, VerifiedRep } from "../analysis/repVerification";
import type { PainLevel } from "../progression/progressionEngine";
import type { DateKey } from "../shared/dates";

/** Workout and WorkoutSet models. XP for a workout lives in the XP ledger (XPEvent), not here. */

export type VerificationStatus = RepVerificationResult["status"] | "not_tracked" | "unsupported_exercise";

export interface WorkoutSet {
  setIndex: number;
  exerciseId: string;
  reps: number;
  loadKg: number;
  verifiedReps: number;
  verificationStatus: VerificationStatus;
  romPercent: number | null;
  /** 0–100 average form of the verified reps; null without camera-verified reps. */
  formScore: number | null;
  verifiedRepDetails: VerifiedRep[];
}

export interface Workout {
  id: string;
  userId: string;
  /** Client-generated idempotency key; unique per user. */
  clientWorkoutId: string;
  localDate: DateKey;
  durationMinutes: number;
  painLevel: PainLevel;
  sets: WorkoutSet[];
  createdAt: string;
}
