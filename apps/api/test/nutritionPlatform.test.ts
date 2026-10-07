import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, type ProviderRegistry } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { allow, foodLog, makeApp, PROFILE, registerUser, TestClock, testConfig, TODAY, YESTERDAY } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

describe("profile & targets", () => {
  it("computes targets server-side and rejects unsafe profiles", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { ...PROFILE, localDate: TODAY } });
    expect(res.statusCode).toBe(200);
    expect(res.json().targets.targetKcal).toBe(2759);
    const bad = await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { ...PROFILE, weightKg: 5, localDate: TODAY } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("nutrition logs", () => {
  it("logs food and labels estimates as estimates; scanned food must go through the scan flow", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: TODAY }) });
    await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: TODAY, name: "Pasta (guess)", grams: null, kcal: 700 }) });
    const day = (await app.inject({ method: "GET", url: `/nutrition/days/${TODAY}`, headers: u.auth })).json();
    expect(day.totals.kcal).toBe(1000);
    expect(day.totals.estimatedKcalShare).toBe(0.7);
    expect(day.logs.map((e: { isEstimate: boolean }) => e.isEstimate)).toEqual([false, true]);
    expect(day.targets).toBeNull();
    expect(day.xp).toBeNull();
    const scan = await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: { clientLogId: crypto.randomUUID(), amountMethod: "estimated", scan: { label: "pasta" } } });
    expect(scan.statusCode).toBe(422);
    expect(scan.json().error.code).toBe("use_scan_flow");
  });

  it("requires an amount for measured entries and rejects absurd or implausible values", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const post = (p: object) => app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: p });
    expect((await post(foodLog({ localDate: TODAY, grams: null, amountMethod: "measured" }))).statusCode).toBe(422);
    expect((await post(foodLog({ localDate: TODAY, kcal: -5 }))).statusCode).toBe(400);
    expect((await post(foodLog({ localDate: "2026-08-01" }))).statusCode).toBe(422);
    expect((await post({ ...foodLog({ localDate: TODAY }), extra: true })).statusCode).toBe(400);
    expect((await post({ ...foodLog({ localDate: TODAY }), source: "verified_database" })).statusCode).toBe(400);
  });

  it("does not let one user read or delete another user's logs", async () => {
    ({ app } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    const created = (await app.inject({ method: "POST", url: "/nutrition/logs", headers: a.auth, payload: foodLog({ localDate: TODAY }) })).json();
    expect((await app.inject({ method: "GET", url: `/nutrition/days/${TODAY}`, headers: b.auth })).json().logs).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `/nutrition/logs/${created.log.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/nutrition/logs/${created.log.id}`, headers: a.auth })).statusCode).toBe(204);
  });
});

describe("nutrition XP ledger", () => {
  /** Sets the profile on day 1 (so targets are in force that day), logs `kcalEach` × 4 that day, then moves to day 2. */
  async function dayOfEating(kcalEach: number) {
    const clock = new TestClock(new Date(`${YESTERDAY}T12:00:00Z`));
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { ...PROFILE, localDate: YESTERDAY } });
    for (let i = 0; i < 4; i++) {
      await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: YESTERDAY, kcal: kcalEach }) });
    }
    clock.set(`${TODAY}T12:00:00Z`);
    return u;
  }

  it("counts today's nutrition XP as provisional until the day ends", async () => {
    const clock = new TestClock();
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { ...PROFILE, localDate: TODAY } });
    await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: TODAY }) });
    const p = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    expect(p.provisionalXp).toBe(5);
    expect(p.xpSources.nutrition).toBe(5);
    const events = (await app.inject({ method: "GET", url: "/xp/events", headers: u.auth })).json().events;
    expect(events).toEqual([]);
  });

  it("settles a healthy completed day into the ledger with the on-target bonus", async () => {
    const u = await dayOfEating(690);
    const p = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    expect(p.xpSources.nutrition).toBe(20 + 20);
    const events = (await app.inject({ method: "GET", url: "/xp/events", headers: u.auth })).json().events;
    expect(events).toEqual([expect.objectContaining({ source: "nutrition_day", reference: YESTERDAY, kind: "award", xp: 40, detail: { flags: ["on_target"] } })]);
  });

  it("never awards XP for a completed day below the safe floor", async () => {
    const u = await dayOfEating(150);
    const p = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    expect(p.xpSources.nutrition).toBe(0);
    const day = (await app.inject({ method: "GET", url: `/nutrition/days/${YESTERDAY}?today=${TODAY}`, headers: u.auth })).json();
    expect(day.xp).toMatchObject({ xp: 0, flags: ["below_safe_minimum"], settled: true });
  });

  it("re-settles a completed day after a late edit, deterministically", async () => {
    const u = await dayOfEating(150); // 600 kcal: below floor
    await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth });
    // Forgot to log dinner yesterday: add it now.
    await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: YESTERDAY, name: "Dinner", kcal: 2150 }) });
    const p = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    expect(p.xpSources.nutrition).toBe(20 + 20); // 5 logs capped at 4 × 5, plus on-target (2750 vs 2759)
  });

  it("does not rewrite past XP when the profile changes", async () => {
    const u = await dayOfEating(690);
    const before = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { ...PROFILE, weightKg: 120, localDate: TODAY } });
    const after = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    expect(after.xpSources.nutrition).toBe(before.xpSources.nutrition);
  });

  it("gives no nutrition XP for days before any targets existed", async () => {
    const clock = new TestClock(new Date(`${YESTERDAY}T12:00:00Z`));
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: YESTERDAY, kcal: 2700 }) });
    clock.set(`${TODAY}T12:00:00Z`);
    await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { ...PROFILE, localDate: TODAY } });
    const p = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    expect(p.xpSources.nutrition).toBe(0);
  });
});

