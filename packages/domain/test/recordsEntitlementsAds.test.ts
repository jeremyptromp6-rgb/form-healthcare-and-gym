import { describe, expect, it } from "vitest";
import {
  createUnconfiguredProviders,
  detectPrs,
  estimateOneRepMax,
  EXERCISES,
  ROM_SPECS,
  providerStatuses,
  requestAd,
  resolveEntitlements,
  type AdProvider,
} from "../src";

describe("PersonalRecord system", () => {
  it("estimates 1RM with Epley and refuses unreliable high-rep estimates", () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 5)).toBe(116.7);
    expect(estimateOneRepMax(100, 15)).toBeNull();
    expect(estimateOneRepMax(0, 5)).toBeNull();
  });

  it("awards a first PR", () => {
    const prs = detectPrs({ bestLoadKg: null, bestEstimated1RmKg: null, bestReps: null }, { loadKg: 60, verifiedReps: 5 });
    expect(prs.map((p) => p.kind).sort()).toEqual(["estimated_1rm", "max_load"]);
    expect(prs.every((p) => p.status === "awarded")).toBe(true);
  });

  it("never awards a PR from unverified reps", () => {
    expect(detectPrs({ bestLoadKg: null, bestEstimated1RmKg: null, bestReps: null }, { loadKg: 200, verifiedReps: 0 })).toEqual([]);
  });

  it("holds implausible jumps for review", () => {
    const prs = detectPrs({ bestLoadKg: 100, bestEstimated1RmKg: 110, bestReps: null }, { loadKg: 140, verifiedReps: 1 });
    expect(prs.find((p) => p.kind === "max_load")?.status).toBe("needs_review");
  });

  it("does not award equal or lower values", () => {
    expect(detectPrs({ bestLoadKg: 100, bestEstimated1RmKg: 130, bestReps: null }, { loadKg: 100, verifiedReps: 3 })).toEqual([]);
  });

  it("tracks rep PRs for bodyweight movements", () => {
    const prs = detectPrs({ bestLoadKg: null, bestEstimated1RmKg: null, bestReps: 20 }, { loadKg: 0, verifiedReps: 22 });
    expect(prs).toEqual([{ kind: "max_reps", value: 22, previous: 20, status: "awarded" }]);
  });
});

describe("AdService", () => {
  const free = resolveEntitlements(null, new Date());
  const pro = resolveEntitlements({ status: "active", autoRenew: true, productId: "p", periodEnd: new Date(Date.now() + 1e9), graceEnd: null, source: "admin_grant", environment: "development" }, new Date());
  const working: AdProvider = {
    kind: "ads",
    status: () => ({ state: "ready", provider: "test" }),
    requestAd: async (r) => ({ ok: true, value: { adId: "a1", network: "test", placement: r.placement } }),
  };

  it("never serves ads to pro users", async () => {
    expect(await requestAd({ entitlements: pro, placement: "home_feed", personalizedConsent: true, provider: working })).toMatchObject({
      served: false,
      reason: "pro_user",
    });
  });

  it("never serves ads during a workout", async () => {
    expect(await requestAd({ entitlements: free, placement: "workout_active", personalizedConsent: true, provider: working })).toMatchObject({
      reason: "placement_not_allowed",
    });
  });

  it("reports an unconfigured provider honestly instead of pretending an ad was served", async () => {
    const { ads } = createUnconfiguredProviders();
    const d = await requestAd({ entitlements: free, placement: "home_feed", personalizedConsent: false, provider: ads });
    expect(d).toEqual({ served: false, reason: "provider_unconfigured", retryable: false });
  });

  it("serves an ad when a provider works", async () => {
    const d = await requestAd({ entitlements: free, placement: "home_feed", personalizedConsent: false, provider: working });
    expect(d.served).toBe(true);
  });
});

describe("Exercise catalog", () => {
  it("marks exactly the movements with ROM specs as camera-verifiable", () => {
    expect(EXERCISES.filter((e) => e.cameraVerifiable).map((e) => e.id).sort()).toEqual(Object.keys(ROM_SPECS).sort());
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
  });
});

describe("Provider registry", () => {
  it("labels each status with its provider kind", () => {
    expect(providerStatuses(createUnconfiguredProviders()).map((s) => s.kind).sort()).toEqual(
      ["ads", "ai", "analytics", "billing", "food_recognition", "notifications", "pose"],
    );
  });

  it("reports every provider as unconfigured by default, and every call fails honestly", async () => {
    const reg = createUnconfiguredProviders();
    expect(providerStatuses(reg).every((s) => s.state === "unconfigured")).toBe(true);
    const reply = await reg.ai.respond({ context: {} as never, topic: "chat", message: "hi", history: [] });
    expect(reply).toMatchObject({ ok: false, code: "unconfigured", retryable: false });
    const purchase = await reg.billing.verifyPurchase({ platform: "ios", productId: "p", receipt: "fake" });
    expect(purchase.ok).toBe(false);
  });
});
