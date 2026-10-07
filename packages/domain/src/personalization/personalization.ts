import type { Goal } from "../nutrition/nutritionCalculator";
import type { DateKey } from "../shared/dates";
import {
  COOKING_TIMES,
  DIET_PREFERENCES,
  energyGoalFor,
  type Allergen,
  type CookingTime,
  type DietPreference,
  type Equipment,
  type ExperienceLevel,
  type FoodBudget,
  type PrimaryGoal,
  type TrainingLocation,
} from "../users/profileOptions";
import { ONBOARDING_STEPS, stepAnswered, type NutritionPreferences, type OnboardingStep, type UserProfile } from "../users/users";

/**
 * Personalization layer — the one object workout, nutrition and AI systems consume.
 * It is derived (never stored) from the profile, preferences and goal history, so every
 * consumer sees the same interpretation and none reads raw profile rows.
 *
 * Goal changes are recorded in goal history with an effective date. Consumers ask for
 * the goal in force on a given day, so a new goal shapes future recommendations while
 * anything already recorded (targets, XP, workouts) keeps the goal it was made under.
 */

export interface GoalChange {
  primaryGoal: PrimaryGoal;
  effectiveFrom: DateKey;
}

export function goalOn(history: readonly GoalChange[], date: DateKey): PrimaryGoal | null {
  let best: GoalChange | null = null;
  for (const g of history) if (g.effectiveFrom <= date && (best === null || g.effectiveFrom > best.effectiveFrom)) best = g;
  return best?.primaryGoal ?? null;
}

export interface PersonalizationProfile {
  version: 1;
  asOf: DateKey;
  goal: { primary: PrimaryGoal | null; energy: Goal | null; since: DateKey | null };
  training: {
    experience: ExperienceLevel | null;
    daysPerWeek: number | null;
    location: TrainingLocation | null;
    equipment: Equipment[];
  };
  nutrition: {
    /** Hard constraints: recommendations must never violate these. */
    hard: { allergens: Allergen[]; customAllergies: string[]; dietRestrictions: DietPreference[] };
    /** Soft preferences: shape and rank recommendations, never exclude. */
    soft: { dislikedFoods: string[]; dietStyles: DietPreference[]; maxCookingMinutes: number | null; budget: FoodBudget | null };
  };
  safety: { isMinor: boolean; noWeightLossTargets: boolean };
  /** Onboarding steps not yet answered: consumers should fall back to general defaults for these. */
  missing: OnboardingStep[];
}

const RESTRICTIONS = new Set<DietPreference>(DIET_PREFERENCES.filter((d) => d.kind === "restriction").map((d) => d.key));

export function buildPersonalization(input: {
  asOf: DateKey;
  profile: UserProfile | null;
  preferences: NutritionPreferences | null;
  goalHistory: readonly GoalChange[];
}): PersonalizationProfile {
  const { profile: p, preferences: n } = input;
  const primary = goalOn(input.goalHistory, input.asOf) ?? p?.primaryGoal ?? null;
  const since = input.goalHistory
    .filter((g) => g.effectiveFrom <= input.asOf)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]?.effectiveFrom ?? null;
  const isMinor = p?.ageYears != null && p.ageYears < 18;
  const cooking: CookingTime | null = n?.cookingTime ?? null;

  return {
    version: 1,
    asOf: input.asOf,
    goal: { primary, energy: primary ? energyGoalFor(primary) : null, since },
    training: {
      experience: p?.experience ?? null,
      daysPerWeek: p?.trainingDaysPerWeek ?? null,
      location: p?.trainingLocation ?? null,
      equipment: p?.equipment ?? [],
    },
    nutrition: {
      hard: {
        allergens: n?.allergens ?? [],
        customAllergies: n?.customAllergies ?? [],
        dietRestrictions: (n?.dietaryPreferences ?? []).filter((d) => RESTRICTIONS.has(d)),
      },
      soft: {
        dislikedFoods: n?.dislikedFoods ?? [],
        dietStyles: (n?.dietaryPreferences ?? []).filter((d) => !RESTRICTIONS.has(d)),
        maxCookingMinutes: cooking ? COOKING_TIMES.find((c) => c.key === cooking)!.maxMinutes : null,
        budget: n?.foodBudget ?? null,
      },
    },
    safety: { isMinor, noWeightLossTargets: isMinor },
    missing: ONBOARDING_STEPS.filter((s) => !stepAnswered(s, p, n)),
  };
}
