/**
 * EntitlementService (domain) — the one place that decides what a user can access.
 *
 * - The premium feature registry (PREMIUM_FEATURES) names every Pro capability and what Free keeps.
 * - Subscription state comes only from a server-held record written after the billing provider
 *   verified a purchase or sent a signed lifecycle event (or an explicit admin grant). Nothing the
 *   client sends can grant Pro.
 * - Access follows the *entitlement*, not the renewal: a cancelled subscription keeps Pro until the
 *   paid period ends; a billing problem keeps it through the store's grace period; a refund or
 *   revocation ends it at once. Expiry never deletes anything — only future Pro features stop.
 */

export const PREMIUM_FEATURE_IDS = [
  "AI_COACH_ADVANCED",
  "ADAPTIVE_TRAINING",
  "ADVANCED_FORM_ANALYSIS",
  "ADVANCED_ROM_ANALYSIS",
  "FOOD_SCANNER_PREMIUM",
  "MEAL_PLANNER_ADVANCED",
  "ADVANCED_PROGRESS",
  "WEEKLY_AI_REPORT",
  "ADVANCED_BODY_QUEST",
  "PERSONALIZED_RECOMMENDATIONS",
  "AD_FREE",
] as const;
export type PremiumFeatureId = (typeof PREMIUM_FEATURE_IDS)[number];

export interface PremiumFeature {
  id: PremiumFeatureId;
  title: string;
  /** What Pro adds — shown on the paywall. */
  pro: string;
  /** What Free keeps — shown next to it, so Free is never hidden or made to look broken. */
  free: string;
}

export const PREMIUM_FEATURES: readonly PremiumFeature[] = [
  { id: "AI_COACH_ADVANCED", title: "Advanced AI Coach", pro: "More coaching every day, with your form, range-of-motion and record trends in every answer.", free: "Daily coaching tips and a few coach messages a day." },
  { id: "ADAPTIVE_TRAINING", title: "Adaptive training", pro: "Workouts that progress only when your reps, form, range of motion and consistency earn it.", free: "Workouts that progress from your reps and range of motion." },
  { id: "ADVANCED_FORM_ANALYSIS", title: "Form intelligence", pro: "Form history per exercise, technique trends and how your form held up as the weight went up.", free: "Form feedback on every camera-verified set." },
  { id: "ADVANCED_ROM_ANALYSIS", title: "Range-of-motion history", pro: "Range of motion over time for every tracked exercise.", free: "Range of motion on every camera-verified set." },
  { id: "FOOD_SCANNER_PREMIUM", title: "More meal scans", pro: "Scan meals as often as you need, within fair-use limits.", free: "A few meal scans a day. Weighing, search and labels are always unlimited." },
  { id: "MEAL_PLANNER_ADVANCED", title: "Advanced meal planning", pro: "Week-long plans, a plan for the rest of today from what you have left, and your saved recipes first.", free: "One-day meal plans built around your targets and allergies." },
  { id: "ADVANCED_PROGRESS", title: "Advanced progress", pro: "90-day analysis with form and range-of-motion trends.", free: "7- and 30-day progress for strength, consistency, nutrition, weight and XP." },
  { id: "WEEKLY_AI_REPORT", title: "Weekly progress report", pro: "A report every week from your real training, food, records, XP and Body Quest, with a coach note.", free: "Reports you already have stay yours." },
  { id: "ADVANCED_BODY_QUEST", title: "Body Quest insights", pro: "How each stat has moved week by week and exactly what moves it next.", free: "Your stage, stats and next goal." },
  { id: "PERSONALIZED_RECOMMENDATIONS", title: "Deeper personalization", pro: "Coaching and plans that use your trends, not just your last session.", free: "Coaching from your latest data." },
  { id: "AD_FREE", title: "No ads", pro: "No ads anywhere.", free: "Occasional, non-personalized ads unless you opt in." },
];

