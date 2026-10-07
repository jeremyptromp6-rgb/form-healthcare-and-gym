import { EMPTY_NUTRITION_PREFERENCES, type NutritionPreferences, type UserProfile } from "../src";

export function profileFixture(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: "u1",
    displayName: null,
    primaryGoal: "build_muscle",
    sex: "male",
    ageYears: 30,
    heightCm: 180,
    weightKg: 80,
    experience: "intermediate",
    trainingDaysPerWeek: 4,
    trainingLocation: "gym",
    equipment: ["barbell", "dumbbells"],
    activity: "active",
    energyGoal: "gain",
    onboardingCompletedAt: null,
    updatedAt: "2026-09-27T00:00:00Z",
    ...overrides,
  };
}

export function prefsFixture(overrides: Partial<NutritionPreferences> = {}): NutritionPreferences {
  return { ...EMPTY_NUTRITION_PREFERENCES, cookingTime: "15_30", foodBudget: "medium", ...overrides };
}
