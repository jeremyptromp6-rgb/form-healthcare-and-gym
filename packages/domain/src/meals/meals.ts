import type { MealType } from "../nutrition/foodLog";
import type { DateKey } from "../shared/dates";

/**
 * Meal plans. A plan is a set of planned meals over one day or one week. "Planned" and "eaten" are
 * different facts: a meal becomes eaten only when the user says so (which logs it as food) — never
 * because it was on the plan.
 */

export type MealSlot = MealType;

export const PLAN_SLOTS: readonly MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** Share of the day's energy each slot aims for. */
export const SLOT_SHARE: Readonly<Record<MealSlot, number>> = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1 };

/** Portion sizes a plan uses, in servings of the recipe. */
export const SERVING_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5] as const;

export const PLAN_LIMITS = {
  /** Plan length options: a day or a week. */
  lengths: [1, 7] as readonly number[],
  maxServings: 2.5,
  minServings: 0.5,
  /** A recipe appears at most this often in one plan (repeats are fine, monotony isn't). */
  maxUsesPerRecipe: 3,
  maxMealsPerDay: 8,
} as const;

export type PlannedMealStatus = "planned" | "eaten";

export interface PlannedMeal {
  id: string;
  date: DateKey;
  slot: MealSlot;
  recipeId: string;
  /** Portions of one recipe serving (1 = one serving). */
  servings: number;
  status: PlannedMealStatus;
  /** The food log created when the user marked it eaten. */
  foodLogId: string | null;
}

export interface MealPlan {
  id: string;
  startDate: DateKey;
  days: number;
  meals: PlannedMeal[];
}
