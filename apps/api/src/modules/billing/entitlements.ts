import { premiumFeature, resolveEntitlements, hasFeature, type Entitlements, type PremiumFeatureId, type SubscriptionRecord } from "@form/domain";
import type { Db } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";

/**
 * EntitlementService (server). The single place the API asks "may this user use this?". It reads
 * the provider-verified subscription row and the domain state machine decides — no route checks a
 * tier, a date or a status itself. The client never sends anything that could change the answer.
 */

interface SubscriptionRow {
  product_id: string;
  status: SubscriptionRecord["status"];
  auto_renew: number;
  period_end: string;
  grace_end: string | null;
  source: SubscriptionRecord["source"];
  environment: SubscriptionRecord["environment"];
  original_transaction_id: string | null;
}

export function loadSubscription(db: Db, userId: string): (SubscriptionRecord & { originalTransactionId: string | null }) | null {
  const r = db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(userId) as SubscriptionRow | undefined;
  if (!r) return null;
  return {
    status: r.status,
    autoRenew: r.auto_renew === 1,
    productId: r.product_id,
    periodEnd: new Date(r.period_end),
    graceEnd: r.grace_end ? new Date(r.grace_end) : null,
    source: r.source,
    environment: r.environment,
    originalTransactionId: r.original_transaction_id,
  };
}

export function entitlementsFor(ctx: AppContext, userId: string): Entitlements {
  return resolveEntitlements(loadSubscription(ctx.db, userId), ctx.now());
}

export function can(ctx: AppContext, userId: string, feature: PremiumFeatureId): boolean {
  return hasFeature(entitlementsFor(ctx, userId), feature);
}

/** 402 with the feature id, so every client shows the same paywall for it. */
export function proRequired(feature: PremiumFeatureId, message?: string): HttpError {
  const f = premiumFeature(feature);
  return new HttpError(402, "pro_required", message ?? `${f.title} is part of FORM Pro.`, { feature, title: f.title, free: f.free });
}

export function requireFeature(ctx: AppContext, userId: string, feature: PremiumFeatureId, message?: string): void {
  if (!can(ctx, userId, feature)) throw proRequired(feature, message);
}
