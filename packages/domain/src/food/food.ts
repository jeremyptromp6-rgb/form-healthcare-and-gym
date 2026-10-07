import type { AmountBasis, Serving } from "../nutrition/units";
import type { Macros } from "../nutrition/nutritionCalculator";
import type { Allergen, DietPreference } from "../users/profileOptions";
import { assessFood, type FoodAssessment } from "./foodAssessment";
import type { PersonalizationProfile } from "../personalization/personalization";

/**
 * Food boundary: food items and how they may be recommended. Camera recognition (./scan.ts) only
 * ever produces estimates; a weight read from a scale (./scale.ts, or typed by the user) is the
 * only measurement.
 */

export interface FoodItem {
  id: string;
  name: string;
  brand: string | null;
  /** Nutrition is per 100 g (solids) or per 100 ml (drinks). */
  basis: AmountBasis;
  per100: Macros;
  servings: Serving[];
  /** Density (g per ml) when known — lets cups/spoons convert to grams and drinks be weighed. */
  gramsPerMl?: number;
  origin: "verified_database" | "user_food";
  /** Known allergens. `undefined` means unknown (never "none") — e.g. user-created foods. */
  allergens?: Allergen[];
  /** Diet restrictions the food is known to satisfy. `undefined` means unknown. */
  suitableFor?: DietPreference[];
}

// Food recognition (scan) lives in ./scan.ts — FoodRecognitionProvider and the review pipeline.

// Weighing (a connected scale) lives in ./scale.ts — ScaleProvider and the stable-reading state machine.

// Meal planning lives in ../meals/planner.ts (generateMealPlan over real structured recipes).

/**
 * The only way a recommender may pick foods: anything excluded by an allergy, a custom allergy
 * or a diet restriction is removed — hard exclusions, never ranked lower. Foods whose allergen
 * or diet data is unknown are kept but marked for caution (the UI must say "check the label").
 */
export function recommendableFoods<T extends FoodItem>(foods: readonly T[], p: PersonalizationProfile): { food: T; assessment: FoodAssessment }[] {
  return foods
    .map((food) => ({ food, assessment: assessFood(food, p) }))
    .filter((x) => x.assessment.verdict !== "excluded")
    .sort((a, b) => Number(a.assessment.disliked) - Number(b.assessment.disliked) || Number(a.assessment.verdict === "caution") - Number(b.assessment.verdict === "caution"));
}

/** A plan must never go below the safe minimum on any day (no rewarding starvation). */
export function planRespectsSafeFloor(dayKcal: readonly number[], safeFloorKcal: number): boolean {
  return dayKcal.every((k) => k >= safeFloorKcal);
}
