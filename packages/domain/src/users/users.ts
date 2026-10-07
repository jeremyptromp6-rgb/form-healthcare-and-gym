import { calculateTargets, type ActivityLevel, type BodyProfile, type Goal, type NutritionTargets, type Sex } from "../nutrition/nutritionCalculator";
import { DomainValidationError } from "../shared/errors";
import {
  activityForTrainingDays,
  EXCLUSIVE_DIET_PATTERNS,
  energyGoalFor,
  PROFILE_LIMITS,
  type Allergen,
  type CookingTime,
  type DietPreference,
  type Equipment,
  type ExperienceLevel,
  type FoodBudget,
  type PrimaryGoal,
  type TrainingLocation,
} from "./profileOptions";

/** User, UserProfile, NutritionPreferences, settings and onboarding models. */

export interface User {
  id: string;
  email: string;
  createdAt: string;
}

/**
 * The profile as stored. Fields are nullable while onboarding is in progress. `activity` and
 * `energyGoal` are derived server-side (from training days and primary goal) — never set by clients.
 */
export interface UserProfile {
  userId: string;
  displayName: string | null;
  primaryGoal: PrimaryGoal | null;
  sex: Sex | null;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  experience: ExperienceLevel | null;
  trainingDaysPerWeek: number | null;
  trainingLocation: TrainingLocation | null;
  equipment: Equipment[] | null;
  activity: ActivityLevel | null;
  energyGoal: Goal | null;
  onboardingCompletedAt: string | null;
  updatedAt: string;
}

/**
 * Allergies and dislikes are different things:
 * - allergies are safety constraints — food containing them is never recommended;
 * - dislikes are preferences — such food is deprioritised, never forbidden.
 */
export interface NutritionPreferences {
  dietaryPreferences: DietPreference[];
  allergens: Allergen[];
  customAllergies: string[];
  dislikedFoods: string[];
  cookingTime: CookingTime | null;
  foodBudget: FoodBudget | null;
}

export const EMPTY_NUTRITION_PREFERENCES: NutritionPreferences = {
  dietaryPreferences: [],
  allergens: [],
  customAllergies: [],
  dislikedFoods: [],
  cookingTime: null,
  foodBudget: null,
};

export type Units = "metric" | "imperial";

export const DATE_FORMATS = ["system", "day_month", "month_day", "iso"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export interface UserSettings {
  units: Units;
  /** IANA time zone. The server uses it to decide the user's "today" — the authoritative local date. */
  timezone: string | null;
  /** On: the app keeps the time zone in step with the device. Off: the user chose one and it stays. */
  timezoneAuto: boolean;
  /** How dates are shown (display only — every stored date is a canonical YYYY-MM-DD local date). */
  dateFormat: DateFormat;
  /** Off by default: ads are non-personalized unless the user opts in. */
  personalizedAdsConsent: boolean;
  /** Off by default: no product analytics are sent unless the user opts in. */
  analyticsConsent: boolean;
  /** The coach (rule-based or AI) is on. Off: no coaching surfaces, nothing is analysed. */
  aiCoachEnabled: boolean;
  /** Off by default: the user's coaching context is only sent to an external AI provider after they agree. */
  aiCoachConsent: boolean;
  /** Keep coach chat history (30 days). Off: chats aren't stored, and existing history is cleared. */
  coachKeepHistory: boolean;
  /** Off by default: meal photos are only sent to the external recognition provider after the user agrees. */
  foodScanConsent: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  units: "metric",
  timezone: null,
  timezoneAuto: true,
  dateFormat: "system",
  personalizedAdsConsent: false,
  analyticsConsent: false,
  aiCoachEnabled: true,
  aiCoachConsent: false,
  coachKeepHistory: true,
  foodScanConsent: false,
};

/**
 * What the user wants to be notified about. These are FORM's preferences, separate from the
 * device's permission to show notifications at all (which only the OS grants) — both must allow
 * a notification before one is sent. Everything is off until the user turns it on.
 */
export interface NotificationPreferences {
  workoutReminders: boolean;
  /** Local time, HH:MM (24-hour). */
  workoutReminderTime: string;
  mealReminders: boolean;
  weeklySummary: boolean;
  achievementAlerts: boolean;
  streakAlerts: boolean;
  coachTips: boolean;
  /** No notifications between these local times (may cross midnight). Null: no quiet hours. */
  quietHours: { start: string; end: string } | null;
}

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  workoutReminders: false,
  workoutReminderTime: "18:00",
  mealReminders: false,
  weeklySummary: false,
  achievementAlerts: false,
  streakAlerts: false,
  coachTips: false,
  quietHours: { start: "22:00", end: "07:00" },
};

/** Is a local time (HH:MM) inside quiet hours? Handles ranges that cross midnight. */
export function inQuietHours(time: string, quiet: NotificationPreferences["quietHours"]): boolean {
  if (!quiet || quiet.start === quiet.end) return false;
  return quiet.start < quiet.end ? time >= quiet.start && time < quiet.end : time >= quiet.start || time < quiet.end;
}