/** Free-tier allowances. Servers may override them from configuration. */
export const FREE_LIMITS = {
  /** Meal scans per local day. */
  foodScansPerDay: 3,
  /** Coach chat messages per local day. */
  coachChatPerDay: 5,
  /** Real AI calls per local day (beyond these, labelled rule-based coaching). */
  aiCallsPerDay: 3,
  /** Longest meal plan, in days. */
  mealPlanDays: 1,
  /** Longest analytics range, in days. */
  analyticsRangeDays: 30,
} as const;
export type FreeLimits = { -readonly [K in keyof typeof FREE_LIMITS]: number };

export const SUBSCRIPTION_STATES = ["FREE", "PRO_TRIAL", "PRO_ACTIVE", "PRO_CANCELLED", "PRO_GRACE_PERIOD", "PRO_BILLING_ISSUE", "PRO_EXPIRED"] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

/** What the billing provider says about a subscription (stored server-side, provider-verified). */
export type ProviderSubscriptionStatus =
  | "trial" // in a free trial period
  | "active" // paid and in period
  | "grace_period" // renewal failed; the store keeps access until grace ends
  | "billing_retry" // renewal failed, grace over (or none): no access while the store retries
  | "expired" // period ended without renewal
  | "revoked"; // refunded or revoked: access ends immediately

export interface SubscriptionRecord {
  status: ProviderSubscriptionStatus;
  /** False once the user turned off renewal (cancelled) — access continues until periodEnd. */
  autoRenew: boolean;
  productId: string;
  /** End of the current paid (or trial) period. */
  periodEnd: Date;
  /** End of the store's grace period, when in grace. */
  graceEnd: Date | null;
  source: "store" | "development" | "admin_grant";
  environment: "production" | "sandbox" | "development";
}

export interface Entitlements {
  tier: "free" | "pro";
  state: SubscriptionState;
  features: PremiumFeatureId[];
  productId: string | null;
  /** When access ends if nothing changes (period end, or grace end); null on Free. */
  accessUntil: Date | null;
  /** Whether it renews at accessUntil. */
  willRenew: boolean;
  /** Sandbox/development purchases are labelled; they never count as production revenue. */
  environment: SubscriptionRecord["environment"] | null;
  source: SubscriptionRecord["source"] | null;
}

const FREE: Omit<Entitlements, "state"> = { tier: "free", features: [], productId: null, accessUntil: null, willRenew: false, environment: null, source: null };

/** The state machine: provider status + renewal + time → state and access. */
export function resolveEntitlements(sub: SubscriptionRecord | null, now: Date): Entitlements {
  if (!sub) return { ...FREE, state: "FREE" };
  const t = now.getTime();
  const inPeriod = sub.periodEnd.getTime() > t;
  const meta = { productId: sub.productId, environment: sub.environment, source: sub.source };
  const pro = (state: SubscriptionState, until: Date, willRenew: boolean): Entitlements => ({ tier: "pro", state, features: [...PREMIUM_FEATURE_IDS], accessUntil: until, willRenew, ...meta });
  const free = (state: SubscriptionState): Entitlements => ({ ...FREE, state, ...meta });

  switch (sub.status) {
    case "trial":
      return inPeriod ? pro(sub.autoRenew ? "PRO_TRIAL" : "PRO_CANCELLED", sub.periodEnd, sub.autoRenew) : free("PRO_EXPIRED");
    case "active":
      return inPeriod ? pro(sub.autoRenew ? "PRO_ACTIVE" : "PRO_CANCELLED", sub.periodEnd, sub.autoRenew) : free("PRO_EXPIRED");
    case "grace_period":
      return sub.graceEnd && sub.graceEnd.getTime() > t ? pro("PRO_GRACE_PERIOD", sub.graceEnd, sub.autoRenew) : free("PRO_BILLING_ISSUE");
    case "billing_retry":
      return free("PRO_BILLING_ISSUE");
    case "expired":
    case "revoked":
      return free("PRO_EXPIRED");
  }
}

export function hasFeature(e: Pick<Entitlements, "features">, f: PremiumFeatureId): boolean {
  return e.features.includes(f);
}

export function premiumFeature(id: PremiumFeatureId): PremiumFeature {
  return PREMIUM_FEATURES.find((f) => f.id === id)!;
}
