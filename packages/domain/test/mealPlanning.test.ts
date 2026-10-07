import { describe, expect, it } from "vitest";
import {
  addDays,
  aggregateGroceries,
  buildPersonalization,
  customGroceryItem,
  DomainValidationError,
  eligibleRecipes,
  EMPTY_NUTRITION_PREFERENCES,
  formatGroceryAmount,
  generateMealPlan,
  groceryAmountText,
  groceryNeedsFor,
  libraryRecipe,
  mealAlternatives,
  nutrientsFor,
  planRespectsSafeFloor,
  PlanGenerationError,
  portionNutrients,
  presentMacros,
  RECIPE_LIBRARY,
  scaledIngredients,
  sumNutrients,
  verifiedFood,
  type NutritionPreferences,
  type PlanTargets,
} from "../src";

const people = (prefs: Partial<NutritionPreferences> = {}) =>
  buildPersonalization({ asOf: "2026-09-30", profile: null, preferences: { ...EMPTY_NUTRITION_PREFERENCES, ...prefs }, goalHistory: [] });
const TARGETS: PlanTargets = { kcal: 2400, proteinG: 160, carbsG: 260, fatG: 80, safeFloorKcal: 1700 };
const week = Array.from({ length: 7 }, (_, i) => addDays("2026-10-01", i));
const plan = (prefs: Partial<NutritionPreferences> = {}, targets = TARGETS, dates = week) =>
  generateMealPlan({ dates, targets, personalization: people(prefs), recipes: RECIPE_LIBRARY, seed: "user-1" });
const recipesIn = (p: ReturnType<typeof plan>) => p.days.flatMap((d) => d.meals.map((m) => libraryRecipe(m.recipeId)!));

describe("recipe library: real structured data, nutrition from the NutritionCalculator", () => {
  it("every recipe is built only from verified foods; nutrition is computed, never typed in", () => {
    expect(RECIPE_LIBRARY.length).toBeGreaterThanOrEqual(25);
    for (const r of RECIPE_LIBRARY) {
      expect(r.source).toBe("form_library");
      expect(r.steps.length).toBeGreaterThan(0);
      const total = sumNutrients(r.ingredients.map((i) => nutrientsFor(verifiedFood(i.foodId)!.per100, i.unit === "ml" ? i.amount : i.amount)));
      expect(r.perServing.kcal).toBeCloseTo(total.kcal / r.servings, 6);
      expect(r.perServing.kcal).toBeGreaterThan(50);
    }
  });

  it("per-serving numbers match a hand calculation", () => {
    const r = libraryRecipe("apple_peanut_butter")!; // 182 g apple + 32 g peanut butter, 1 serving
    expect(r.perServingDisplay).toEqual(presentMacros({ kcal: 52 * 1.82 + 588 * 0.32, proteinG: 0.3 * 1.82 + 25.1 * 0.32, carbsG: 13.8 * 1.82 + 19.6 * 0.32, fatG: 0.2 * 1.82 + 50.4 * 0.32 }));
    expect(r.perServingDisplay.kcal).toBe(283);
    expect(r.servingGrams).toBe(214);
  });

  it("allergens and diet suitability are derived from the ingredients", () => {
    expect(libraryRecipe("egg_fried_rice")!.allergens).toEqual(["eggs", "gluten", "soy"]);
    expect(libraryRecipe("red_lentil_soup")!.suitableFor).toEqual(expect.arrayContaining(["vegan", "gluten_free", "dairy_free"]));
    expect(libraryRecipe("overnight_oats_berries")!.suitableFor).not.toContain("vegan"); // milk, yogurt, honey
    expect(libraryRecipe("salmon_potato_broccoli")!.suitableFor).toContain("pescatarian");
  });

  it("scales ingredients to servings", () => {
    const r = libraryRecipe("beef_bolognese")!; // 4 servings, 400 g beef
    expect(scaledIngredients(r, 1).find((i) => i.foodId === "fdb:ground_beef_90_cooked")!.amount).toBe(100);
  });
});

