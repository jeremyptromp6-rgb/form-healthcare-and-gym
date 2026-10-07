import type { DateKey } from "../shared/dates";
import type { AmountMethod, FoodSource, MealType } from "./foodLog";
import type { AmountBasis, FoodUnit } from "./units";
import type { Macros, NutritionTargets } from "./nutritionCalculator";

/** FoodLog and NutritionTarget models. */

export interface FoodLog extends Macros {
  id: string;
  userId: string;
  /** Client-generated idempotency key; unique per user. Null for entries logged before Stage G. */
  clientLogId: string | null;
  /** The user's local day this entry counts toward. */
  localDate: DateKey;
  mealType: MealType;
  /** When it was eaten/logged (UTC instant). */
  loggedAt: string;
  name: string;
  brand: string | null;
  /** Catalog id (verified database or user food), when logged from one. */
  foodId: string | null;
  source: FoodSource;
  amountMethod: AmountMethod;
  quantity: number | null;
  unit: FoodUnit | null;
  servingId: string | null;
  servingLabel: string | null;
  /** Resolved amount in g or ml, when known. */
  amount: number | null;
  amountUnit: AmountBasis | null;
  /** Nutrition per 100 g/ml at the time of logging — edits recompute from this, not the live catalog. */
  per100: Macros | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A snapshot of the targets in force from `effectiveFrom` onward. Past days are always
 * judged against the snapshot that applied on that day, so editing a profile never
 * rewrites history.
 */
export interface NutritionTarget extends Omit<NutritionTargets, "notes"> {
  effectiveFrom: DateKey;
}

/** The snapshot in force on `date`: the latest one that started on or before it. */
export function targetForDate<T extends { effectiveFrom: DateKey }>(targets: readonly T[], date: DateKey): T | null {
  let best: T | null = null;
  for (const t of targets) {
    if (t.effectiveFrom <= date && (best === null || t.effectiveFrom > best.effectiveFrom)) best = t;
  }
  return best;
}
