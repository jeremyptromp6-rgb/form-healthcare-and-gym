import type { ProviderBase, ProviderResult } from "../providers/result";

/**
 * Analytics boundary. Only allowlisted product events are sent, only with the user's
 * consent, and never with health, body, nutrition, camera or identity data.
 */

export const ANALYTICS_EVENTS = [
  "app_opened",
  "signed_up",
  "onboarding_completed",
  "workout_logged",
  "food_logged",
  "screen_viewed",
  "upgrade_viewed",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProps = Record<string, string | number | boolean>;

export interface AnalyticsProvider extends ProviderBase {
  readonly kind: "analytics";
  track(event: { name: AnalyticsEventName; props: AnalyticsProps }): Promise<ProviderResult<void>>;
}

/** Property names that could carry sensitive data. Matching keys are always dropped. */
const SENSITIVE_KEY = /weight|height|kcal|calor|protein|carb|fat|macro|body|pain|injur|photo|camera|image|email|name|age|sex|gender|birth|rep|xp|location|lat|lon|phone|token/i;
const MAX_PROPS = 10;
const MAX_STRING = 64;

export function sanitizeAnalyticsEvent(
  name: string,
  props: Record<string, unknown> = {},
): { name: AnalyticsEventName; props: AnalyticsProps } | null {
  if (!(ANALYTICS_EVENTS as readonly string[]).includes(name)) return null;
  const clean: AnalyticsProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (Object.keys(clean).length >= MAX_PROPS) break;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key) || SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string") clean[key] = value.slice(0, MAX_STRING);
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) clean[key] = value;
  }
  return { name: name as AnalyticsEventName, props: clean };
}
