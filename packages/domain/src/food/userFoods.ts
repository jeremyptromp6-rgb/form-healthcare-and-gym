import { assertFiniteInRange, DomainValidationError } from "../shared/errors";
import { per100FromAmount } from "../nutrition/calculation";
import { assertEnergyConsistent, type Macros } from "../nutrition/nutritionCalculator";
import type { AmountBasis } from "../nutrition/units";
import type { FoodItem } from "./food";

/**
 * User-created foods, usually typed from a package label: nutrition per serving plus the
 * serving size. Stored per 100 g/ml like every other food so portions work the same way.
 * Allergen and diet data are unknown (not "none") — recommenders treat them with caution.
 */

export interface UserFoodInput {
  name: string;
  brand?: string | null;
  basis: AmountBasis;
  servingLabel: string;
  /** Serving size in g or ml (the basis). */
  servingAmount: number;
  perServing: Macros;
}

export const USER_FOOD_LIMITS = { nameLength: 80, brandLength: 60, servingLabelLength: 40, maxServingAmount: 2000, maxFoods: 500 } as const;

/** Per-100 nutrition from a label (NutritionCalculator, full precision), rejecting impossible labels. */
export function per100FromServing(perServing: Macros, servingAmount: number): Macros {
  assertFiniteInRange(servingAmount, 1, USER_FOOD_LIMITS.maxServingAmount, "servingAmount");
  const per100 = per100FromAmount(perServing, servingAmount);
  // Physically impossible labels (more than pure fat per gram, macros heavier than the food) are typos.
  if (per100.kcal > 950) throw new DomainValidationError("more calories than pure fat — check the serving size", "perServing");
  if (per100.proteinG + per100.carbsG + per100.fatG > 105) throw new DomainValidationError("macros weigh more than the serving — check the numbers", "perServing");
  return per100;
}

export function buildUserFood(id: string, input: UserFoodInput): FoodItem {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > USER_FOOD_LIMITS.nameLength) throw new DomainValidationError("name is required (max 80 characters)", "name");
  assertEnergyConsistent(input.perServing);
  const label = input.servingLabel.trim() || `1 serving (${input.servingAmount} ${input.basis})`;
  return {
    id,
    name,
    brand: input.brand?.trim() || null,
    basis: input.basis,
    per100: per100FromServing(input.perServing, input.servingAmount),
    servings: [{ id: "s1", label: label.slice(0, USER_FOOD_LIMITS.servingLabelLength), amount: input.servingAmount, kind: "serving" }],
    origin: "user_food",
  };
}
