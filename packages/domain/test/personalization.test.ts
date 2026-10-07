import { describe, expect, it } from "vitest";
import {
  activityForTrainingDays,
  assessFood,
  bodyProfileOf,
  buildPersonalization,
  calculateTargets,
  deriveProfileFields,
  DomainValidationError,
  energyGoalFor,
  goalOn,
  normalizeFoodList,
  normalizeNutritionPreferences,
  onboardingStatus,
  PRIMARY_GOALS,
  validateDietPreferences,
} from "../src";
import { prefsFixture, profileFixture } from "./fixtures";

describe("primary goals", () => {
  it("offers exactly the six product goals, each mapped to an energy strategy", () => {
    expect(PRIMARY_GOALS.map((g) => g.key)).toEqual(["build_muscle", "get_stronger", "lose_fat", "get_lean", "improve_fitness", "improve_health"]);
    expect(energyGoalFor("build_muscle")).toBe("gain");
    expect(energyGoalFor("lose_fat")).toBe("lose");
    expect(energyGoalFor("get_lean")).toBe("recomp");
    expect(energyGoalFor("improve_health")).toBe("maintain");
  });

  it("recomp is a gentler deficit than fat loss, and never applies to minors", () => {
    const body = { sex: "female" as const, ageYears: 28, heightCm: 168, weightKg: 70, activity: "moderate" as const };
    const lose = calculateTargets({ ...body, goal: "lose" });
    const recomp = calculateTargets({ ...body, goal: "recomp" });
    const maintain = calculateTargets({ ...body, goal: "maintain" });
    expect(recomp.targetKcal).toBeGreaterThan(lose.targetKcal);
    expect(recomp.targetKcal).toBeLessThan(maintain.targetKcal);
    expect(calculateTargets({ ...body, ageYears: 16, goal: "recomp" }).appliedGoal).toBe("maintain");
  });
});

describe("derived profile fields", () => {
  it("derives activity from training days and the energy goal from the primary goal", () => {
    expect(activityForTrainingDays(1)).toBe("light");
    expect(activityForTrainingDays(3)).toBe("moderate");
    expect(activityForTrainingDays(5)).toBe("active");
    expect(activityForTrainingDays(7)).toBe("very_active");
    expect(deriveProfileFields({ primaryGoal: "get_lean", trainingDaysPerWeek: 4, activity: null })).toEqual({ activity: "active", energyGoal: "recomp" });
  });

  it("keeps a legacy activity when training days are unknown", () => {
    expect(deriveProfileFields({ primaryGoal: null, trainingDaysPerWeek: null, activity: "light" })).toEqual({ activity: "light", energyGoal: null });
  });

  it("only produces calculator inputs once every body field is present", () => {
    expect(bodyProfileOf(profileFixture())).toMatchObject({ goal: "gain", activity: "active" });
    expect(bodyProfileOf(profileFixture({ weightKg: null }))).toBeNull();
  });
});

describe("nutrition preferences", () => {
  it("normalizes food lists: trims, lowercases, collapses spaces, de-duplicates", () => {
    expect(normalizeFoodList(["  Olives ", "olives", "BRUSSELS   sprouts", ""])).toEqual(["olives", "brussels sprouts"]);
  });

  it("bounds list length and item length", () => {
    expect(() => normalizeFoodList(Array.from({ length: 31 }, (_, i) => `food ${i}`))).toThrow(DomainValidationError);
    expect(() => normalizeFoodList(["x".repeat(41)])).toThrow(DomainValidationError);
  });

  it("rejects contradictory base diets but allows combining a diet with styles and religious rules", () => {
    expect(() => validateDietPreferences(["vegan", "pescatarian"])).toThrow(/only one/);
    expect(validateDietPreferences(["vegetarian", "halal", "high_protein", "vegetarian"])).toEqual(["vegetarian", "halal", "high_protein"]);
  });

  it("treats allergies and dislikes as different: an item in both stays an allergy", () => {
    const n = normalizeNutritionPreferences(prefsFixture({ allergens: ["peanuts"], customAllergies: ["Kiwi"], dislikedFoods: ["kiwi", "Peanuts", "olives"] }));
    expect(n.customAllergies).toEqual(["kiwi"]);
    expect(n.dislikedFoods).toEqual(["olives"]);
    expect(n.movedToAllergies).toEqual(["kiwi", "peanuts"]);
  });
});

