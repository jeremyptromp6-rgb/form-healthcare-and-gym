import { localDateIn, resolveEntitlements, type BillingEvent, type SubscriptionRecord, type VerifiedTransaction } from "@form/domain";
import { transaction, type Db } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { loadSubscription } from "./entitlements";

/**
 * Subscription state changes — only from provider-verified data:
 * - a verified purchase or restore (`applyTransaction`), or
 * - a verified, signed provider event (`applyEvent`): processed at most once (event id), and never
 *   applied out of order (an event older than the last one applied for that subscription is stale).
 * A store subscription belongs to one FORM account: the first account that verified it.
 */

function upsert(db: Db, userId: string, t: VerifiedTransaction, source: SubscriptionRecord["source"], now: Date, lastEventAt: string | null) {
  db.prepare(
    `INSERT INTO subscriptions (user_id, product_id, status, auto_renew, period_end, grace_end, source, environment, original_transaction_id, last_event_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET product_id = excluded.product_id, status = excluded.status, auto_renew = excluded.auto_renew,
       period_end = excluded.period_end, grace_end = excluded.grace_end, source = excluded.source, environment = excluded.environment,
       original_transaction_id = excluded.original_transaction_id, last_event_at = COALESCE(excluded.last_event_at, subscriptions.last_event_at), updated_at = excluded.updated_at`,
  ).run(
    userId,
    t.productId,
    t.status,
    t.autoRenew ? 1 : 0,
    t.periodEnd.toISOString(),
    t.graceEnd?.toISOString() ?? null,
    source,
    t.environment,
    t.originalTransactionId,
    lastEventAt,
    now.toISOString(),
    now.toISOString(),
  );
}

export type ApplyResult = { applied: true } | { applied: false; reason: "other_account" | "kept_current" };

/** Links a verified store subscription to this user and stores its state. */
export function applyTransaction(ctx: AppContext, userId: string, t: VerifiedTransaction, source: SubscriptionRecord["source"]): ApplyResult {
  const { db } = ctx;
  return transaction(db, () => {
    const owner = db.prepare("SELECT user_id FROM subscriptions WHERE original_transaction_id = ?").get(t.originalTransactionId) as { user_id: string } | undefined;
    if (owner && owner.user_id !== userId) return { applied: false, reason: "other_account" as const };
    const current = loadSubscription(db, userId);
    if (current && current.originalTransactionId && current.originalTransactionId !== t.originalTransactionId) {
      // A different subscription is already linked: only replace it with one that's at least as good.
      const now = ctx.now();
      const mine = resolveEntitlements(current, now);
      const theirs = resolveEntitlements({ status: t.status, autoRenew: t.autoRenew, productId: t.productId, periodEnd: t.periodEnd, graceEnd: t.graceEnd, source, environment: t.environment }, now);
      if (mine.tier === "pro" && (theirs.tier !== "pro" || (theirs.accessUntil?.getTime() ?? 0) < (mine.accessUntil?.getTime() ?? 0))) return { applied: false, reason: "kept_current" as const };
    }
    upsert(db, userId, t, source, ctx.now(), null);
    return { applied: true as const };
  });
}

export function linkOrFail(ctx: AppContext, userId: string, t: VerifiedTransaction, source: SubscriptionRecord["source"]): void {
  const r = applyTransaction(ctx, userId, t, source);
  if (!r.applied && r.reason === "other_account") {
    throw new HttpError(409, "subscription_owned_elsewhere", "This store subscription is already linked to another FORM account. Sign in to that account to use it.");
  }
}

export type EventOutcome = "applied" | "stale" | "unknown_subscription" | "duplicate";

/** Applies one verified provider event exactly once. */
export function applyEvent(ctx: AppContext, provider: string, e: BillingEvent): EventOutcome {
  const { db } = ctx;
  return transaction(db, () => {
    if (db.prepare("SELECT 1 FROM billing_events WHERE event_id = ?").get(e.id)) return "duplicate";
    const sub = db.prepare("SELECT user_id, source, last_event_at FROM subscriptions WHERE original_transaction_id = ?").get(e.transaction.originalTransactionId) as
      | { user_id: string; source: SubscriptionRecord["source"]; last_event_at: string | null }
      | undefined;
    const at = e.occurredAt.toISOString();
    let outcome: Exclude<EventOutcome, "duplicate">;
    if (!sub) outcome = "unknown_subscription"; // not linked yet: the purchase's own verification will read the current state
    // Strictly older only: two genuine events can share a timestamp (duplicates are caught by event id above).
    else if (sub.last_event_at && at < sub.last_event_at) outcome = "stale";
    else {
      upsert(db, sub.user_id, e.transaction, sub.source, ctx.now(), at);
      outcome = "applied";
    }
    db.prepare("INSERT INTO billing_events (event_id, provider, type, original_transaction_id, user_id, occurred_at, received_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      e.id,
      provider,
      e.type,
      e.transaction.originalTransactionId,
      sub?.user_id ?? null,
      at,
      ctx.now().toISOString(),
      outcome,
    );
    return outcome;
  });
}

/** Meal scans the user made today (their local day): what the Free allowance counts. */
export function scansToday(ctx: AppContext, userId: string, timezone: string, today: string): number {
  const since = new Date(ctx.now().getTime() - 2 * 86_400_000).toISOString();
  const rows = ctx.db.prepare("SELECT created_at AS at FROM food_scans WHERE user_id = ? AND created_at >= ?").all(userId, since) as { at: string }[];
  return rows.filter((r) => localDateIn(timezone, new Date(r.at)) === today).length;
}

export function coachChatsToday(db: Db, userId: string, today: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM coach_calls WHERE user_id = ? AND kind = 'chat' AND local_date = ?").get(userId, today) as { n: number }).n;
}