describe("meal plan generation", () => {
  it("fills every slot, is deterministic, and aims at the targets", () => {
    const a = plan();
    const b = plan();
    expect(a).toEqual(b);
    expect(a.days).toHaveLength(7);
    for (const d of a.days) {
      expect(d.meals.map((m) => m.slot)).toEqual(expect.arrayContaining(["breakfast", "lunch", "dinner", "snack"]));
      expect(d.totals.kcal).toBeGreaterThanOrEqual(TARGETS.safeFloorKcal);
      expect(d.totals.kcal).toBeLessThanOrEqual(TARGETS.kcal * 1.1 + 1);
      expect(Math.abs(d.totals.kcal - TARGETS.kcal) / TARGETS.kcal).toBeLessThan(0.2);
    }
    const avgProtein = a.days.reduce((s, d) => s + d.totals.proteinG, 0) / 7;
    expect(avgProtein).toBeGreaterThan(TARGETS.proteinG * 0.6);
  });

  it("varies meals but allows sensible repeats", () => {
    const counts = new Map<string, number>();
    for (const r of recipesIn(plan())) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    expect(counts.size).toBeGreaterThan(12);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });

  it("allergies are hard exclusions — including custom allergies found in ingredient names", () => {
    const p = plan({ allergens: ["peanuts", "milk", "gluten"], customAllergies: ["garlic"] });
    for (const r of recipesIn(p)) {
      expect(r.allergens).not.toContain("peanuts");
      expect(r.allergens).not.toContain("milk");
      expect(r.allergens).not.toContain("gluten");
      expect(r.ingredients.some((i) => /garlic/i.test(i.name))).toBe(false);
    }
  });

  it("diet restrictions are hard exclusions", () => {
    for (const r of recipesIn(plan({ dietaryPreferences: ["vegan"] }))) expect(r.suitableFor).toContain("vegan");
    for (const r of recipesIn(plan({ dietaryPreferences: ["pescatarian", "gluten_free"] }))) {
      expect(r.suitableFor).toEqual(expect.arrayContaining(["pescatarian", "gluten_free"]));
    }
  });

  it("dislikes are preferences: avoided when there are alternatives, never an exclusion", () => {
    const withDislike = recipesIn(plan({ dislikedFoods: ["salmon", "tofu"] }));
    expect(withDislike.some((r) => r.ingredients.some((i) => /salmon|tofu/i.test(i.name)))).toBe(false);
    const fit = eligibleRecipes(RECIPE_LIBRARY, people({ dislikedFoods: ["salmon"] })).find((f) => f.recipe.id === "salmon_potato_broccoli")!;
    expect(fit.disliked).toBe(true); // still eligible — just ranked lower
  });

  it("cooking time and budget shape the plan softly", () => {
    const quick = recipesIn(plan({ cookingTime: "under_15" }));
    expect(quick.filter((r) => r.totalMinutes > 15).length / quick.length).toBeLessThan(0.5);
    const cheap = recipesIn(plan({ foodBudget: "low" }));
    expect(cheap.filter((r) => r.costTier > 1.6).length / cheap.length).toBeLessThan(0.5);
  });

  it("diet styles nudge the ranking (high protein)", () => {
    const hp = plan({ dietaryPreferences: ["high_protein"] });
    const base = plan();
    const avg = (p: ReturnType<typeof plan>) => p.days.reduce((s, d) => s + d.totals.proteinG, 0) / p.days.length;
    expect(avg(hp)).toBeGreaterThanOrEqual(avg(base) - 1);
  });

  it("never plans a day below the safe floor, even for a small target", () => {
    const small: PlanTargets = { kcal: 1500, proteinG: 90, carbsG: 150, fatG: 50, safeFloorKcal: 1400 };
    const p = plan({}, small);
    expect(planRespectsSafeFloor(p.days.map((d) => d.totals.kcal), small.safeFloorKcal)).toBe(true);
  });

  it("refuses unusable targets, and says so when nothing fits", () => {
    expect(() => plan({}, { ...TARGETS, kcal: 1000, safeFloorKcal: 1500 })).toThrow(PlanGenerationError);
    expect(() =>
      plan({ allergens: ["peanuts", "tree_nuts", "milk", "eggs", "fish", "crustaceans", "soy", "gluten", "sesame"], customAllergies: ["onion", "garlic", "tomato", "oil", "apple", "banana", "lentils", "beans", "chickpeas", "pepper", "rice", "potato", "carrot", "spinach", "chicken", "cucumber"] }),
    ).toThrow(/no recipes fit/);
  });

  it("a daily plan works the same way", () => {
    const d = plan({}, TARGETS, ["2026-10-01"]);
    expect(d.days).toHaveLength(1);
    expect(d.days[0]!.meals.length).toBeGreaterThanOrEqual(4);
  });
});

