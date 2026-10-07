import { assessFood } from "../food/foodAssessment";
import { presentMacros, sumNutrients } from "../nutrition/calculation";
import type { Macros } from "../nutrition/nutritionCalculator";
import type { PersonalizationProfile } from "../personalization/personalization";
import { recipeAsFood, type LibraryRecipe } from "../recipes/library";
import type { DateKey } from "../shared/dates";
import type { FoodBudget } from "../users/profileOptions";
import { PLAN_LIMITS, PLAN_SLOTS, SERVING_STEPS, SLOT_SHARE, type MealSlot } from "./meals";

/**
 * MealPlanGenerator — deterministic and rule-based, over real structured recipes. Given the same
 * inputs it produces the same plan.
 *
 * Hard rules (never broken): allergies, custom allergies and diet restrictions exclude a recipe;
 * recipes whose safety can't be confirmed are left out too; every planned day reaches at least
 * the user's safe energy floor. Soft preferences (dislikes, cooking time, budget, diet styles,
 * variety) only change the ranking.
 */

export interface PlanTargets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  safeFloorKcal: number;
}

/** Budget preference → the highest relative cost tier that fits it (null = any). */
export const BUDGET_MAX_COST: Readonly<Record<FoodBudget, number | null>> = { low: 1.6, medium: 2.3, high: null };

export interface RecipeFit {
  recipe: LibraryRecipe;
  disliked: boolean;
  overTime: boolean;
  overBudget: boolean;
}

/** Recipes a user may be offered at all, with how well they fit the soft preferences. */
export function eligibleRecipes(recipes: readonly LibraryRecipe[], p: PersonalizationProfile): RecipeFit[] {
  const { maxCookingMinutes, budget } = p.nutrition.soft;
  const maxCost = budget ? BUDGET_MAX_COST[budget] : null;
  const out: RecipeFit[] = [];
  for (const recipe of recipes) {
    const a = assessFood(recipeAsFood(recipe), p);
    if (a.verdict !== "ok") continue; // excluded or unconfirmable: never planned
    out.push({
      recipe,
      disliked: a.disliked,
      overTime: maxCookingMinutes !== null && recipe.totalMinutes > maxCookingMinutes,
      overBudget: maxCost !== null && recipe.costTier > maxCost,
    });
  }
  return out;
}

/** Full-precision nutrition for a number of servings of a recipe. */
export function portionNutrients(recipe: LibraryRecipe, servings: number): Macros {
  const s = recipe.perServing;
  return { kcal: s.kcal * servings, proteinG: s.proteinG * servings, carbsG: s.carbsG * servings, fatG: s.fatG * servings };
}

export interface GeneratedMeal {
  date: DateKey;
  slot: MealSlot;
  recipeId: string;
  servings: number;
  nutrients: Macros;
}

export interface GeneratedDay {
  date: DateKey;
  meals: GeneratedMeal[];
  totals: Macros;
}

export interface GeneratedPlan {
  days: GeneratedDay[];
  warnings: string[];
}

export class PlanGenerationError extends Error {
  constructor(
    message: string,
    readonly code: "no_recipes_fit" | "invalid_targets",
  ) {
    super(message);
  }
}

/** FNV-1a — a stable, dependency-free hash for deterministic tie-breaking. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function softPenalty(fit: RecipeFit, p: PersonalizationProfile, n: Macros): number {
  let pen = 0;
  if (fit.disliked) pen += 3;
  if (fit.overTime) pen += 1;
  if (fit.overBudget) pen += 0.6;
  const styles = p.nutrition.soft.dietStyles;
  const kcal = Math.max(n.kcal, 1);
  if (styles.includes("high_protein") && (n.proteinG * 4) / kcal >= 0.3) pen -= 0.15;
  if (styles.includes("low_carb") && (n.carbsG * 4) / kcal > 0.45) pen += 0.2;
  if (styles.includes("mediterranean") && fit.recipe.styles.includes("mediterranean")) pen -= 0.1;
  return pen;
}

interface Choice {
  fit: RecipeFit;
  servings: number;
  nutrients: Macros;
  score: number;
}

function bestPortion(fit: RecipeFit, targetKcal: number, targetProtein: number, p: PersonalizationProfile): Choice {
  let best: Choice | null = null;
  for (const s of SERVING_STEPS) {
    if (s > 2) continue; // generation starts at ≤ 2 servings; the floor adjustment may go higher
    const n = portionNutrients(fit.recipe, s);
    const kcalErr = Math.abs(n.kcal - targetKcal) / targetKcal;
    const proteinGap = targetProtein > 0 ? Math.max(0, targetProtein - n.proteinG) / targetProtein : 0;
    const score = kcalErr + 0.5 * proteinGap + softPenalty(fit, p, n);
    if (!best || score < best.score) best = { fit, servings: s, nutrients: n, score };
  }
  return best!;
}

function validateTargets(t: PlanTargets): void {
  const ok = [t.kcal, t.proteinG, t.carbsG, t.fatG, t.safeFloorKcal].every((v) => Number.isFinite(v) && v >= 0) && t.kcal >= t.safeFloorKcal && t.kcal > 0;
  if (!ok) throw new PlanGenerationError("targets aren't usable for planning", "invalid_targets");
}

const nextStep = (s: number, dir: 1 | -1): number | null => {
  const steps = SERVING_STEPS as readonly number[];
  const i = steps.findIndex((x) => x >= s - 1e-9);
  const j = (i === -1 ? steps.length - 1 : i) + dir;
  return j >= 0 && j < steps.length ? steps[j]! : null;
};

/**
 * Builds a plan for the given dates. Each slot gets the recipe and portion that best fit its share
 * of the day's energy and protein, preferences and variety; then each day is adjusted so it never
 * falls below the safe floor and doesn't overshoot the target by much.
 */
