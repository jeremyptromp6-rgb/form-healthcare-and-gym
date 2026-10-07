import {
  buildPersonalization,
  normalizeNutritionPreferences,
  onboardingStatus,
  targetsForUser,
  EMPTY_NUTRITION_PREFERENCES,
  type NutritionPreferences,
  type UserProfile,
} from "@form/domain";
import type { Db } from "../../db";
import { saveTargetSnapshot } from "../nutrition/targets";
import { emptyProfile, latestWeight, loadGoalHistory, loadPreferences, loadProfile, recordGoal, upsertWeight, writePreferences, writeProfile } from "./repo";

/** Fields a client may edit. Everything else (derived fields, ownership, onboarding state) is server-controlled. */
export type ProfilePatch = Partial<
  Pick<UserProfile, "displayName" | "primaryGoal" | "sex" | "ageYears" | "heightCm" | "weightKg" | "experience" | "trainingDaysPerWeek" | "trainingLocation" | "equipment">
>;

const TARGET_INPUTS: (keyof UserProfile)[] = ["sex", "ageYears", "heightCm", "weightKg", "trainingDaysPerWeek", "primaryGoal"];

/**
 * Applies a profile edit as of the user's `localDate`:
 * - a new primary goal is recorded in goal history from that date (history is kept);
 * - a new weight is also recorded in weight history for that date;
 * - if anything the NutritionCalculator depends on changed, a new target snapshot takes
 *   effect from that date — earlier days keep the targets they were judged against.
 */
export function applyProfilePatch(db: Db, userId: string, patch: ProfilePatch, localDate: string, now: Date): UserProfile {
  const current = loadProfile(db, userId) ?? emptyProfile(userId, now);
  const merged: UserProfile = { ...current, ...patch };
  const saved = writeProfile(db, merged, now);

  if (patch.primaryGoal !== undefined && patch.primaryGoal !== current.primaryGoal) {
    recordGoal(db, userId, patch.primaryGoal!, localDate, now);
  }
  if (patch.weightKg !== undefined) {
    // A weight entered for an earlier day than the newest logged weight doesn't replace it.
    const latest = latestWeight(db, userId);
    upsertWeight(db, userId, localDate, patch.weightKg!, now);
    if (latest && latest.localDate > localDate) writeProfile(db, { ...saved, weightKg: latest.weightKg }, now);
  }

  const targetsChanged = TARGET_INPUTS.some((k) => patch[k as keyof ProfilePatch] !== undefined && patch[k as keyof ProfilePatch] !== current[k]);
  const final = loadProfile(db, userId)!;
  const targets = targetsForUser(final, loadPreferences(db, userId));
  if (targets && targetsChanged) saveTargetSnapshot(db, userId, localDate, targets, now);
  return final;
}

/**
 * Applies a nutrition-preferences edit. Diet styles (high protein, lower carb) shape the macro
 * split, so changing them snapshots new targets from the user's `localDate`.
 */
export function applyPreferencesPatch(db: Db, userId: string, patch: Partial<NutritionPreferences>, localDate: string, now: Date) {
  const current = loadPreferences(db, userId) ?? EMPTY_NUTRITION_PREFERENCES;
  const { movedToAllergies, ...normalized } = normalizeNutritionPreferences({ ...current, ...patch });
  writePreferences(db, userId, normalized, now);
  const profile = loadProfile(db, userId);
  const before = profile ? targetsForUser(profile, current) : null;
  const after = profile ? targetsForUser(profile, normalized) : null;
  if (after && before && (after.proteinG !== before.proteinG || after.carbsG !== before.carbsG || after.fatG !== before.fatG)) {
    saveTargetSnapshot(db, userId, localDate, after, now);
  }
  return { preferences: normalized, movedToAllergies };
}

/** Recomputes the current weight after the weight history changes, and re-snapshots targets. */
export function syncWeightFromHistory(db: Db, userId: string, effectiveFrom: string, now: Date): void {
  const profile = loadProfile(db, userId);
  const latest = latestWeight(db, userId);
  if (!profile || !latest || latest.weightKg === profile.weightKg) return;
  const saved = writeProfile(db, { ...profile, weightKg: latest.weightKg }, now);
  const targets = targetsForUser(saved, loadPreferences(db, userId));
  if (targets) saveTargetSnapshot(db, userId, effectiveFrom, targets, now);
}

/** Everything the app needs about "me", derived consistently. */
export function userState(db: Db, userId: string, today: string) {
  const profile = loadProfile(db, userId);
  const preferences = loadPreferences(db, userId);
  return {
    profile,
    preferences,
    targets: profile ? targetsForUser(profile, preferences) : null,
    onboarding: onboardingStatus(profile, preferences),
    personalization: buildPersonalization({ asOf: today, profile, preferences, goalHistory: loadGoalHistory(db, userId) }),
  };
}