// ---- Derived fields -----------------------------------------------------------

/** Server-derived fields for a profile after an edit. */
export function deriveProfileFields(p: Pick<UserProfile, "primaryGoal" | "trainingDaysPerWeek" | "activity">): {
  activity: ActivityLevel | null;
  energyGoal: Goal | null;
} {
  return {
    activity: p.trainingDaysPerWeek !== null ? activityForTrainingDays(p.trainingDaysPerWeek) : p.activity,
    energyGoal: p.primaryGoal !== null ? energyGoalFor(p.primaryGoal) : null,
  };
}

/** The inputs the NutritionCalculator needs, or null while any are missing. */
/**
 * The user's nutrition targets: body profile (measurements, training frequency, goal) plus the
 * diet styles that shape the macro split. The only place targets are derived from a user.
 */
export function targetsForUser(profile: UserProfile, preferences: Pick<NutritionPreferences, "dietaryPreferences"> | null): NutritionTargets | null {
  const body = bodyProfileOf(profile);
  return body ? calculateTargets(body, { styles: preferences?.dietaryPreferences ?? [] }) : null;
}

export function bodyProfileOf(p: UserProfile): BodyProfile | null {
  if (p.sex === null || p.ageYears === null || p.heightCm === null || p.weightKg === null || p.activity === null || p.energyGoal === null) return null;
  return { sex: p.sex, ageYears: p.ageYears, heightCm: p.heightCm, weightKg: p.weightKg, activity: p.activity, goal: p.energyGoal };
}

// ---- Preference normalization ---------------------------------------------------

/** Trims, lowercases, collapses whitespace, de-duplicates and bounds a list of food names. */
export function normalizeFoodList(items: readonly string[], max: number = PROFILE_LIMITS.foodListMax): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
    if (!v) continue;
    if (v.length > PROFILE_LIMITS.foodItemLength) throw new DomainValidationError(`"${raw.slice(0, 20)}…" is too long`, "food");
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > max) throw new DomainValidationError(`at most ${max} items`, "food");
  return out;
}

export function validateDietPreferences(prefs: readonly DietPreference[]): DietPreference[] {
  const unique = [...new Set(prefs)];
  const patterns = unique.filter((p) => EXCLUSIVE_DIET_PATTERNS.includes(p));
  if (patterns.length > 1) {
    throw new DomainValidationError(`choose only one of ${EXCLUSIVE_DIET_PATTERNS.join(", ")}`, "dietaryPreferences");
  }
  return unique;
}

/**
 * Normalizes preferences. If a food is listed as both an allergy and a dislike, the allergy
 * wins: it is kept as a hard constraint and removed from the (soft) dislike list.
 */
export function normalizeNutritionPreferences(p: NutritionPreferences): NutritionPreferences & { movedToAllergies: string[] } {
  const dietaryPreferences = validateDietPreferences(p.dietaryPreferences);
  const allergens = [...new Set(p.allergens)];
  const customAllergies = normalizeFoodList(p.customAllergies, PROFILE_LIMITS.customAllergyMax);
  const disliked = normalizeFoodList(p.dislikedFoods);
  const allergyTerms = new Set([...customAllergies, ...allergens.map((a) => a.replace(/_/g, " "))]);
  const movedToAllergies = disliked.filter((d) => allergyTerms.has(d));
  return {
    dietaryPreferences,
    allergens,
    customAllergies,
    dislikedFoods: disliked.filter((d) => !allergyTerms.has(d)),
    cookingTime: p.cookingTime,
    foodBudget: p.foodBudget,
    movedToAllergies,
  };
}

// ---- Onboarding -----------------------------------------------------------------

export const ONBOARDING_STEPS = ["goal", "body", "training", "nutrition", "habits"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStatus {
  completed: boolean;
  /** Steps whose answers are still missing, in order. */
  remaining: OnboardingStep[];
  /** Where a returning user should resume: the first missing step, or "review" when all are answered. */
  nextStep: OnboardingStep | "review" | null;
}

export function stepAnswered(step: OnboardingStep, profile: UserProfile | null, prefs: NutritionPreferences | null): boolean {
  switch (step) {
    case "goal":
      return profile?.primaryGoal != null;
    case "body":
      return profile?.sex != null && profile.ageYears != null && profile.heightCm != null && profile.weightKg != null;
    case "training":
      return profile?.experience != null && profile.trainingDaysPerWeek != null && profile.trainingLocation != null && (profile.equipment?.length ?? 0) > 0;
    case "nutrition":
      // Answering "none" is an answer: the preferences record exists once the step is saved.
      return prefs !== null;
    case "habits":
      return prefs?.cookingTime != null && prefs.foodBudget != null;
  }
}

export function onboardingStatus(profile: UserProfile | null, prefs: NutritionPreferences | null): OnboardingStatus {
  const remaining = ONBOARDING_STEPS.filter((s) => !stepAnswered(s, profile, prefs));
  const completed = profile?.onboardingCompletedAt != null;
  return { completed, remaining, nextStep: completed ? null : (remaining[0] ?? "review") };
}