export function generateMealPlan(input: {
  dates: readonly DateKey[];
  targets: PlanTargets;
  personalization: PersonalizationProfile;
  recipes: readonly LibraryRecipe[];
  /** Makes tie-breaks vary between users and plans while staying reproducible. */
  seed: string;
  slots?: readonly MealSlot[];
  /** Recipes the user saved: preferred when they fit as well (advanced planning). */
  favorites?: ReadonlySet<string>;
}): GeneratedPlan {
  const chosen = input.slots ?? PLAN_SLOTS;
  // Each slot's share of the day, renormalised over the slots being planned (e.g. only the meals left today).
  const shareSum = chosen.reduce((a, s) => a + SLOT_SHARE[s], 0);
  const share = (slot: MealSlot) => SLOT_SHARE[slot] / shareSum;
  validateTargets(input.targets);
  const p = input.personalization;
  const fits = eligibleRecipes(input.recipes, p);
  if (fits.length === 0) throw new PlanGenerationError("no recipes fit your allergies and diet restrictions yet", "no_recipes_fit");
  const slots = input.slots ?? PLAN_SLOTS;
  const warnings = new Set<string>();
  if (fits.length < 10) warnings.add(`Only ${fits.length} recipes fit your needs, so some meals repeat.`);
  const uses = new Map<string, number>();
  const days: GeneratedDay[] = [];

  for (const date of input.dates) {
    const meals: (GeneratedMeal & { fit: RecipeFit })[] = [];
    for (const slot of slots) {
      const target = input.targets.kcal * share(slot);
      const proteinTarget = input.targets.proteinG * share(slot);
      const options = fits.filter((f) => f.recipe.slots.includes(slot));
      if (options.length === 0) {
        warnings.add(`No ${slot} recipes fit your needs yet — that meal is left open.`);
        continue;
      }
      let best: Choice | null = null;
      for (const fit of options) {
        const c = bestPortion(fit, target, proteinTarget, p);
        const used = uses.get(fit.recipe.id) ?? 0;
        const variety = used * 0.45 + (used >= PLAN_LIMITS.maxUsesPerRecipe ? 5 : 0) + (meals.some((m) => m.recipeId === fit.recipe.id) ? 5 : 0);
        const jitter = (hash(`${input.seed}|${date}|${slot}|${fit.recipe.id}`) % 1000) / 1000 * 0.08;
        // A saved recipe wins a close call, never over safety, fit or variety.
        const favorite = input.favorites?.has(fit.recipe.id) ? -0.25 : 0;
        const score = c.score + variety + jitter + favorite;
        if (!best || score < best.score) best = { ...c, score };
      }
      uses.set(best!.fit.recipe.id, (uses.get(best!.fit.recipe.id) ?? 0) + 1);
      if (best!.fit.overTime) warnings.add("A few meals take longer than your usual cooking time — swap them if needed.");
      meals.push({ date, slot, recipeId: best!.fit.recipe.id, servings: best!.servings, nutrients: best!.nutrients, fit: best!.fit });
    }

    // Safety: never plan a day below the safe floor. Grow portions first, then add a snack.
    const total = () => sumNutrients(meals.map((m) => m.nutrients)).kcal;
    const resize = (m: (typeof meals)[number], s: number) => {
      m.servings = s;
      m.nutrients = portionNutrients(m.fit.recipe, s);
    };
    let guard = 0;
    while (meals.length > 0 && total() < input.targets.safeFloorKcal && guard++ < 40) {
      const growable = meals.filter((m) => nextStep(m.servings, 1) !== null).sort((a, b) => a.servings - b.servings);
      if (growable.length === 0) break;
      resize(growable[0]!, nextStep(growable[0]!.servings, 1)!);
    }
    if (total() < input.targets.safeFloorKcal) {
      const snack = fits.filter((f) => f.recipe.slots.includes("snack") && !f.disliked).sort((a, b) => b.recipe.perServing.kcal - a.recipe.perServing.kcal)[0];
      if (snack && meals.length < PLAN_LIMITS.maxMealsPerDay) {
        const needed = input.targets.safeFloorKcal - total();
        const s = (SERVING_STEPS as readonly number[]).find((x) => snack.recipe.perServing.kcal * x >= needed) ?? PLAN_LIMITS.maxServings;
        meals.push({ date, slot: "snack", recipeId: snack.recipe.id, servings: s, nutrients: portionNutrients(snack.recipe, s), fit: snack });
      }
    }
    // Comfort: trim an overshoot (> 10% over target) without crossing back under the floor.
    guard = 0;
    while (total() > input.targets.kcal * 1.1 && guard++ < 40) {
      const shrinkable = meals
        .map((m) => ({ m, s: nextStep(m.servings, -1) }))
        .filter((x) => x.s !== null && total() - (x.m.nutrients.kcal - portionNutrients(x.m.fit.recipe, x.s!).kcal) >= input.targets.safeFloorKcal)
        .sort((a, b) => b.m.nutrients.kcal - a.m.nutrients.kcal);
      if (shrinkable.length === 0) break;
      resize(shrinkable[0]!.m, shrinkable[0]!.s!);
    }
    if (meals.length > 0 && total() < input.targets.safeFloorKcal) warnings.add("Some days couldn't reach your safe minimum with the recipes available — add food to those days.");

    const clean = meals.map(({ fit: _f, ...m }) => m);
    days.push({ date, meals: clean, totals: sumNutrients(clean.map((m) => m.nutrients)) });
  }
  return { days, warnings: [...warnings] };
}