describe("food assessment — allergy vs dislike", () => {
  const personalize = (prefs = prefsFixture()) =>
    buildPersonalization({ asOf: "2026-09-27", profile: profileFixture(), preferences: prefs, goalHistory: [] });

  it("excludes food containing a declared allergen", () => {
    const p = personalize(prefsFixture({ allergens: ["peanuts"] }));
    const r = assessFood({ name: "Satay chicken", allergens: ["peanuts", "soy"] }, p);
    expect(r).toMatchObject({ verdict: "excluded", reasons: ["allergen"], matchedAllergens: ["peanuts"] });
  });

  it("keeps disliked food allowed but flagged, never excluded", () => {
    const p = personalize(prefsFixture({ dislikedFoods: ["olive"] }));
    const r = assessFood({ name: "Greek salad", ingredients: ["olives", "feta"], allergens: ["milk"] }, p);
    expect(r).toEqual({ verdict: "ok", reasons: [], matchedAllergens: [], disliked: true });
  });

  it("matches custom allergies in names and ingredients, including plurals", () => {
    const p = personalize(prefsFixture({ customAllergies: ["kiwi"] }));
    expect(assessFood({ name: "Fruit salad", ingredients: ["kiwis", "mango"], allergens: [] }, p).verdict).toBe("excluded");
    expect(assessFood({ name: "Kiwiberry jam", allergens: [] }, p).verdict).toBe("ok"); // different word
  });

  it("is cautious when allergen data is unknown and the user has allergies", () => {
    const p = personalize(prefsFixture({ allergens: ["sesame"] }));
    expect(assessFood({ name: "Mystery bowl" }, p)).toMatchObject({ verdict: "caution", reasons: ["allergen_data_unknown"] });
    expect(assessFood({ name: "Mystery bowl" }, personalize()).verdict).toBe("ok");
  });

  it("enforces diet restrictions but not diet styles", () => {
    const p = personalize(prefsFixture({ dietaryPreferences: ["vegetarian", "low_carb"] }));
    expect(assessFood({ name: "Steak", allergens: [], suitableFor: ["gluten_free"] }, p).verdict).toBe("excluded");
    expect(assessFood({ name: "Pasta", allergens: ["gluten"], suitableFor: ["vegetarian"] }, p).verdict).toBe("ok");
    expect(assessFood({ name: "Stew", allergens: [] }, p).verdict).toBe("caution");
  });
});

describe("onboarding status", () => {
  it("resumes at the first unanswered step", () => {
    expect(onboardingStatus(profileFixture({ experience: null }), null)).toMatchObject({ completed: false, remaining: ["training", "nutrition", "habits"], nextStep: "training" });
  });

  it("counts saved-but-empty nutrition preferences as answered, and goes to review when all are answered", () => {
    const s = onboardingStatus(profileFixture(), prefsFixture());
    expect(s).toEqual({ completed: false, remaining: [], nextStep: "review" });
  });

  it("requires cooking time and budget for the habits step", () => {
    expect(onboardingStatus(profileFixture(), prefsFixture({ foodBudget: null })).remaining).toEqual(["habits"]);
  });

  it("requires at least one piece of equipment", () => {
    expect(onboardingStatus(profileFixture({ equipment: [] }), prefsFixture()).remaining).toEqual(["training"]);
  });
});

describe("personalization and goal history", () => {
  const history = [
    { primaryGoal: "lose_fat" as const, effectiveFrom: "2026-09-01" },
    { primaryGoal: "build_muscle" as const, effectiveFrom: "2026-10-01" },
  ];

  it("resolves the goal in force on any date", () => {
    expect(goalOn(history, "2026-08-31")).toBeNull();
    expect(goalOn(history, "2026-09-15")).toBe("lose_fat");
    expect(goalOn(history, "2026-10-01")).toBe("build_muscle");
  });

  it("a goal change shapes future recommendations without changing past ones", () => {
    const past = buildPersonalization({ asOf: "2026-09-15", profile: profileFixture(), preferences: prefsFixture(), goalHistory: history });
    const future = buildPersonalization({ asOf: "2026-10-05", profile: profileFixture(), preferences: prefsFixture(), goalHistory: history });
    expect(past.goal).toEqual({ primary: "lose_fat", energy: "lose", since: "2026-09-01" });
    expect(future.goal).toEqual({ primary: "build_muscle", energy: "gain", since: "2026-10-01" });
  });

  it("splits hard constraints from soft preferences", () => {
    const p = buildPersonalization({
      asOf: "2026-09-27",
      profile: profileFixture(),
      preferences: prefsFixture({ dietaryPreferences: ["vegan", "mediterranean"], allergens: ["soy"], dislikedFoods: ["tofu"], cookingTime: "under_15" }),
      goalHistory: [],
    });
    expect(p.nutrition.hard).toEqual({ allergens: ["soy"], customAllergies: [], dietRestrictions: ["vegan"] });
    expect(p.nutrition.soft).toEqual({ dislikedFoods: ["tofu"], dietStyles: ["mediterranean"], maxCookingMinutes: 15, budget: "medium" });
  });

  it("reports missing answers and minor safety flags", () => {
    const p = buildPersonalization({ asOf: "2026-09-27", profile: profileFixture({ ageYears: 15, trainingLocation: null }), preferences: null, goalHistory: [] });
    expect(p.missing).toEqual(["training", "nutrition", "habits"]);
    expect(p.safety).toEqual({ isMinor: true, noWeightLossTargets: true });
    expect(p.training.equipment).toEqual(["barbell", "dumbbells"]);
  });
});
