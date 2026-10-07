import { assertFiniteInRange, DomainValidationError } from "../shared/errors";

/**
 * NutritionCalculator — energy targets, macros and food math.
 *
 * Targets never go below a safe floor, deficits are capped, and minors are never
 * given a weight-loss deficit. Inputs: sex, age, height, weight (measurements), activity (from
 * training frequency), energy goal (from the primary goal) and diet styles (macro split only).
 */

export type Sex = "male" | "female" | "unspecified";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
/** Energy strategy. ecomp is a gentle deficit for leaning out while keeping muscle. */
export type Goal = "lose" | "recomp" | "maintain" | "gain";

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT: Record<Goal, number> = { lose: -0.2, recomp: -0.1, maintain: 0, gain: 0.1 };
const MAX_DEFICIT_KCAL = 750;
const ABSOLUTE_FLOOR_KCAL: Record<Sex, number> = { male: 1500, female: 1200, unspecified: 1500 };

export interface BodyProfile {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: Goal;
}

export interface NutritionTargets {
  bmrKcal: number;
  tdeeKcal: number;
  targetKcal: number;
  safeFloorKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** The goal actually applied, which may differ from the requested one for safety. */
  appliedGoal: Goal;
  /** Diet styles that shaped the macro split (high_protein, low_carb). */
  dietStyles: string[];
  notes: string[];
}

export function validateProfile(p: BodyProfile): void {
  assertFiniteInRange(p.ageYears, 13, 100, "ageYears");
  assertFiniteInRange(p.heightCm, 120, 240, "heightCm");
  assertFiniteInRange(p.weightKg, 30, 300, "weightKg");
  if (!(p.activity in ACTIVITY_MULTIPLIERS)) throw new DomainValidationError("unknown activity level", "activity");
  if (!(p.goal in GOAL_ADJUSTMENT)) throw new DomainValidationError("unknown goal", "goal");
}

/** Mifflin–St Jeor. "unspecified" uses the midpoint of the male and female constants. */
export function bmr(p: Pick<BodyProfile, "sex" | "ageYears" | "heightCm" | "weightKg">): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears;
  const sexConstant = p.sex === "male" ? 5 : p.sex === "female" ? -161 : -78;
  return base + sexConstant;
}

export function calculateTargets(p: BodyProfile, diet: DietContext = {}): NutritionTargets {
  validateProfile(p);
  const notes: string[] = [];

  let goal = p.goal;
  if (p.ageYears < 18 && (goal === "lose" || goal === "recomp")) {
    goal = "maintain";
    notes.push("Weight-loss targets are not set for users under 18. Talk to a doctor or dietitian.");
  }

  const bmrKcal = Math.round(bmr(p));
  const tdeeKcal = Math.round(bmrKcal * ACTIVITY_MULTIPLIERS[p.activity]);
  const safeFloorKcal = Math.max(ABSOLUTE_FLOOR_KCAL[p.sex], bmrKcal);

  let adjustment = tdeeKcal * GOAL_ADJUSTMENT[goal];
  if (adjustment < -MAX_DEFICIT_KCAL) adjustment = -MAX_DEFICIT_KCAL;
  let targetKcal = Math.round(tdeeKcal + adjustment);
  if (targetKcal < safeFloorKcal) {
    targetKcal = safeFloorKcal;
    notes.push("Target raised to your safe minimum intake.");
  }

  // Protein scales with lean mass, not fat mass: above BMI 30 it's based on the weight at BMI 27.
  const heightM = p.heightCm / 100;
  const bmi = p.weightKg / (heightM * heightM);
  const proteinWeightKg = bmi >= MACRO_RULES.adjustedWeightAboveBmi ? MACRO_RULES.adjustedWeightBmi * heightM * heightM : p.weightKg;
  if (proteinWeightKg !== p.weightKg) notes.push("Protein is based on an adjusted body weight, which better reflects lean mass.");

  const styles = new Set(diet.styles ?? []);
  let proteinPerKg = goal === "lose" || goal === "recomp" ? 2.0 : goal === "gain" ? 1.8 : 1.6;
  if (styles.has("high_protein")) proteinPerKg = Math.min(MACRO_RULES.maxProteinPerKg, proteinPerKg + MACRO_RULES.highProteinBonusPerKg);
  const proteinG = Math.round(proteinWeightKg * proteinPerKg);

  const fatShare = styles.has("low_carb") ? MACRO_RULES.lowCarbFatShare : MACRO_RULES.defaultFatShare;
  let fatG = Math.round(Math.max((targetKcal * fatShare) / 9, p.weightKg * MACRO_RULES.minFatPerKg));
  let carbsG = Math.round((targetKcal - proteinG * 4 - fatG * 9) / 4);
  if (carbsG < MACRO_RULES.minCarbsG) {
    // Keep a floor of carbohydrate; trim fat (never below its own floor) to make room.
    carbsG = MACRO_RULES.minCarbsG;
    fatG = Math.max(Math.round(p.weightKg * MACRO_RULES.floorFatPerKg), Math.round((targetKcal - proteinG * 4 - carbsG * 4) / 9));
  }

  const dietStyles = [...styles].filter((s) => s === "high_protein" || s === "low_carb");
  return { bmrKcal, tdeeKcal, targetKcal, safeFloorKcal, proteinG, carbsG, fatG, appliedGoal: goal, dietStyles, notes };
}

/** Macro rules. Diet styles shape the split; calories come only from the body profile and goal. */
export const MACRO_RULES = {
  defaultFatShare: 0.25,
  lowCarbFatShare: 0.4,
  minFatPerKg: 0.6,
  /** Absolute fat floor when carbs need room. */
  floorFatPerKg: 0.5,
  minCarbsG: 50,
  highProteinBonusPerKg: 0.4,
  maxProteinPerKg: 2.4,
  adjustedWeightAboveBmi: 30,
  adjustedWeightBmi: 27,
} as const;

/** Diet styles that change the macro split. Restrictions (vegan, halal…) never change targets. */
export interface DietContext {
  styles?: readonly string[];
}

// ---- Food math -----------------------------------------------------------------

export interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function validateMacros(m: Macros): void {
  assertFiniteInRange(m.kcal, 0, 10_000, "kcal");
  assertFiniteInRange(m.proteinG, 0, 1_000, "proteinG");
  assertFiniteInRange(m.carbsG, 0, 2_000, "carbsG");
  assertFiniteInRange(m.fatG, 0, 1_000, "fatG");
}

/** Energy the macronutrients alone supply (Atwater: 4 kcal/g protein and carbs, 9 kcal/g fat). */
export function macroEnergyKcal(m: Pick<Macros, "proteinG" | "carbsG" | "fatG">): number {
  return 4 * m.proteinG + 4 * m.carbsG + 9 * m.fatG;
}

/**
 * Typed-in calories must not be far below what the typed-in macros supply — that's a typo (a
 * missing digit, macros entered per 100 g with calories per serving), and it would corrupt day
 * totals and targets. More calories than the macros explain is fine (alcohol, fibre, label
 * rounding), and a little under is fine (labels round each value).
 */
export function assertEnergyConsistent(m: Macros): void {
  const fromMacros = macroEnergyKcal(m);
  if (fromMacros > m.kcal * 1.25 + 25) {
    throw new DomainValidationError(`The calories (${Math.round(m.kcal)}) are much lower than the protein, carbs and fat add up to (about ${Math.round(fromMacros)} kcal). Check the numbers.`, "kcal");
  }
}

// Scaling nutrition by an amount lives in ./calculation.ts (NutritionCalculator) — nowhere else.
