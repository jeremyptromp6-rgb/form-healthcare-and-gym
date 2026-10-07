import { DomainValidationError } from "../shared/errors";
import { presentMacros, sumNutrients, type AmountVia } from "./calculation";
import { assertEnergyConsistent, validateMacros, type Macros } from "./nutritionCalculator";
import { isMeasureUnit, type FoodUnit } from "./units";

/**
 * Food logging model. Two independent facts describe every entry:
 *
 * - `source` — where the nutrition data came from: the verified reference database, a food the
 *   user created, a scan estimate, a recipe, or numbers typed in by hand;
 * - `amountMethod` — how the amount was obtained: `measured` (weighed), `label` (a package
 *   serving) or `estimated` (eyeballed, or guessed by a scanner).
 *
 * Invariants (enforced here and again by the database):
 * - a scan estimate is always `estimated` — a camera never produces a measurement;
 * - `measured` requires a weight or volume read directly (g, kg, oz, lb; ml, L, fl oz, cups and
 *   spoons for drinks) — not "1 serving", and not a volume converted to grams through a density;
 * - a scan estimate can only be superseded by an entry of higher precedence (measured > label).
 * - database, user-food and recipe entries get their macros computed from the food and the
 *   portion — clients only supply macros for manual entries.
 */

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const FOOD_SOURCES = ["verified_database", "user_food", "scan_estimate", "recipe", "manual"] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

export const AMOUNT_METHODS = ["measured", "label", "estimated"] as const;
export type AmountMethod = (typeof AMOUNT_METHODS)[number];

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The amount method an entry actually gets. Scans are always estimates; "measured" needs a
 * weight or volume that was read directly (`via` mass or volume), never a count or a density
 * conversion. Returns the method or throws with the reason.
 */
export function resolveAmountMethod(source: FoodSource, requested: AmountMethod, unit: FoodUnit | null, via?: AmountVia | null): AmountMethod {
  if (source === "scan_estimate" && requested !== "estimated") {
    throw new DomainValidationError("a scanned amount is always an estimate", "amountMethod");
  }
  if (requested === "measured") {
    if (unit === null || !isMeasureUnit(unit) || via === "count") {
      throw new DomainValidationError("a measured entry needs a weight or volume from a scale", "amountMethod");
    }
    if (via === "density") {
      throw new DomainValidationError("a converted volume isn't a measurement — weigh it in grams or ounces", "amountMethod");
    }
  }
  return requested;
}

/** Measured beats a label amount, which beats an estimate. */
export const AMOUNT_PRECEDENCE: Readonly<Record<AmountMethod, number>> = { measured: 3, label: 2, estimated: 1 };

/**
 * Whether a new entry may supersede an existing one: only a scan estimate is superseded, and only
 * by something more reliable (a weighed or label amount). An estimate never replaces a measurement.
 */
export function canSupersede(next: { amountMethod: AmountMethod }, prev: { source: FoodSource; amountMethod: AmountMethod }): boolean {
  return prev.source === "scan_estimate" && AMOUNT_PRECEDENCE[next.amountMethod] > AMOUNT_PRECEDENCE[prev.amountMethod];
}

/** Whether the entry's numbers are estimates (and must be labelled as such). */
export function isEstimate(e: { source: FoodSource; amountMethod: AmountMethod }): boolean {
  return e.source === "scan_estimate" || e.amountMethod === "estimated";
}

/** A sensible default meal for the local time of day; the user can always change it. */
export function defaultMealType(localHour: number): MealType {
  if (localHour >= 4 && localHour < 11) return "breakfast";
  if (localHour >= 11 && localHour < 15) return "lunch";
  if (localHour >= 17 && localHour < 22) return "dinner";
  return "snack";
}

// ---- Day totals ----------------------------------------------------------------------

export interface DayEntry extends Macros {
  mealType: MealType;
  source: FoodSource;
  amountMethod: AmountMethod;
}

export interface DayTotals extends Macros {
  entries: number;
  /** Share of calories (0–1) from estimated entries. The UI labels totals as estimates when > 0. */
  estimatedKcalShare: number;
  /** Share of calories (0–1) from scan estimates specifically. */
  scanKcalShare: number;
  /** Share of calories (0–1) from weighed (measured) entries. */
  measuredKcalShare: number;
}

/** Sums exact entry values and rounds once, for presentation. */
export function sumDay(entries: readonly DayEntry[]): DayTotals {
  const t = { estimated: 0, scan: 0, measured: 0 };
  for (const e of entries) {
    if (isEstimate(e)) t.estimated += e.kcal;
    if (e.source === "scan_estimate") t.scan += e.kcal;
    if (e.amountMethod === "measured") t.measured += e.kcal;
  }
  const sum = sumNutrients(entries);
  const share = (x: number) => (sum.kcal === 0 ? 0 : Math.round((x / sum.kcal) * 100) / 100);
  return {
    ...presentMacros(sum),
    entries: entries.length,
    estimatedKcalShare: share(t.estimated),
    scanKcalShare: share(t.scan),
    measuredKcalShare: share(t.measured),
  };
}

export interface MacroTargets {
  targetKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  safeFloorKcal: number;
}

export interface NutrientProgress {
  consumed: number;
  target: number;
  /** Still to go (never negative). */
  remaining: number;
  /** Beyond the target (never negative). */
  over: number;
  /** consumed / target, 0–∞. */
  fraction: number;
}

function progress(consumed: number, target: number): NutrientProgress {
  return {
    consumed,
    target,
    remaining: Math.max(0, round1(target - consumed)),
    over: Math.max(0, round1(consumed - target)),
    fraction: target > 0 ? Math.round((consumed / target) * 1000) / 1000 : 0,
  };
}

export interface NutritionDaySummary {
  totals: DayTotals;
  byMeal: Record<MealType, DayTotals>;
  /** Null until the user has a body profile (no targets). */
  progress: { kcal: NutrientProgress; proteinG: NutrientProgress; carbsG: NutrientProgress; fatG: NutrientProgress } | null;
  water: NutrientProgress;
}

/** One authoritative summary for a day — used by Eat, Home and the coach context alike. */
export function summarizeNutritionDay(entries: readonly DayEntry[], targets: MacroTargets | null, water: { totalMl: number; targetMl: number }): NutritionDaySummary {
  const totals = sumDay(entries);
  const byMeal = Object.fromEntries(MEAL_TYPES.map((m) => [m, sumDay(entries.filter((e) => e.mealType === m))])) as Record<MealType, DayTotals>;
  return {
    totals,
    byMeal,
    progress: targets
      ? {
          kcal: progress(totals.kcal, targets.targetKcal),
          proteinG: progress(totals.proteinG, targets.proteinG),
          carbsG: progress(totals.carbsG, targets.carbsG),
          fatG: progress(totals.fatG, targets.fatG),
        }
      : null,
    water: progress(water.totalMl, water.targetMl),
  };
}

/** Validates macros typed in by hand (manual source). Kept as typed — rounding is for display only. */
export function manualMacros(m: Macros): Macros {
  validateMacros(m);
  assertEnergyConsistent(m);
  return { kcal: m.kcal, proteinG: m.proteinG, carbsG: m.carbsG, fatG: m.fatG };
}
