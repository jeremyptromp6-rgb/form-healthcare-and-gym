import { describe, expect, it } from "vitest";
import { prefsFixture, profileFixture } from "./fixtures";
import {
  addDays,
  createUnconfiguredProviders,
  featureAvailability,
  isDateKey,
  onboardingStatus,
  providerStatuses,
  recipeMacrosPerServing,
  sanitizeAnalyticsEvent,
  sumXp,
  targetForDate,
  validateAchievementDefinition,
  validateBodyQuestPlan,
  validateQuestDefinition,
  type BodyQuestPlan,
} from "../src";

describe("dates", () => {
  it("validates and shifts date keys across month and leap boundaries", () => {
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2027-02-29")).toBe(false);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("analytics privacy filter", () => {
  it("drops unknown events", () => {
    expect(sanitizeAnalyticsEvent("weight_logged", {})).toBeNull();
  });

  it("drops sensitive and malformed properties", () => {
    const e = sanitizeAnalyticsEvent("workout_logged", {
      exercise_count: 3,
      weight_kg: 80,
      body_fat: 20,
      email: "a@b.c",
      pain_level: "serious",
      source: "manual",
      "Bad Key": 1,
      nested: { a: 1 },
      nan: Number.NaN,
    });
    expect(e).toEqual({ name: "workout_logged", props: { exercise_count: 3, source: "manual" } });
  });
});

describe("quest and achievement safety", () => {
  it("accepts a healthy quest and rejects excessive targets", () => {
    const ok = { id: "daily_session", title: "Train today", cadence: "daily" as const, metric: "workouts_completed" as const, target: 1, xpReward: 20 };
    expect(validateQuestDefinition(ok)).toEqual([]);
    expect(validateQuestDefinition({ ...ok, target: 2 })).toContain("target_out_of_range");
    expect(validateQuestDefinition({ ...ok, cadence: "weekly", target: 7 })).toContain("target_out_of_range"); // no rest day
    expect(validateQuestDefinition({ ...ok, xpReward: 5000 })).toContain("reward_out_of_range");
  });

  it("rejects metrics that could reward restriction", () => {
    expect(validateQuestDefinition({ id: "x", title: "x", cadence: "daily", metric: "calorie_deficit" as never, target: 1, xpReward: 10 })).toContain("unknown_metric");
  });

  it("validates achievement definitions", () => {
    const a = { id: "first_workout", title: "First step", description: "Finish a workout", metric: "workouts_completed" as const, threshold: 1, xpReward: 50 };
    expect(validateAchievementDefinition(a)).toEqual([]);
    expect(validateAchievementDefinition({ ...a, threshold: 0 })).toContain("threshold_out_of_range");
  });
});

describe("Body Quest plan safety", () => {
  const plan: BodyQuestPlan = {
    goal: "lose_fat",
    startDate: "2026-09-27",
    targetDate: "2026-12-20", // 12 weeks
    startWeightKg: 90,
    targetWeightKg: 84,
    heightCm: 180,
    ageYears: 30,
  };

  it("accepts a sustainable fat-loss plan", () => {
    const r = validateBodyQuestPlan(plan);
    expect(r).toEqual({ ok: true, issues: [], weeklyChangeKg: -0.5 });
  });

  it("rejects crash dieting, underweight targets, minors and too-short plans", () => {
    expect(validateBodyQuestPlan({ ...plan, targetWeightKg: 70 }).issues).toContain("loss_rate_unsafe");
    expect(validateBodyQuestPlan({ ...plan, targetWeightKg: 55, targetDate: "2027-09-01" }).issues).toContain("target_underweight");
    expect(validateBodyQuestPlan({ ...plan, ageYears: 16 }).issues).toContain("minor_weight_loss");
    expect(validateBodyQuestPlan({ ...plan, targetDate: "2026-10-10" }).issues).toContain("too_short");
    expect(validateBodyQuestPlan({ ...plan, targetWeightKg: 95 }).issues).toContain("wrong_direction");
  });

  it("caps muscle-gain rate and maintain range", () => {
    expect(validateBodyQuestPlan({ ...plan, goal: "build_muscle", targetWeightKg: 100 }).issues).toContain("gain_rate_unsafe");
    expect(validateBodyQuestPlan({ ...plan, goal: "maintain", targetWeightKg: 86 }).issues).toContain("maintain_range");
  });

  it("rejects impossible measurements", () => {
    expect(validateBodyQuestPlan({ ...plan, startWeightKg: Number.NaN }).issues).toEqual(["invalid_measurements"]);
  });
});

describe("nutrition target snapshots", () => {
  it("picks the snapshot in force on a date", () => {
    const targets = [
      { effectiveFrom: "2026-09-01", targetKcal: 2000 },
      { effectiveFrom: "2026-09-20", targetKcal: 2400 },
    ];
    expect(targetForDate(targets, "2026-08-31")).toBeNull();
    expect(targetForDate(targets, "2026-09-19")?.targetKcal).toBe(2000);
    expect(targetForDate(targets, "2026-09-20")?.targetKcal).toBe(2400);
  });
});

describe("recipes", () => {
  it("computes per-serving macros from weighed ingredients", () => {
    const m = recipeMacrosPerServing({
      servings: 2,
      ingredients: [
        { name: "Rice", grams: 200, per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 } },
        { name: "Chicken", grams: 300, per100g: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 } },
      ],
    });
    expect(m).toEqual({ kcal: 378, proteinG: 49.2, carbsG: 28, fatG: 5.7 });
    expect(() => recipeMacrosPerServing({ servings: 0, ingredients: [] })).toThrow();
  });
});

describe("onboarding, ledger and feature availability", () => {
  it("reports onboarding status", () => {
    expect(onboardingStatus(null, null)).toEqual({ completed: false, remaining: ["goal", "body", "training", "nutrition", "habits"], nextStep: "goal" });
    expect(onboardingStatus(profileFixture({ onboardingCompletedAt: "2026-09-27T00:00:00Z" }), prefsFixture()).completed).toBe(true);
  });

  it("sums the XP ledger", () => {
    expect(sumXp([{ xp: 35 }, { xp: 5 }, { xp: 0 }])).toBe(40);
  });

  it("marks features unavailable when providers are unconfigured or engines are not built", () => {
    const f = featureAvailability(providerStatuses(createUnconfiguredProviders()));
    expect(f.pro_purchase).toEqual({ available: false, reason: "provider_unconfigured" });
    // Pose runs on the device; the server only verifies traces, so it needs no provider.
    expect(f.camera_verification).toEqual({ available: true });
    expect(f.quests).toEqual({ available: true }); // quest engine shipped in Stage C
    expect(f.achievements).toEqual({ available: true });
    expect(f.body_quest).toEqual({ available: true });
    expect(f.ai_coach).toEqual({ available: false, reason: "provider_unconfigured" });
  });

  it("marks a built feature available once its provider is ready", () => {
    const statuses = providerStatuses(createUnconfiguredProviders()).map((s) => (s.kind === "billing" ? { kind: "billing" as const, state: "ready" as const, provider: "test" } : s));
    expect(featureAvailability(statuses).pro_purchase).toEqual({ available: true });
  });
});
