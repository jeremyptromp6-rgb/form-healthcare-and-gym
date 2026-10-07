import { assertFiniteInRange, assertInteger, DomainValidationError } from "../shared/errors";

/**
 * ProgressionEngine — the single source of truth for XP, levels and ranks.
 *
 * Runs server-side. Clients may display these numbers but never submit them.
 * Core principle: progress when earned. Verified work earns full XP; self-logged
 * work earns a little; overtraining, training through serious pain and unsafe
 * eating earn nothing.
 */

/** The level curve: total XP to reach level L is floor(base × (L − 1)^exponent). Configurable in one place. */
export const LEVEL_CURVE = { base: 100, exponent: 1.5, maxLevel: 100 } as const;

export const MAX_LEVEL = LEVEL_CURVE.maxLevel;

/** The rank ladder, in order. A rank is held from its minimum level. */
export const RANKS = [
  { name: "Rookie", minLevel: 1 },
  { name: "Starter", minLevel: 5 },
  { name: "Athlete", minLevel: 10 },
  { name: "Iron", minLevel: 20 },
  { name: "Elite", minLevel: 30 },
  { name: "Master", minLevel: 45 },
  { name: "Champion", minLevel: 60 },
] as const;

export type RankName = (typeof RANKS)[number]["name"];

export const XP_RULES = {
  /** Verified reps earn on a diminishing scale per workout: the first 100 at 2 XP, the next 100 at 1, the next 100 at 0.5, then nothing. */
  verifiedRepTiers: [
    { upTo: 100, xp: 2 },
    { upTo: 200, xp: 1 },
    { upTo: 300, xp: 0.5 },
  ],
  perUnverifiedRep: 0.5,
  /** Self-logged reps are recorded, not verified — their XP is capped per workout. */
  unverifiedRepXpCap: 40,
  /** A verified rep with at least this form score earns a form bonus. */
  goodFormScore: 85,
  perGoodFormRep: 0.5,
  goodFormXpCap: 50,
  /** A verified rep with at least this range of motion earns a ROM bonus. */
  fullRomPercent: 95,
  perFullRomRep: 0.25,
  fullRomXpCap: 25,
  /** Each awarded personal record (never one held for review). */
  perPersonalRecord: 30,
  maxPersonalRecordsRewarded: 3,
  workoutCompletionBonus: 25,
  /** Training minutes per day that can earn XP. Beyond this, extra volume earns nothing. */
  dailyTrainingMinutesCap: 120,
  perMealLogged: 5,
  mealsRewardedPerDay: 4,
  onTargetBonus: 20,
  onTargetTolerance: 0.1,
} as const;

/** Total XP needed to reach `level` (level 1 = 0 XP). */
export function xpRequiredForLevel(level: number): number {
  assertInteger(level, "level");
  assertFiniteInRange(level, 1, MAX_LEVEL, "level");
  return Math.floor(LEVEL_CURVE.base * Math.pow(level - 1, LEVEL_CURVE.exponent));
}

export function rankForLevel(level: number): RankName {
  let rank: RankName = RANKS[0].name;
  for (const r of RANKS) if (level >= r.minLevel) rank = r.name;
  return rank;
}

export interface ProgressSnapshot {
  totalXp: number;
  level: number;
  rank: RankName;
  xpIntoLevel: number;
  /** XP span of the current level; 0 at max level. */
  xpForNextLevel: number;
  fractionToNext: number;
}

export function progressFromXp(totalXp: number): ProgressSnapshot {
  if (!Number.isFinite(totalXp) || totalXp < 0) throw new DomainValidationError("totalXp must be >= 0", "totalXp");
  const xp = Math.floor(totalXp);
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpRequiredForLevel(level + 1)) level++;

  const base = xpRequiredForLevel(level);
  const span = level === MAX_LEVEL ? 0 : xpRequiredForLevel(level + 1) - base;
  return {
    totalXp: xp,
    level,
    rank: rankForLevel(level),
    xpIntoLevel: xp - base,
    xpForNextLevel: span,
    fractionToNext: span === 0 ? 1 : (xp - base) / span,
  };
}

// ---- Workout XP ---------------------------------------------------------------

export interface WorkoutSetForXp {
  reps: number;
  /** Reps confirmed by the Rep Verification Engine. Must be <= reps. */
  verifiedReps: number;
  /** Per verified rep, from the server's analysis: form score and range of motion. */
  repQuality?: readonly { formScore?: number | null; romPercent?: number | null }[];
}

export type PainLevel = "none" | "mild" | "serious";

export interface WorkoutXpInput {
  sets: WorkoutSetForXp[];
  durationMinutes: number;
  /** Minutes already trained today before this workout. */
  priorTrainingMinutesToday: number;
  painLevel: PainLevel;
  /** Personal records this workout beat (detected server-side from verified reps; first-ever baselines don't count). */
  personalRecords?: number;
}

export type XpFlag = "serious_pain_no_xp" | "daily_training_cap_reached" | "partially_capped";

export interface XpAward {
  xp: number;
  flags: XpFlag[];
  /** Every component, for the audit trail. */
  breakdown: {
    verifiedReps: number;
    unverifiedReps: number;
    verifiedRepXp: number;
    unverifiedRepXp: number;
    goodFormReps: number;
    formXp: number;
    fullRomReps: number;
    romXp: number;
    personalRecords: number;
    prXp: number;
    completionBonus: number;
    cappedFraction: number;
  };
}