describe("replacing a meal", () => {
  it("offers close, safe alternatives in the same slot, best first", () => {
    const current = { recipeId: "chicken_veg_stir_fry", servings: 1, slot: "dinner" as const };
    const alts = mealAlternatives({ current, recipes: RECIPE_LIBRARY, personalization: people({ allergens: ["fish"] }), limit: 5 });
    expect(alts.length).toBe(5);
    const target = portionNutrients(libraryRecipe("chicken_veg_stir_fry")!, 1).kcal;
    for (const a of alts) {
      const r = libraryRecipe(a.recipeId)!;
      expect(a.recipeId).not.toBe(current.recipeId);
      expect(r.slots).toContain("dinner");
      expect(r.allergens).not.toContain("fish");
    }
    expect(Math.abs(alts[0]!.nutrients.kcal - target) / target).toBeLessThan(0.15);
  });

  it("ranks by closeness in energy; extra protein costs little, missing protein a lot", () => {
    const alts = mealAlternatives({ current: { recipeId: "tofu_broccoli_stir_fry", servings: 1.5, slot: "dinner" }, recipes: RECIPE_LIBRARY, personalization: people(), limit: 5 });
    const kcalOff = alts.map((a) => Math.abs(a.kcalDelta));
    expect(kcalOff[0]).toBeLessThan(60);
    expect(alts.findIndex((a) => a.recipeId === "chicken_quinoa_bowl")).toBeLessThan(alts.findIndex((a) => a.recipeId === "garlic_shrimp_pasta") === -1 ? 99 : alts.findIndex((a) => a.recipeId === "garlic_shrimp_pasta"));
  });

  it("respects cooking time and dislikes where it can, and explains trade-offs", () => {
    const alts = mealAlternatives({ current: { recipeId: "red_lentil_soup", servings: 1, slot: "lunch" }, recipes: RECIPE_LIBRARY, personalization: people({ cookingTime: "under_15", dislikedFoods: ["tuna"] }), limit: 3 });
    expect(alts.every((a) => !a.notes.includes("Includes something you don't like"))).toBe(true);
    expect(alts[0]!.totalMinutes).toBeLessThanOrEqual(15);
  });
});

describe("grocery list", () => {
  it("aggregates the same food in the same unit only, grouped by aisle", () => {
    const needs = groceryNeedsFor([
      { recipeId: "beef_bolognese", servings: 2 },
      { recipeId: "lentil_bolognese", servings: 4 },
      { recipeId: "overnight_oats_berries", servings: 1 },
    ]);
    const tomatoes = needs.filter((n) => n.foodId === "fdb:tomatoes_canned");
    expect(tomatoes).toHaveLength(1);
    expect(tomatoes[0]!.amount).toBe(200 + 400); // half of one recipe + a whole one
    expect(needs.find((n) => n.foodId === "fdb:milk_skim")!.unit).toBe("ml");
    const aisles = needs.map((n) => n.aisle);
    expect(aisles).toEqual([...aisles].sort((a, b) => ["protein", "carbohydrates", "produce", "other"].indexOf(a) - ["protein", "carbohydrates", "produce", "other"].indexOf(b)));
    // Never merged across foods or units.
    const merged = aggregateGroceries([
      { foodId: "a", name: "A", amount: 100, unit: "g", aisle: "other" },
      { foodId: "a", name: "A", amount: 50, unit: "ml", aisle: "other" },
      { foodId: "b", name: "B", amount: 10, unit: "g", aisle: "other" },
      { foodId: "a", name: "A", amount: 25, unit: "g", aisle: "other" },
    ]);
    expect(merged.map((m) => [m.foodId, m.unit, m.amount])).toEqual([["a", "g", 125], ["a", "ml", 50], ["b", "g", 10]]);
  });

  it("formats practical shopping amounts", () => {
    expect(formatGroceryAmount(12, "g")).toBe("15 g");
    expect(formatGroceryAmount(333, "g")).toBe("340 g");
    expect(formatGroceryAmount(1234, "g")).toBe("1.3 kg");
    expect(formatGroceryAmount(1500, "ml")).toBe("1.5 L");
    expect(groceryAmountText(1100, "g", "fdb:egg_whole")).toBe("about 22 (1.1 kg)"); // 50 g eggs
    expect(groceryAmountText(236, "g", "fdb:banana")).toBe("about 2 (240 g)");
    expect(groceryAmountText(400, "g", "fdb:lentils_cooked")).toBe("400 g"); // not bought by the piece
  });

  it("custom items are validated", () => {
    expect(customGroceryItem({ name: "  Paper   towels ", quantity: " 2 rolls " })).toEqual({ name: "Paper towels", quantity: "2 rolls", aisle: "other" });
    expect(() => customGroceryItem({ name: "   " })).toThrow(DomainValidationError);
    expect(() => customGroceryItem({ name: "x".repeat(81) })).toThrow(DomainValidationError);
  });
});
