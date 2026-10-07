import { ACHIEVEMENTS } from "../achievements/achievements";
import { QUESTS } from "../quests/quests";
import type { ProviderKind, ProviderStatus } from "./result";

/**
 * Which product features are actually live. A feature is available only when the engine
 * behind it exists and any provider it needs is configured, so the app never shows a
 * feature that cannot work.
 */

export type FeatureKey =
  | "camera_verification"
  | "food_scan"
  | "ai_coach"
  | "pro_purchase"
  | "ads"
  | "quests"
  | "achievements"
  | "body_quest"
  | "meal_planner"
  | "recipes"
  | "grocery";

export type FeatureAvailability = { available: true } | { available: false; reason: "provider_unconfigured" | "not_built" };

// Camera verification needs no server provider: pose runs on the user's device and the server
// verifies the recorded trace. Whether a device can track is the app's call (it knows the device).
const NEEDS_PROVIDER: Partial<Record<FeatureKey, ProviderKind>> = {
  food_scan: "food_recognition",
  ai_coach: "ai",
  pro_purchase: "billing",
  ads: "ads",
};

/** Engines that exist in this build. Flip to true in the stage that ships each one. */
const BUILT: Record<FeatureKey, boolean> = {
  camera_verification: true,
  food_scan: true,
  ai_coach: true,
  pro_purchase: true,
  ads: true,
  quests: QUESTS.length > 0,
  achievements: ACHIEVEMENTS.length > 0,
  body_quest: true,
  meal_planner: true,
  recipes: true,
  grocery: true,
};

export function featureAvailability(providers: readonly (ProviderStatus & { kind: ProviderKind })[]): Record<FeatureKey, FeatureAvailability> {
  const ready = new Set(providers.filter((p) => p.state === "ready").map((p) => p.kind));
  const out = {} as Record<FeatureKey, FeatureAvailability>;
  for (const key of Object.keys(BUILT) as FeatureKey[]) {
    const provider = NEEDS_PROVIDER[key];
    if (!BUILT[key]) out[key] = { available: false, reason: "not_built" };
    else if (provider && !ready.has(provider)) out[key] = { available: false, reason: "provider_unconfigured" };
    else out[key] = { available: true };
  }
  return out;
}
