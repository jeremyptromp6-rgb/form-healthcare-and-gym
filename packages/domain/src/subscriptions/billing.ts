import type { ProviderBase, ProviderResult } from "../providers/result";
import type { ProviderSubscriptionStatus, SubscriptionRecord } from "./entitlements";

/**
 * Billing boundary. A provider (App Store, Google Play, a billing service — or the labelled
 * development store) owns products and prices, verifies purchases, restores them, and reports
 * lifecycle changes through signed server events. The client's claims are never trusted: every
 * change to a subscription comes from a provider-verified transaction or a verified event.
 *
 * Prices are the provider's: FORM never hard-codes what a product costs.
 */

export type BillingPlatform = "ios" | "android" | "web";
export type BillingEnvironment = SubscriptionRecord["environment"];

export interface BillingProduct {
  id: string;
  plan: "monthly" | "annual";
  title: string;
  /** ISO 8601 duration of one billing period. */
  period: "P1M" | "P1Y";
  /** From the provider; null if it didn't return a price (then the product isn't sold). */
  price: { amount: number; currency: string; display: string } | null;
  /** Free-trial length when the provider offers one for this product; null otherwise. */
  trialDays: number | null;
  environment: BillingEnvironment;
}

/** A subscription as the provider verified it. */
export interface VerifiedTransaction {
  productId: string;
  /** Stable across renewals and devices: links a store subscription to one FORM account. */
  originalTransactionId: string;
  status: ProviderSubscriptionStatus;
  autoRenew: boolean;
  periodEnd: Date;
  graceEnd: Date | null;
  environment: BillingEnvironment;
}

export const BILLING_EVENT_TYPES = ["purchased", "trial_started", "renewed", "cancelled", "resumed", "billing_issue", "grace_period", "recovered", "expired", "refunded"] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

/** A lifecycle change, from a provider's signed server notification. */
export interface BillingEvent {
  /** Provider's unique event id — processed at most once. */
  id: string;
  type: BillingEventType;
  occurredAt: Date;
  transaction: VerifiedTransaction;
}

export interface BillingProvider extends ProviderBase {
  readonly kind: "billing";
  /** null when unconfigured. */
  readonly environment: BillingEnvironment | null;
  products(): Promise<ProviderResult<BillingProduct[]>>;
  /** Verifies a purchase receipt/token the client got from the store. */
  verifyPurchase(input: { platform: BillingPlatform; productId: string; receipt: string }): Promise<ProviderResult<VerifiedTransaction>>;
  /** Re-verifies the purchases the store says belong to this device's store account. */
  restore(input: { platform: BillingPlatform; receipts: string[] }): Promise<ProviderResult<VerifiedTransaction[]>>;
  /** Verifies a server notification's signature and freshness, then parses it. */
  parseWebhook(input: { rawBody: string; headers: Record<string, string | undefined>; now: Date }): ProviderResult<BillingEvent>;
  /** Where the user manages or cancels (the store's own page); null if there is none. */
  manageUrl(platform: BillingPlatform): string | null;
}

/** The subscription record a verified transaction implies. */
export function recordFromTransaction(t: VerifiedTransaction, source: SubscriptionRecord["source"]): SubscriptionRecord {
  return { status: t.status, autoRenew: t.autoRenew, productId: t.productId, periodEnd: t.periodEnd, graceEnd: t.graceEnd, source, environment: t.environment };
}
