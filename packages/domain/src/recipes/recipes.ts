import { assertFiniteInRange, assertInteger } from "../shared/errors";
import { nutrientsFor, presentMacros, sumNutrients } from "../nutrition/calculation";
import type { Macros } from "../nutrition/nutritionCalculator";

/** Recipes: ingredients by measured weight; nutrition per serving is always computed, never typed in. */

export interface RecipeIngredient {
  name: string;
  grams: number;
  per100g: Macros;
}

export interface Recipe {
  id: string;
  title: string;
  servings: number;
  ingredients: RecipeIngredient[];
}

export function recipeMacrosPerServing(recipe: Pick<Recipe, "servings" | "ingredients">): Macros {
  assertInteger(recipe.servings, "servings");
  assertFiniteInRange(recipe.servings, 1, 100, "servings");
  // Exact per-ingredient nutrition, summed, divided, rounded once for display.
  const total = sumNutrients(recipe.ingredients.map((ing) => nutrientsFor(ing.per100g, ing.grams)));
  const n = recipe.servings;
  return presentMacros({ kcal: total.kcal / n, proteinG: total.proteinG / n, carbsG: total.carbsG / n, fatG: total.fatG / n });
}
