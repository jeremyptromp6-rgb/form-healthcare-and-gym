import type { PersonalizationProfile } from "../personalization/personalization";
import type { Allergen, DietPreference } from "../users/profileOptions";

/**
 * Checks a food against a user's personalization. This is where allergies and dislikes
 * behave differently:
 *
 * - allergen (or custom allergy) present      → "excluded" (never recommended)
 * - allergen data unknown and user has allergies → "caution" (can't confirm it's safe)
 * - conflicts with a diet restriction           → "excluded"
 * - diet suitability unknown for a restriction  → "caution"
 * - disliked                                    → still "ok", but `disliked: true` (ranked lower)
 *
 * FORM never claims a food is allergen-free: labels and cross-contamination are outside
 * what it can verify, so the UI must always tell users to check labels.
 */

export interface AssessableFood {
  name: string;
  ingredients?: string[];
  /** Known allergens. `undefined` means allergen data is unknown (not "none"). */
  allergens?: Allergen[];
  /** Restrictions this food is known to satisfy. `undefined` means unknown. */
  suitableFor?: DietPreference[];
}

export type FoodVerdict = "ok" | "caution" | "excluded";

export interface FoodAssessment {
  verdict: FoodVerdict;
  reasons: ("allergen" | "custom_allergy" | "allergen_data_unknown" | "diet_restriction" | "diet_data_unknown")[];
  matchedAllergens: string[];
  disliked: boolean;
}

function mentions(food: AssessableFood, term: string): boolean {
  const haystack = [food.name, ...(food.ingredients ?? [])].join(" | ").toLowerCase();
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z])${escaped}(s|es)?([^a-z]|$)`).test(haystack);
}

export function assessFood(food: AssessableFood, p: PersonalizationProfile): FoodAssessment {
  const { hard, soft } = p.nutrition;
  const reasons: FoodAssessment["reasons"] = [];
  const matched: string[] = [];

  if (food.allergens) {
    for (const a of hard.allergens) if (food.allergens.includes(a)) matched.push(a);
    if (matched.length) reasons.push("allergen");
  } else if (hard.allergens.length > 0) {
    reasons.push("allergen_data_unknown");
  }
  const custom = hard.customAllergies.filter((c) => mentions(food, c));
  if (custom.length) {
    matched.push(...custom);
    reasons.push("custom_allergy");
  }

  if (hard.dietRestrictions.length > 0) {
    if (!food.suitableFor) reasons.push("diet_data_unknown");
    else if (hard.dietRestrictions.some((r) => !food.suitableFor!.includes(r))) reasons.push("diet_restriction");
  }

  const excluded = reasons.some((r) => r === "allergen" || r === "custom_allergy" || r === "diet_restriction");
  const caution = reasons.some((r) => r === "allergen_data_unknown" || r === "diet_data_unknown");
  return {
    verdict: excluded ? "excluded" : caution ? "caution" : "ok",
    reasons,
    matchedAllergens: matched,
    disliked: soft.dislikedFoods.some((d) => mentions(food, d)),
  };
}
