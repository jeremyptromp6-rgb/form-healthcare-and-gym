import type { ActivityLevel, Goal } from "../nutrition/nutritionCalculator";

/**
 * Profile option catalog — the single source for every choice onboarding and Profile offer.
 * The API serves it (GET /catalog/profile-options) so the app never hard-codes these lists.
 */

export const PRIMARY_GOALS = [
  { key: "build_muscle", label: "Build Muscle", description: "Add size with progressive training and enough fuel.", energyGoal: "gain" },
  { key: "get_stronger", label: "Get Stronger", description: "Lift heavier with focused strength work.", energyGoal: "maintain" },
  { key: "lose_fat", label: "Lose Fat", description: "Lose fat steadily while keeping your strength.", energyGoal: "lose" },
  { key: "get_lean", label: "Get Lean / Toned", description: "Lean out gently and keep your muscle.", energyGoal: "recomp" },
  { key: "improve_fitness", label: "Improve Fitness", description: "Build stamina, conditioning and all-round fitness.", energyGoal: "maintain" },
  { key: "improve_health", label: "Improve Overall Health", description: "Move more, eat well and feel better day to day.", energyGoal: "maintain" },
] as const satisfies readonly { key: string; label: string; description: string; energyGoal: Goal }[];

export type PrimaryGoal = (typeof PRIMARY_GOALS)[number]["key"];

export function energyGoalFor(goal: PrimaryGoal): Goal {
  return PRIMARY_GOALS.find((g) => g.key === goal)!.energyGoal;
}

export const EXPERIENCE_LEVELS = [
  { key: "beginner", label: "Beginner", description: "New to training, or back after a long break." },
  { key: "intermediate", label: "Intermediate", description: "Training consistently for 6+ months." },
  { key: "advanced", label: "Advanced", description: "Years of structured training." },
] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number]["key"];

export const TRAINING_LOCATIONS = [
  { key: "home", label: "Home" },
  { key: "gym", label: "Gym" },
  { key: "both", label: "Both" },
] as const;
export type TrainingLocation = (typeof TRAINING_LOCATIONS)[number]["key"];

export const EQUIPMENT = [
  { key: "bodyweight", label: "Bodyweight only" },
  { key: "dumbbells", label: "Dumbbells" },
  { key: "barbell", label: "Barbell & plates" },
  { key: "kettlebell", label: "Kettlebell" },
  { key: "resistance_bands", label: "Resistance bands" },
  { key: "pull_up_bar", label: "Pull-up bar" },
  { key: "bench", label: "Bench" },
  { key: "squat_rack", label: "Squat rack" },
  { key: "cable_machine", label: "Cable machine" },
  { key: "machines", label: "Weight machines" },
  { key: "cardio_machine", label: "Cardio machine" },
] as const;
export type Equipment = (typeof EQUIPMENT)[number]["key"];

/** Sensible starting selection for a location; the user can change it. */
export const DEFAULT_EQUIPMENT: Record<TrainingLocation, Equipment[]> = {
  home: ["bodyweight"],
  gym: ["bodyweight", "dumbbells", "barbell", "bench", "squat_rack", "cable_machine", "machines", "cardio_machine", "pull_up_bar"],
  both: ["bodyweight", "dumbbells", "barbell", "bench", "squat_rack", "cable_machine", "machines", "cardio_machine", "pull_up_bar"],
};

/**
 * Dietary preferences. `restriction` = a hard rule (never recommend conflicting food).
 * `style` = a soft preference that shapes suggestions but excludes nothing.
 */
export const DIET_PREFERENCES = [
  { key: "vegetarian", label: "Vegetarian", kind: "restriction" },
  { key: "vegan", label: "Vegan", kind: "restriction" },
  { key: "pescatarian", label: "Pescatarian", kind: "restriction" },
  { key: "halal", label: "Halal", kind: "restriction" },
  { key: "kosher", label: "Kosher", kind: "restriction" },
  { key: "dairy_free", label: "Dairy-free", kind: "restriction" },
  { key: "gluten_free", label: "Gluten-free", kind: "restriction" },
  { key: "high_protein", label: "High protein", kind: "style" },
  { key: "low_carb", label: "Lower carb", kind: "style" },
  { key: "mediterranean", label: "Mediterranean", kind: "style" },
] as const;
export type DietPreference = (typeof DIET_PREFERENCES)[number]["key"];

/** At most one base eating pattern: they contradict each other (vegan excludes fish, etc.). */
export const EXCLUSIVE_DIET_PATTERNS: readonly DietPreference[] = ["vegetarian", "vegan", "pescatarian"];

/**
 * Allergens — safety-critical, never recommended. The 14 major allergens (EU/UK list,
 * which covers the US top 9 except as noted in labels). Users can add custom allergies too.
 */
export const ALLERGENS = [
  { key: "peanuts", label: "Peanuts" },
  { key: "tree_nuts", label: "Tree nuts" },
  { key: "milk", label: "Milk" },
  { key: "eggs", label: "Eggs" },
  { key: "fish", label: "Fish" },
  { key: "crustaceans", label: "Crustacean shellfish" },
  { key: "molluscs", label: "Molluscs" },
  { key: "soy", label: "Soy" },
  { key: "gluten", label: "Gluten (wheat, barley, rye)" },
  { key: "sesame", label: "Sesame" },
  { key: "mustard", label: "Mustard" },
  { key: "celery", label: "Celery" },
  { key: "lupin", label: "Lupin" },
  { key: "sulphites", label: "Sulphites" },
] as const;
export type Allergen = (typeof ALLERGENS)[number]["key"];

export const COOKING_TIMES = [
  { key: "under_15", label: "Under 15 min", maxMinutes: 15 },
  { key: "15_30", label: "15–30 min", maxMinutes: 30 },
  { key: "30_60", label: "30–60 min", maxMinutes: 60 },
  { key: "over_60", label: "Over an hour", maxMinutes: null },
] as const;
export type CookingTime = (typeof COOKING_TIMES)[number]["key"];

export const FOOD_BUDGETS = [
  { key: "low", label: "Budget-friendly" },
  { key: "medium", label: "Moderate" },
  { key: "high", label: "Flexible" },
] as const;
export type FoodBudget = (typeof FOOD_BUDGETS)[number]["key"];

export const PROFILE_LIMITS = {
  ageYears: { min: 13, max: 100 },
  heightCm: { min: 120, max: 240 },
  weightKg: { min: 30, max: 300 },
  trainingDaysPerWeek: { min: 1, max: 7 },
  displayNameLength: 40,
  foodListMax: 30,
  customAllergyMax: 10,
  foodItemLength: 40,
} as const;

/** Energy multiplier from planned training days per week. */
export function activityForTrainingDays(days: number): ActivityLevel {
  if (days <= 1) return "light";
  if (days <= 3) return "moderate";
  if (days <= 5) return "active";
  return "very_active";
}

export const keysOf = <T extends readonly { key: string }[]>(list: T) => list.map((x) => x.key) as [T[number]["key"], ...T[number]["key"][]];
