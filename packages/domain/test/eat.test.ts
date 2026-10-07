import { describe, expect, it } from "vitest";
import {
  buildNutritionContext,
  buildPersonalization,
  buildUserFood,
  calculateTargets,
  defaultMealType,
  DomainValidationError,
  EMPTY_NUTRITION_PREFERENCES,
  isEstimate,
  MACRO_RULES,
  per100FromServing,
  planRespectsSafeFloor,
  recommendableFoods,
  resolveAmountMethod,
  normalizePortion,
  nutrientsFor,
  presentMacros,
  searchFoods,
  summarizeNutritionDay,
  sumDay,
  targetsForUser,
  verifiedFood,
  VERIFIED_FOODS,
  type BodyProfile,
  type DayEntry,
  type UserProfile,
} from "../src";

const adult: BodyProfile = { sex: "male", ageYears: 30, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain" };
const food = (id: string) => verifiedFood(`fdb:${id}`)!;

describe("nutrition targets", () => {
  it("ordinary profiles are unchanged by the diet-context extension", () => {
    const t = calculateTargets(adult);
    expect(t).toMatchObject({ proteinG: 128, dietStyles: [] });
    expect(calculateTargets(adult, { styles: ["vegan", "halal"] })).toEqual(t); // restrictions never change targets
  });

  it("training frequency drives energy; goal drives the adjustment", () => {
    const light = calculateTargets({ ...adult, activity: "light" });
    const active = calculateTargets({ ...adult, activity: "very_active" });
    expect(active.targetKcal).toBeGreaterThan(light.targetKcal);
    expect(calculateTargets({ ...adult, goal: "gain" }).targetKcal).toBeGreaterThan(calculateTargets({ ...adult, goal: "lose" }).targetKcal);
  });

  it("high-protein style raises protein (capped); calories don't change", () => {
    const base = calculateTargets({ ...adult, goal: "lose" });
    const hp = calculateTargets({ ...adult, goal: "lose" }, { styles: ["high_protein"] });
    expect(hp.targetKcal).toBe(base.targetKcal);
    expect(hp.proteinG).toBe(Math.round(80 * MACRO_RULES.maxProteinPerKg));
    expect(hp.dietStyles).toEqual(["high_protein"]);
  });

  it("lower-carb style shifts energy from carbs to fat, keeping a carbohydrate floor", () => {
    const base = calculateTargets(adult);
    const lc = calculateTargets(adult, { styles: ["low_carb"] });
    expect(lc.carbsG).toBeLessThan(base.carbsG);
    expect(lc.fatG).toBeGreaterThan(base.fatG);
    const small = calculateTargets({ sex: "female", ageYears: 40, heightCm: 150, weightKg: 45, activity: "light", goal: "lose" }, { styles: ["low_carb", "high_protein"] });
    expect(small.carbsG).toBeGreaterThanOrEqual(MACRO_RULES.minCarbsG);
  });

  it("macros add up to the calorie target", () => {
    for (const styles of [[], ["high_protein"], ["low_carb"], ["high_protein", "low_carb"]]) {
      const t = calculateTargets(adult, { styles });
      expect(Math.abs(t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9 - t.targetKcal)).toBeLessThanOrEqual(15);
    }
  });

  it("protein uses an adjusted weight above BMI 30 (measurements matter)", () => {
    const heavy = calculateTargets({ ...adult, weightKg: 130 }); // BMI ≈ 40
    expect(heavy.proteinG).toBe(Math.round(MACRO_RULES.adjustedWeightBmi * 1.8 * 1.8 * 1.6));
    expect(heavy.notes.join(" ")).toMatch(/adjusted body weight/);
  });

  it("never targets below the safe floor, whatever the diet style", () => {
    const t = calculateTargets({ sex: "female", ageYears: 60, heightCm: 150, weightKg: 45, activity: "sedentary", goal: "lose" }, { styles: ["low_carb"] });
    expect(t.targetKcal).toBeGreaterThanOrEqual(t.safeFloorKcal);
  });

  it("targetsForUser combines the stored profile and diet preferences", () => {
    const profile = { sex: "male", ageYears: 30, heightCm: 180, weightKg: 80, activity: "moderate", energyGoal: "maintain" } as unknown as UserProfile;
    expect(targetsForUser(profile, { dietaryPreferences: ["high_protein"] })!.dietStyles).toEqual(["high_protein"]);
    expect(targetsForUser({ ...profile, weightKg: null } as UserProfile, null)).toBeNull();
  });
});

describe("serving calculations", () => {
  it("grams, ounces and named servings resolve to the food's basis", () => {
    const chicken = food("chicken_breast_cooked");
    expect(normalizePortion(chicken, { quantity: 150, unit: "g" })).toMatchObject({ amount: 150, amountUnit: "g", grams: 150, via: "mass", label: "150 g" });
    expect(normalizePortion(chicken, { quantity: 4, unit: "oz" }).amount).toBeCloseTo(113.398, 3);
    expect(normalizePortion(chicken, { quantity: 1.5, unit: "serving", servingId: "s1" })).toMatchObject({ amount: 258, via: "count", label: "1.5 × 1 breast (172 g)" });
    expect(presentMacros(nutrientsFor(chicken.per100, 150))).toEqual({ kcal: 248, proteinG: 46.5, carbsG: 0, fatG: 5.4 });
  });

  it("drinks are measured by volume; weight and volume cross only through a known density", () => {
    const milk = food("milk_whole");
    expect(normalizePortion(milk, { quantity: 8, unit: "fl_oz" }).amount).toBeCloseTo(236.588, 3);
    // Weighed milk converts through its density (1.03 g/ml).
    const weighed = normalizePortion(milk, { quantity: 206, unit: "g" });
    expect(weighed).toMatchObject({ grams: 206, via: "mass", densityGPerMl: 1.03 }); // weighing a drink is still a measurement
    expect(weighed.amount).toBeCloseTo(200, 9);
    // No density, no conversion.
    expect(() => normalizePortion(food("chicken_breast_cooked"), { quantity: 1, unit: "cup" })).toThrow(/measured by weight/);
  });

  it("rejects unknown servings, zero/negative quantities and absurd amounts", () => {
    const oats = food("oats_dry");
    expect(() => normalizePortion(oats, { quantity: 1, unit: "serving", servingId: "nope" })).toThrow(DomainValidationError);
    expect(() => normalizePortion(oats, { quantity: 0, unit: "g" })).toThrow(DomainValidationError);
    expect(() => normalizePortion(oats, { quantity: -5, unit: "g" })).toThrow(DomainValidationError);
    expect(() => normalizePortion(oats, { quantity: 6000, unit: "g" })).toThrow(DomainValidationError);
    expect(() => normalizePortion(oats, { quantity: 6, unit: "kg" })).toThrow(DomainValidationError);
    expect(() => normalizePortion(oats, { quantity: Number.NaN, unit: "g" })).toThrow(DomainValidationError);
  });
});

describe("estimated vs measured", () => {
  it("a scan is always an estimate", () => {
    expect(resolveAmountMethod("scan_estimate", "estimated", "g")).toBe("estimated");
    expect(() => resolveAmountMethod("scan_estimate", "measured", "g")).toThrow(/always an estimate/);
    expect(() => resolveAmountMethod("scan_estimate", "label", "serving")).toThrow(DomainValidationError);
  });

  it("measured needs a weight or volume, not a serving", () => {
    expect(resolveAmountMethod("verified_database", "measured", "g")).toBe("measured");
    expect(resolveAmountMethod("user_food", "measured", "fl_oz")).toBe("measured");
    expect(() => resolveAmountMethod("verified_database", "measured", "serving")).toThrow(/weight or volume/);
    expect(() => resolveAmountMethod("manual", "measured", null)).toThrow(DomainValidationError);
    expect(resolveAmountMethod("user_food", "label", "serving")).toBe("label");
  });

  it("estimates are flagged whichever way they arose", () => {
    expect(isEstimate({ source: "scan_estimate", amountMethod: "estimated" })).toBe(true);
    expect(isEstimate({ source: "manual", amountMethod: "estimated" })).toBe(true);
    expect(isEstimate({ source: "verified_database", amountMethod: "measured" })).toBe(false);
    expect(isEstimate({ source: "user_food", amountMethod: "label" })).toBe(false);
  });
});

describe("meals and day summary", () => {
  it("defaults the meal from the local hour", () => {
    expect([6, 10, 11, 14, 15, 17, 21, 22, 2].map(defaultMealType)).toEqual(["breakfast", "breakfast", "lunch", "lunch", "snack", "dinner", "dinner", "snack", "snack"]);
  });

  const entries: DayEntry[] = [
    { kcal: 400, proteinG: 30, carbsG: 50, fatG: 10, mealType: "breakfast", source: "verified_database", amountMethod: "measured" },
    { kcal: 700, proteinG: 45, carbsG: 80, fatG: 20, mealType: "lunch", source: "user_food", amountMethod: "label" },
    { kcal: 300, proteinG: 5, carbsG: 30, fatG: 15, mealType: "snack", source: "scan_estimate", amountMethod: "estimated" },
  ];
  const targets = { targetKcal: 2400, proteinG: 180, carbsG: 260, fatG: 75, safeFloorKcal: 1700 };

  it("totals by meal, remaining and over, and water progress", () => {
    const s = summarizeNutritionDay(entries, targets, { totalMl: 1800, targetMl: 3000 });
    expect(s.totals).toMatchObject({ kcal: 1400, proteinG: 80, entries: 3 });
    expect(s.byMeal.breakfast.kcal).toBe(400);
    expect(s.byMeal.dinner).toMatchObject({ kcal: 0, entries: 0 });
    expect(s.progress!.kcal).toMatchObject({ consumed: 1400, target: 2400, remaining: 1000, over: 0 });
    expect(s.water).toMatchObject({ consumed: 1800, target: 3000, remaining: 1200 });
    const over = summarizeNutritionDay([{ ...entries[1]!, kcal: 2600 }], targets, { totalMl: 0, targetMl: 2000 });
    expect(over.progress!.kcal).toMatchObject({ remaining: 0, over: 200 });
    expect(summarizeNutritionDay(entries, null, { totalMl: 0, targetMl: 2000 }).progress).toBeNull();
  });

  it("totals report how much is estimated vs measured", () => {
    expect(sumDay(entries)).toMatchObject({ estimatedKcalShare: 0.21, scanKcalShare: 0.21, measuredKcalShare: 0.29 });
  });
});

describe("foods: verified database, user foods, search", () => {
  it("every verified food's calories match its macros (4/4/9) — catches data typos", () => {
    for (const f of VERIFIED_FOODS) {
      const fromMacros = f.per100.proteinG * 4 + f.per100.carbsG * 4 + f.per100.fatG * 9;
      expect(Math.abs(fromMacros - f.per100.kcal), f.name).toBeLessThanOrEqual(Math.max(12, f.per100.kcal * 0.15));
    }
    expect(new Set(VERIFIED_FOODS.map((f) => f.id)).size).toBe(VERIFIED_FOODS.length);
  });

  it("allergens and diet suitability are explicit for verified foods", () => {
    expect(food("peanut_butter").allergens).toEqual(["peanuts"]);
    expect(food("salmon_cooked").suitableFor).toContain("pescatarian");
    expect(food("salmon_cooked").suitableFor).not.toContain("vegetarian");
    expect(food("lentils_cooked").suitableFor).toEqual(expect.arrayContaining(["vegan", "gluten_free"]));
    expect(food("greek_yogurt_nonfat").suitableFor).not.toContain("dairy_free");
  });

  it("user foods: per-serving label numbers become per-100, impossible labels are rejected", () => {
    const bar = buildUserFood("u1", { name: " Protein  bar ", brand: "Acme", basis: "g", servingLabel: "1 bar", servingAmount: 60, perServing: { kcal: 240, proteinG: 20, carbsG: 24, fatG: 8 } });
    expect(bar).toMatchObject({ name: "Protein bar", brand: "Acme", origin: "user_food" });
    expect(presentMacros(bar.per100)).toEqual({ kcal: 400, proteinG: 33.3, carbsG: 40, fatG: 13.3 });
    expect(bar.per100.proteinG).toBeCloseTo(33.3333, 4); // stored at full precision
    expect(bar.allergens).toBeUndefined(); // unknown, never "none"
    expect(normalizePortion(bar, { quantity: 2, unit: "serving", servingId: "s1" }).amount).toBe(120);
    expect(() => per100FromServing({ kcal: 900, proteinG: 0, carbsG: 0, fatG: 0 }, 10)).toThrow(/pure fat/);
    expect(() => per100FromServing({ kcal: 100, proteinG: 60, carbsG: 60, fatG: 0 }, 100)).toThrow(/weigh more/);
  });

  it("search matches word prefixes and ranks sensibly", () => {
    const mine = buildUserFood("u2", { name: "Chicken wrap", basis: "g", servingLabel: "1 wrap", servingAmount: 200, perServing: { kcal: 450, proteinG: 30, carbsG: 40, fatG: 15 } });
    const all = [...VERIFIED_FOODS, mine];
    expect(searchFoods(all, "chick bre").slice(0, 2).map((f) => f.name).sort()).toEqual(["Chicken breast, skinless, cooked", "Chicken breast, skinless, raw"]);
    expect(searchFoods(all, "chicken").map((f) => f.name)).toContain("Chicken wrap");
    expect(searchFoods(all, "ÉGG")[0]!.name).toMatch(/^Egg/);
    expect(searchFoods(all, "zzzz")).toEqual([]);
    expect(searchFoods(all, "   ")).toEqual([]);
    expect(searchFoods(all, "a", 5)).toHaveLength(5);
  });
});

describe("safety: allergies are hard exclusions; no starvation", () => {
  it("recommenders never get foods matching an allergy or restriction", () => {
    const p = buildPersonalization({ asOf: "2026-09-29", profile: null, preferences: { ...EMPTY_NUTRITION_PREFERENCES, allergens: ["peanuts", "fish"], dietaryPreferences: ["vegetarian"] }, goalHistory: [] });
    const ids = recommendableFoods(VERIFIED_FOODS, p).map((x) => x.food.id);
    expect(ids).not.toContain("fdb:peanut_butter");
    expect(ids).not.toContain("fdb:salmon_cooked");
    expect(ids).not.toContain("fdb:chicken_breast_cooked"); // vegetarian
    expect(ids).toContain("fdb:lentils_cooked");
    // User foods have unknown allergen data: kept only with a caution flag.
    const bar = buildUserFood("u1", { name: "Bar", basis: "g", servingLabel: "1 bar", servingAmount: 60, perServing: { kcal: 240, proteinG: 20, carbsG: 24, fatG: 8 } });
    expect(recommendableFoods([bar], p)[0]!.assessment.verdict).toBe("caution");
  });

  it("meal plans can't go below the safe minimum", () => {
    expect(planRespectsSafeFloor([1800, 1750], 1700)).toBe(true);
    expect(planRespectsSafeFloor([1800, 1200], 1700)).toBe(false);
  });

  it("the coach context aggregates only, and flags under-eating instead of rewarding it", () => {
    const t = { targetKcal: 2400, proteinG: 180, carbsG: 260, fatG: 75, safeFloorKcal: 1700 };
    const day = (date: string, kcal: number, proteinG = 100) => ({ date, totals: sumDay([{ kcal, proteinG, carbsG: 0, fatG: 0, mealType: "lunch" as const, source: "manual" as const, amountMethod: "estimated" as const }]) });
    const ctx = buildNutritionContext({
      today: "2026-09-29",
      days: [day("2026-09-29", 600), day("2026-09-28", 1100), day("2026-09-27", 2300, 170), day("2026-09-20", 900)],
      targets: t,
      water: { totalMl: 1500, targetMl: 3000 },
    });
    expect(ctx.last7Days).toEqual({ daysLogged: 3, averageKcal: 1700, averageProteinG: 135, daysMeetingProtein: 1, daysBelowSafeFloor: 1 });
    expect(ctx.today).toMatchObject({ kcal: 600, remainingKcal: 1800, waterMl: 1500, estimatedShare: 1 });
    expect(ctx.safetyNotes.join(" ")).toMatch(/never suggest eating less/);
    expect(JSON.stringify(ctx)).not.toMatch(/name|brand|chicken/i);
  });
});