describe("providers, entitlements, ads and coach", () => {
  it("reports every provider as unconfigured", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = (await app.inject({ method: "GET", url: "/system/providers", headers: u.auth })).json();
    expect(res.providers).toHaveLength(7);
    expect(res.providers.every((p: { state: string }) => p.state === "unconfigured")).toBe(true);
  });

  it("does not disclose missing secret names in production", async () => {
    ({ app } = await makeApp({ config: { env: "production" } }));
    const u = await registerUser(app);
    const res = (await app.inject({ method: "GET", url: "/system/providers", headers: u.auth })).json();
    expect(res.providers.every((p: { missing?: unknown }) => p.missing === undefined)).toBe(true);
  });

  it("serves the exercise catalog and the rank ladder from the server", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const ex = (await app.inject({ method: "GET", url: "/exercises", headers: u.auth })).json();
    expect(ex.exercises.find((e: { id: string }) => e.id === "squat").cameraVerifiable).toBe(true);
    expect(ex.exercises.find((e: { id: string }) => e.id === "bench_press").cameraVerifiable).toBe(false);
    const progress = (await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: u.auth })).json();
    expect(progress.rankLadder[0]).toEqual({ name: "Rookie", minLevel: 1, xpRequired: 0 });
    expect(progress.rankLadder).toHaveLength(7);
  });

  it("requires authentication for every non-auth endpoint", async () => {
    ({ app } = await makeApp());
    for (const [method, url] of [
      ["GET", "/me"],
      ["PATCH", "/me/profile"],
      ["PATCH", "/me/preferences"],
      ["GET", "/me/personalization"],
      ["GET", "/me/weight"],
      ["POST", "/me/weight"],
      ["DELETE", "/me/weight/2026-09-27"],
      ["GET", "/me/photo"],
      ["PUT", "/me/photo"],
      ["DELETE", "/me/photo"],
      ["GET", "/catalog/profile-options"],
      ["GET", "/me/settings"],
      ["PATCH", "/me/settings"],
      ["GET", "/onboarding"],
      ["POST", "/onboarding/complete"],
      ["DELETE", "/me"],
      ["POST", "/auth/logout-all"],
      ["GET", `/progress?today=${TODAY}`],
      ["GET", "/xp/events"],
      ["POST", "/workouts"],
      ["GET", "/workouts"],
      ["GET", "/records"],
      ["GET", "/exercises"],
      ["POST", "/nutrition/logs"],
      ["GET", `/nutrition/days/${TODAY}`],
      ["DELETE", "/nutrition/logs/00000000-0000-4000-8000-000000000000"],
      ["GET", "/entitlements"],
      ["POST", "/billing/verify"],
      ["GET", "/ads/decision?placement=home_feed"],
      ["POST", "/coach/messages"],
      ["GET", "/system/providers"],
      ["GET", "/system/features"],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("starts free, and an unconfigured billing provider never grants Pro", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await app.inject({ method: "GET", url: "/entitlements", headers: u.auth })).json().tier).toBe("free");
    const verify = await app.inject({ method: "POST", url: "/billing/verify", headers: u.auth, payload: { platform: "ios", productId: "form_pro_monthly", receipt: "fake-receipt" } });
    expect(verify.statusCode).toBe(503);
    expect(verify.json().error.code).toBe("provider_unconfigured");
    expect((await app.inject({ method: "GET", url: "/entitlements", headers: u.auth })).json().tier).toBe("free");
  });

  it("grants Pro only after the billing provider verifies the receipt", async () => {
    const providers: ProviderRegistry = {
      ...createUnconfiguredProviders(),
      billing: {
        kind: "billing",
        environment: "sandbox",
        status: () => ({ state: "ready", provider: "test-billing" }),
        products: async () => ({ ok: true, value: [] }),
        verifyPurchase: async (r) =>
          r.receipt === "valid"
            ? { ok: true, value: { productId: r.productId, originalTransactionId: "t1", status: "active", autoRenew: true, periodEnd: new Date("2026-10-27T00:00:00Z"), graceEnd: null, environment: "sandbox" } }
            : { ok: false, code: "invalid_input", message: "Receipt rejected by store", retryable: false },
        restore: async () => ({ ok: true, value: [] }),
        parseWebhook: () => ({ ok: false, code: "unconfigured", message: "n/a", retryable: false }),
        manageUrl: () => null,
      },
    };
    ({ app } = await makeApp({ providers }));
    const u = await registerUser(app);
    expect((await app.inject({ method: "POST", url: "/billing/verify", headers: u.auth, payload: { platform: "ios", productId: "form_pro_monthly", receipt: "forged" } })).statusCode).toBe(502);
    const ok = await app.inject({ method: "POST", url: "/billing/verify", headers: u.auth, payload: { platform: "ios", productId: "form_pro_monthly", receipt: "valid" } });
    expect(ok.json().tier).toBe("pro");
    const ad = (await app.inject({ method: "GET", url: "/ads/decision?placement=home_feed", headers: u.auth })).json();
    expect(ad).toMatchObject({ served: false, reason: "pro_user" });
  });

  it("reports the ad provider as unconfigured instead of pretending an ad was served", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const ad = (await app.inject({ method: "GET", url: "/ads/decision?placement=home_feed", headers: u.auth })).json();
    expect(ad).toEqual({ served: false, reason: "provider_unconfigured", retryable: false });
  });

  it("passes the user's stored ad-personalization consent to the ad provider", async () => {
    const seen: boolean[] = [];
    const providers: ProviderRegistry = {
      ...createUnconfiguredProviders(),
      ads: {
        kind: "ads",
        status: () => ({ state: "ready", provider: "test-ads" }),
        requestAd: async (r) => {
          seen.push(r.personalized);
          return { ok: true, value: { adId: "a1", network: "test", placement: r.placement } };
        },
      },
    };
    ({ app } = await makeApp({ providers }));
    const u = await registerUser(app);
    await app.inject({ method: "GET", url: "/ads/decision?placement=home_feed", headers: u.auth });
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { personalizedAdsConsent: true } });
    await app.inject({ method: "GET", url: "/ads/decision?placement=home_feed", headers: u.auth });
    expect(seen).toEqual([false, true]);
  });

  it("builds a real coach context, and is honest when the coach is off or only rules are available", async () => {
    let received: unknown = null;
    ({ app } = await makeApp({ config: { coach: { ...testConfig.coach, provider: "none" } } }));
    const u = await registerUser(app);
    const res = await app.inject({ method: "POST", url: "/coach/messages", headers: u.auth, payload: { message: "How do I squat deeper?", clientMessageId: randomUUID(), today: TODAY } });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: "coach_unavailable" });

    const providers: ProviderRegistry = {
      ...createUnconfiguredProviders(),
      ai: {
        kind: "ai",
        status: () => ({ state: "ready", provider: "test-ai" }),
        respond: async (r) => {
          received = r.context;
          return { ok: true as const, value: { message: "Keep going.", category: "general", priority: "normal", evidence: [{ fact: "training.workoutsLast7Days", claim: "Workouts this week" }], actions: [], confidence: "medium" } };
        },
      },
    };
    await app.close();
    ({ app } = await makeApp({ providers, config: { coach: { ...testConfig.coach, provider: "anthropic" } } }));
    const v = await registerUser(app);
    await allow(app, v.auth, { aiCoach: true });
    await app.inject({ method: "PATCH", url: "/me/profile", headers: v.auth, payload: { ...PROFILE, primaryGoal: "build_muscle", localDate: TODAY } });
    await app.inject({ method: "POST", url: "/coach/messages", headers: v.auth, payload: { message: "hi", clientMessageId: randomUUID(), today: TODAY } });
    expect((received as { facts: Record<string, unknown> }).facts).toMatchObject({ "profile.goal": "build_muscle", "profile.experience": "intermediate", "progression.level": 1, "progression.rank": "Rookie", "streaks.workout.current": 0, "training.workoutsLast7Days": 0 });
    expect(JSON.stringify(received)).not.toContain(v.email);
  });
});
