import type { AdProvider } from "../ads/adProvider";
import type { AnalyticsProvider } from "../analytics/analytics";
import type { PoseProvider } from "../camera/pose";
import type { AiCoachProvider } from "../coach/coach";
import type { FoodRecognitionProvider } from "../food/scan";
import type { NotificationProvider } from "../notifications/notifications";
import type { BillingProvider } from "../subscriptions/billing";
import { fail, type ProviderBase, type ProviderKind, type ProviderStatus } from "./result";

export interface ProviderRegistry {
  ai: AiCoachProvider;
  pose: PoseProvider;
  food: FoodRecognitionProvider;
  billing: BillingProvider;
  ads: AdProvider;
  analytics: AnalyticsProvider;
  notifications: NotificationProvider;
}

function unconfigured(provider: string, missing: string[]) {
  return {
    status: (): ProviderStatus => ({ state: "unconfigured", provider, missing }),
    message: `${provider} is not configured (missing: ${missing.join(", ")})`,
  };
}

/** Honest defaults: every capability reports itself as unconfigured until a real provider is wired in. */
export function createUnconfiguredProviders(): ProviderRegistry {
  const ai = unconfigured("AI coach", ["AI_PROVIDER_API_KEY"]);
  const pose = unconfigured("Pose detection", ["on-device pose model"]);
  const food = unconfigured("Food recognition", ["FOOD_RECOGNITION_PROVIDER", "ANTHROPIC_API_KEY"]);
  const billing = unconfigured("Billing", ["BILLING_PROVIDER"]);
  const ads = unconfigured("Ads", ["AD_NETWORK_APP_ID"]);
  const analytics = unconfigured("Analytics", ["ANALYTICS_WRITE_KEY"]);
  const notifications = unconfigured("Notifications", ["PUSH_CREDENTIALS"]);

  return {
    ai: { kind: "ai", status: ai.status, respond: async () => fail("unconfigured", ai.message) },
    pose: { kind: "pose", status: pose.status, estimate: async () => fail("unconfigured", pose.message) },
    food: { kind: "food_recognition", development: false, status: food.status, recognize: async () => fail("unconfigured", food.message) },
    billing: {
      kind: "billing",
      environment: null,
      status: billing.status,
      products: async () => fail("unconfigured", billing.message),
      verifyPurchase: async () => fail("unconfigured", billing.message),
      restore: async () => fail("unconfigured", billing.message),
      parseWebhook: () => fail("unconfigured", billing.message),
      manageUrl: () => null,
    },
    ads: { kind: "ads", status: ads.status, requestAd: async () => fail("unconfigured", ads.message) },
    analytics: { kind: "analytics", status: analytics.status, track: async () => fail("unconfigured", analytics.message) },
    notifications: { kind: "notifications", status: notifications.status, send: async () => fail("unconfigured", notifications.message) },
  };
}

export function providerStatuses(registry: ProviderRegistry): (ProviderStatus & { kind: ProviderKind })[] {
  return Object.values(registry).map((p: ProviderBase) => ({ kind: p.kind, ...p.status() }));
}
