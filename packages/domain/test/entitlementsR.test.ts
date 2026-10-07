import { describe, expect, it } from "vitest";
import { FREE_LIMITS, hasFeature, PREMIUM_FEATURE_IDS, PREMIUM_FEATURES, recordFromTransaction, resolveEntitlements, type SubscriptionRecord } from "../src";

const now = new Date("2026-10-02T12:00:00Z");
const later = new Date("2026-11-02T12:00:00Z");
const earlier = new Date("2026-09-02T12:00:00Z");
const sub = (over: Partial<SubscriptionRecord> = {}): SubscriptionRecord => ({
  status: "active",
  autoRenew: true,
  productId: "form_pro_monthly",
  periodEnd: later,
  graceEnd: null,
  source: "store",
  environment: "production",
  ...over,
});

describe("premium feature registry", () => {
  it("describes every Pro feature, and what Free keeps, in one place", () => {
    expect(PREMIUM_FEATURES.map((f) => f.id)).toEqual([...PREMIUM_FEATURE_IDS]);
    for (const f of PREMIUM_FEATURES) expect([f.title, f.pro, f.free].every((x) => x.length > 0)).toBe(true);
    expect(FREE_LIMITS.foodScansPerDay).toBeGreaterThan(0); // Free scanning exists
  });
});

describe("subscription state machine", () => {
  it("Free without a subscription", () => {
    expect(resolveEntitlements(null, now)).toMatchObject({ tier: "free", state: "FREE", features: [] });
  });

  it("trial and active grant every Pro feature until the period ends", () => {
    expect(resolveEntitlements(sub({ status: "trial" }), now)).toMatchObject({ tier: "pro", state: "PRO_TRIAL", accessUntil: later, willRenew: true });
    const active = resolveEntitlements(sub(), now);
    expect(active).toMatchObject({ tier: "pro", state: "PRO_ACTIVE" });
    expect(PREMIUM_FEATURE_IDS.every((f) => hasFeature(active, f))).toBe(true);
  });

  it("cancelling keeps Pro until the paid period actually ends", () => {
    expect(resolveEntitlements(sub({ autoRenew: false }), now)).toMatchObject({ tier: "pro", state: "PRO_CANCELLED", accessUntil: later, willRenew: false });
    expect(resolveEntitlements(sub({ autoRenew: false, periodEnd: earlier }), now)).toMatchObject({ tier: "free", state: "PRO_EXPIRED" });
  });

  it("a billing problem keeps access through grace, then stops (history is untouched by design)", () => {
    expect(resolveEntitlements(sub({ status: "grace_period", periodEnd: earlier, graceEnd: later }), now)).toMatchObject({ tier: "pro", state: "PRO_GRACE_PERIOD", accessUntil: later });
    expect(resolveEntitlements(sub({ status: "grace_period", periodEnd: earlier, graceEnd: earlier }), now)).toMatchObject({ tier: "free", state: "PRO_BILLING_ISSUE" });
    expect(resolveEntitlements(sub({ status: "billing_retry", periodEnd: earlier }), now)).toMatchObject({ tier: "free", state: "PRO_BILLING_ISSUE" });
  });

  it("a refund or revocation ends access at once, even mid-period", () => {
    expect(resolveEntitlements(sub({ status: "revoked" }), now)).toMatchObject({ tier: "free", state: "PRO_EXPIRED" });
    expect(resolveEntitlements(sub({ status: "expired" }), now)).toMatchObject({ tier: "free", state: "PRO_EXPIRED" });
  });

  it("carries the environment, so sandbox purchases are never mistaken for production", () => {
    const t = { productId: "form_pro_annual", originalTransactionId: "t1", status: "active" as const, autoRenew: true, periodEnd: later, graceEnd: null, environment: "development" as const };
    expect(resolveEntitlements(recordFromTransaction(t, "development"), now)).toMatchObject({ tier: "pro", environment: "development", source: "development", productId: "form_pro_annual" });
  });
});
