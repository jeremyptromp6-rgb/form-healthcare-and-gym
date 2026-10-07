import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  fail,
  type BillingEvent,
  type BillingEventType,
  type BillingPlatform,
  type BillingProduct,
  type BillingProvider,
  type ProviderResult,
  type ProviderSubscriptionStatus,
  type VerifiedTransaction,
} from "@form/domain";
import type { AppConfig } from "../config";
import type { Db } from "../db";

/**
 * The development store — a sandbox billing provider for local development and tests. It behaves
 * like a real store from FORM's side: it owns products and prices, issues signed receipts on
 * "checkout", verifies them, restores a store account's purchases, and sends signed lifecycle
 * notifications (renewal, cancellation, billing problems, expiry, refunds). No money moves; every
 * product and subscription it touches is labelled environment "development". Configuration refuses
 * it in production.
 */

export const DEV_SIGNATURE_HEADER = "form-dev-signature";
/** Notifications older (or newer) than this are refused as replays. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

interface TxnRow {
  original_transaction_id: string;
  store_account: string;
  product_id: string;
  status: ProviderSubscriptionStatus;
  auto_renew: number;
  period_end: string;
  grace_end: string | null;
}

export type DevSimulation = "renew" | "cancel" | "resume" | "billing_issue" | "grace_expired" | "recover" | "expire" | "refund";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const addPeriod = (from: Date, plan: "monthly" | "annual") => {
  const d = new Date(from);
  if (plan === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
};

export class DevBillingStore implements BillingProvider {
  readonly kind = "billing" as const;
  readonly environment = "development" as const;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig["billing"],
    private readonly now: () => Date,
  ) {}

  status() {
    return { state: "ready" as const, provider: "Development store (sandbox — no real payments)" };
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.config.dev.secret).update(payload).digest("base64url");
  }

  private planOf(productId: string): "monthly" | "annual" | null {
    return productId === this.config.products.monthly ? "monthly" : productId === this.config.products.annual ? "annual" : null;
  }

  async products(): Promise<ProviderResult<BillingProduct[]>> {
    const { prices, currency } = this.config.dev;
    const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
    const trial = this.config.trialDays > 0 ? this.config.trialDays : null;
    return {
      ok: true,
      value: [
        { id: this.config.products.monthly, plan: "monthly", title: "FORM Pro — monthly", period: "P1M", price: { amount: prices.monthly, currency, display: fmt(prices.monthly) }, trialDays: trial, environment: "development" },
        { id: this.config.products.annual, plan: "annual", title: "FORM Pro — yearly", period: "P1Y", price: { amount: prices.annual, currency, display: fmt(prices.annual) }, trialDays: trial, environment: "development" },
      ],
    };
  }

  /** The store's checkout: creates a subscription for the device's store account and returns its signed receipt. */
  checkout(storeAccount: string, productId: string): ProviderResult<{ receipt: string; originalTransactionId: string }> {
    const plan = this.planOf(productId);
    if (!plan) return fail("invalid_input", "Unknown product");
    const now = this.now();
    // One subscription per store account and product group, like the real stores: buying again while active changes nothing.
    const existing = this.db.prepare("SELECT * FROM dev_store_transactions WHERE store_account = ? AND status IN ('trial', 'active', 'grace_period') ORDER BY created_at DESC LIMIT 1").get(storeAccount) as TxnRow | undefined;
    const id = existing?.original_transaction_id ?? `dev_${randomUUID()}`;
    if (!existing) {
      const trial = this.config.trialDays > 0;
      const periodEnd = trial ? new Date(now.getTime() + this.config.trialDays * 86_400_000) : addPeriod(now, plan);
      this.db
        .prepare("INSERT INTO dev_store_transactions (original_transaction_id, store_account, product_id, status, auto_renew, period_end, grace_end, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, NULL, ?, ?)")
        .run(id, storeAccount, productId, trial ? "trial" : "active", periodEnd.toISOString(), now.toISOString(), now.toISOString());
    }
    return { ok: true, value: { receipt: this.receiptFor(id, storeAccount), originalTransactionId: id } };
  }

  private receiptFor(id: string, storeAccount: string): string {
    const body = b64(JSON.stringify({ otid: id, acct: storeAccount, iat: this.now().toISOString() }));
    return `dev1.${body}.${this.sign(body)}`;
  }

  /** Receipts the store holds for a store account (what "restore" asks the device's store for). */
  receiptsFor(storeAccount: string): string[] {
    const rows = this.db.prepare("SELECT original_transaction_id AS id FROM dev_store_transactions WHERE store_account = ?").all(storeAccount) as { id: string }[];
    return rows.map((r) => this.receiptFor(r.id, storeAccount));
  }

  private txn(id: string): VerifiedTransaction | null {
    const r = this.db.prepare("SELECT * FROM dev_store_transactions WHERE original_transaction_id = ?").get(id) as TxnRow | undefined;
    if (!r) return null;
    return { productId: r.product_id, originalTransactionId: r.original_transaction_id, status: r.status, autoRenew: r.auto_renew === 1, periodEnd: new Date(r.period_end), graceEnd: r.grace_end ? new Date(r.grace_end) : null, environment: "development" };
  }

  private verifyReceipt(receipt: string): VerifiedTransaction | null {
    const parts = receipt.split(".");
    if (parts.length !== 3 || parts[0] !== "dev1") return null;
    const expected = Buffer.from(this.sign(parts[1]!));
    const given = Buffer.from(parts[2]!);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const { otid } = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as { otid: string };
      return this.txn(otid);
    } catch {
      return null;
    }
  }

  async verifyPurchase(input: { platform: BillingPlatform; productId: string; receipt: string }): Promise<ProviderResult<VerifiedTransaction>> {
    const t = this.verifyReceipt(input.receipt);
    if (!t) return fail("invalid_input", "The receipt couldn't be verified.");
    if (t.productId !== input.productId) return fail("invalid_input", "The receipt is for a different product.");
    return { ok: true, value: t };
  }

  async restore(input: { platform: BillingPlatform; receipts: string[] }): Promise<ProviderResult<VerifiedTransaction[]>> {
    return { ok: true, value: input.receipts.map((r) => this.verifyReceipt(r)).filter((t): t is VerifiedTransaction => t !== null) };
  }

  /** Signs a notification the way the store would deliver it. */
  signNotification(event: { id: string; type: BillingEventType; occurredAt: string; transaction: VerifiedTransaction }, at = this.now()): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify(event);
    const t = Math.floor(at.getTime() / 1000);
    return { body, headers: { [DEV_SIGNATURE_HEADER]: `t=${t},v1=${createHmac("sha256", this.config.dev.secret).update(`${t}.${body}`).digest("hex")}`, "content-type": "application/json" } };
  }

  parseWebhook(input: { rawBody: string; headers: Record<string, string | undefined>; now: Date }): ProviderResult<BillingEvent> {
    const header = input.headers[DEV_SIGNATURE_HEADER];
    const m = header ? /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header) : null;
    if (!m) return fail("permission_denied", "Missing or malformed signature");
    const t = Number(m[1]);
    if (Math.abs(input.now.getTime() / 1000 - t) > WEBHOOK_TOLERANCE_SECONDS) return fail("permission_denied", "Stale notification (possible replay)");
    const expected = Buffer.from(createHmac("sha256", this.config.dev.secret).update(`${t}.${input.rawBody}`).digest("hex"));
    const given = Buffer.from(m[2]!);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return fail("permission_denied", "Invalid signature");
    try {
      const e = JSON.parse(input.rawBody) as { id: string; type: BillingEventType; occurredAt: string; transaction: VerifiedTransaction & { periodEnd: string; graceEnd: string | null } };
      return {
        ok: true,
        value: { id: e.id, type: e.type, occurredAt: new Date(e.occurredAt), transaction: { ...e.transaction, periodEnd: new Date(e.transaction.periodEnd), graceEnd: e.transaction.graceEnd ? new Date(e.transaction.graceEnd) : null, environment: "development" } },
      };
    } catch {
      return fail("invalid_input", "Malformed notification");
    }
  }

  /**
   * Changes a subscription in the store (what time, the user or the bank would do) and returns the
   * signed notification the store sends about it.
   */
  simulate(originalTransactionId: string, what: DevSimulation): ProviderResult<{ body: string; headers: Record<string, string> }> {
    const row = this.db.prepare("SELECT * FROM dev_store_transactions WHERE original_transaction_id = ?").get(originalTransactionId) as TxnRow | undefined;
    if (!row) return fail("invalid_input", "Unknown transaction");
    const now = this.now();
    const plan = this.planOf(row.product_id) ?? "monthly";
    let next: Partial<Pick<TxnRow, "status" | "auto_renew" | "period_end" | "grace_end">> = {};
    let type: BillingEventType;
    switch (what) {
      case "renew":
        next = { status: "active", period_end: addPeriod(new Date(Math.max(now.getTime(), Date.parse(row.period_end))), plan).toISOString(), grace_end: null };
        type = "renewed";
        break;
      case "cancel":
        next = { auto_renew: 0 };
        type = "cancelled";
        break;
      case "resume":
        next = { auto_renew: 1 };
        type = "resumed";
        break;
      case "billing_issue":
        next = { status: "grace_period", grace_end: new Date(now.getTime() + this.config.graceDays * 86_400_000).toISOString() };
        type = "grace_period";
        break;
      case "grace_expired":
        next = { status: "billing_retry" };
        type = "billing_issue";
        break;
      case "recover":
        next = { status: "active", period_end: addPeriod(now, plan).toISOString(), grace_end: null };
        type = "recovered";
        break;
      case "expire":
        next = { status: "expired", auto_renew: 0 };
        type = "expired";
        break;
      case "refund":
        next = { status: "revoked", auto_renew: 0 };
        type = "refunded";
        break;
    }
    const merged = { ...row, ...next };
    this.db
      .prepare("UPDATE dev_store_transactions SET status = ?, auto_renew = ?, period_end = ?, grace_end = ?, updated_at = ? WHERE original_transaction_id = ?")
      .run(merged.status, merged.auto_renew, merged.period_end, merged.grace_end, now.toISOString(), originalTransactionId);
    return { ok: true, value: this.signNotification({ id: `devevt_${randomUUID()}`, type, occurredAt: now.toISOString(), transaction: this.txn(originalTransactionId)! }) };
  }

  manageUrl(): string | null {
    // The development store has no account page; the app shows its sandbox controls instead.
    return null;
  }
}