/** XP for a workout's verified reps on the diminishing scale. */
export function verifiedRepXp(verifiedReps: number): number {
  let xp = 0;
  let from = 0;
  for (const tier of XP_RULES.verifiedRepTiers) {
    const inTier = Math.max(0, Math.min(verifiedReps, tier.upTo) - from);
    xp += inTier * tier.xp;
    from = tier.upTo;
  }
  return xp;
}

const MAX_SETS = 100;
const MAX_REPS_PER_SET = 200;

export function workoutXp(input: WorkoutXpInput): XpAward {
  assertFiniteInRange(input.durationMinutes, 1, 600, "durationMinutes");
  assertFiniteInRange(input.priorTrainingMinutesToday, 0, 1440, "priorTrainingMinutesToday");
  if (input.sets.length > MAX_SETS) throw new DomainValidationError(`at most ${MAX_SETS} sets`, "sets");

  let verified = 0;
  let unverified = 0;
  let goodForm = 0;
  let fullRom = 0;
  for (const set of input.sets) {
    assertInteger(set.reps, "reps");
    assertInteger(set.verifiedReps, "verifiedReps");
    assertFiniteInRange(set.reps, 0, MAX_REPS_PER_SET, "reps");
    assertFiniteInRange(set.verifiedReps, 0, set.reps, "verifiedReps");
    verified += set.verifiedReps;
    unverified += set.reps - set.verifiedReps;
    // Only verified reps carry quality; never more quality entries than verified reps.
    for (const q of (set.repQuality ?? []).slice(0, set.verifiedReps)) {
      if (q.formScore != null && q.formScore >= XP_RULES.goodFormScore) goodForm++;
      if (q.romPercent != null && q.romPercent >= XP_RULES.fullRomPercent) fullRom++;
    }
  }
  const prs = Math.max(0, Math.min(Math.floor(input.personalRecords ?? 0), XP_RULES.maxPersonalRecordsRewarded));

  const zero = (flags: XpFlag[]): XpAward => ({
    xp: 0,
    flags,
    breakdown: {
      verifiedReps: verified, unverifiedReps: unverified, verifiedRepXp: 0, unverifiedRepXp: 0, goodFormReps: goodForm, formXp: 0,
      fullRomReps: fullRom, romXp: 0, personalRecords: prs, prXp: 0, completionBonus: 0, cappedFraction: 0,
    },
  });

  if (input.painLevel === "serious") return zero(["serious_pain_no_xp"]);

  const remaining = XP_RULES.dailyTrainingMinutesCap - input.priorTrainingMinutesToday;
  if (remaining <= 0) return zero(["daily_training_cap_reached"]);

  const eligibleFraction = Math.min(1, remaining / input.durationMinutes);
  const flags: XpFlag[] = eligibleFraction < 1 ? ["partially_capped"] : [];
  const completionBonus = verified + unverified > 0 ? XP_RULES.workoutCompletionBonus : 0;
  const vXp = verifiedRepXp(verified);
  const uXp = Math.min(unverified * XP_RULES.perUnverifiedRep, XP_RULES.unverifiedRepXpCap);
  const formXp = Math.min(goodForm * XP_RULES.perGoodFormRep, XP_RULES.goodFormXpCap);
  const romXp = Math.min(fullRom * XP_RULES.perFullRomRep, XP_RULES.fullRomXpCap);
  const prXp = prs * XP_RULES.perPersonalRecord;
  const raw = vXp + uXp + formXp + romXp + prXp + completionBonus;

  return {
    xp: Math.floor(raw * eligibleFraction),
    flags,
    breakdown: {
      verifiedReps: verified, unverifiedReps: unverified, verifiedRepXp: vXp, unverifiedRepXp: uXp, goodFormReps: goodForm, formXp,
      fullRomReps: fullRom, romXp, personalRecords: prs, prXp, completionBonus, cappedFraction: eligibleFraction,
    },
  };
}

// ---- Nutrition XP --------------------------------------------------------------

export interface NutritionDayXpInput {
  mealsLogged: number;
  totalKcal: number;
  targetKcal: number;
  /** Minimum safe intake from NutritionCalculator. */
  safeFloorKcal: number;
  /** Only a finished day can be judged against its target. */
  dayComplete: boolean;
}

export interface NutritionXpAward {
  xp: number;
  flags: ("below_safe_minimum" | "on_target")[];
}

export function nutritionDayXp(input: NutritionDayXpInput): NutritionXpAward {
  assertInteger(input.mealsLogged, "mealsLogged");
  assertFiniteInRange(input.mealsLogged, 0, 50, "mealsLogged");
  assertFiniteInRange(input.totalKcal, 0, 20_000, "totalKcal");
  assertFiniteInRange(input.targetKcal, 800, 10_000, "targetKcal");
  assertFiniteInRange(input.safeFloorKcal, 800, 10_000, "safeFloorKcal");

  // A completed day under the safe floor earns nothing — not even logging XP — so the
  // game never rewards starvation.
  if (input.dayComplete && input.totalKcal < input.safeFloorKcal) {
    return { xp: 0, flags: ["below_safe_minimum"] };
  }

  let xp = Math.min(input.mealsLogged, XP_RULES.mealsRewardedPerDay) * XP_RULES.perMealLogged;
  const flags: NutritionXpAward["flags"] = [];
  if (input.dayComplete && Math.abs(input.totalKcal - input.targetKcal) <= input.targetKcal * XP_RULES.onTargetTolerance) {
    xp += XP_RULES.onTargetBonus;
    flags.push("on_target");
  }
  return { xp, flags };
}