export interface MealAlternative {
  recipeId: string;
  title: string;
  servings: number;
  nutrients: Macros;
  display: Macros;
  /** Differences vs the meal being replaced (display-rounded). */
  kcalDelta: number;
  proteinDelta: number;
  totalMinutes: number;
  /** Soft-preference notes, if any ("takes longer than usual", "above your budget"). */
  notes: string[];
}

/**
 * Replacement candidates for a planned meal: same slot, still safe for the user, close in energy
 * and protein, and respecting cooking time, budget and dislikes where possible. Best first.
 */
export function mealAlternatives(input: {
  current: { recipeId: string; servings: number; slot: MealSlot };
  recipes: readonly LibraryRecipe[];
  personalization: PersonalizationProfile;
  limit?: number;
}): MealAlternative[] {
  const currentRecipe = input.recipes.find((r) => r.id === input.current.recipeId);
  const p = input.personalization;
  const fits = eligibleRecipes(input.recipes, p).filter((f) => f.recipe.id !== input.current.recipeId && f.recipe.slots.includes(input.current.slot));
  const target = currentRecipe ? portionNutrients(currentRecipe, input.current.servings) : null;
  const scored = fits.map((fit) => {
    let best: { servings: number; n: Macros; score: number } | null = null;
    for (const s of SERVING_STEPS) {
      const n = portionNutrients(fit.recipe, s);
      const kcalErr = target ? Math.abs(n.kcal - target.kcal) / Math.max(target.kcal, 1) : Math.abs(s - 1);
      // Less protein than the meal it replaces counts fully; more protein only a little.
      const diff = target ? n.proteinG - target.proteinG : 0;
      const proteinErr = target ? (diff < 0 ? -diff : diff * 0.3) / Math.max(target.proteinG, 10) : 0;
      const score = kcalErr + 0.5 * proteinErr + softPenalty(fit, p, n);
      if (!best || score < best.score) best = { servings: s, n, score };
    }
    return { fit, ...best! };
  });
  scored.sort((a, b) => a.score - b.score || a.fit.recipe.id.localeCompare(b.fit.recipe.id));
  return scored.slice(0, input.limit ?? 5).map((c) => {
    const display = presentMacros(c.n);
    const cur = target ? presentMacros(target) : display;
    const notes: string[] = [];
    if (c.fit.overTime) notes.push("Takes longer than your usual cooking time");
    if (c.fit.overBudget) notes.push("Above your usual budget");
    if (c.fit.disliked) notes.push("Includes something you don't like");
    return {
      recipeId: c.fit.recipe.id,
      title: c.fit.recipe.title,
      servings: c.servings,
      nutrients: c.n,
      display,
      kcalDelta: display.kcal - cur.kcal,
      proteinDelta: Math.round((display.proteinG - cur.proteinG) * 10) / 10,
      totalMinutes: c.fit.recipe.totalMinutes,
      notes,
    };
  });
}
