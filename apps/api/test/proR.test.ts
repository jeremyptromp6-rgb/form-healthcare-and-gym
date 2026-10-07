/**
 * Stage R — FORM Pro: entitlements, the development (sandbox) store's full subscription lifecycle,
 * webhook security, server-side gating and Free allowances.
 */
import { createHmac, randomUUID } from "node:crypto";
import { createUnconfiguredProviders, type AiCoachProvider, type FoodRecognitionProvider } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AppContext } from "../src/app";
import { loadConfig } from "../src/config";
import { DEV_SIGNATURE_HEADER } from "../src/providers/devBilling";
import { allow, foodLog, makeApp, onboard, registerUser, squatTrace, testConfig, TestClock, workoutPayload } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const call = (auth: Auth | null, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: method as "GET", url, headers: { ...(auth ?? {}), ...headers }, ...(payload !== undefined ? { payload: payload as object } : {}) });
const json = async (auth: Auth | null, method: string, url: string, payload?: unknown) => (await call(auth, method, url, payload)).json();
const devBilling = (over: Partial<typeof testConfig.billing> = {}) => ({ billing: { ...testConfig.billing, provider: "development" as const, ...over } });
const MONTHLY = testConfig.billing.products.monthly;
const ANNUAL = testConfig.billing.products.annual;

type MakeOpts = NonNullable<Parameters<typeof makeApp>[0]>;
async function setup(opts: { config?: MakeOpts["config"]; clock?: TestClock; providers?: MakeOpts["providers"] } = {}) {
  const clock = opts.clock ?? new TestClock(new Date("2026-10-05T12:00:00Z"));
  ({ app, ctx } = await makeApp({ clock, config: { ...devBilling(), ...opts.config }, providers: opts.providers }));
  const u = await registerUser(app);
  await call(u.auth, "PATCH", "/me/settings", { timezone: "UTC" });
  await onboard(app, u.auth, "2026-10-05");
  return { ...u, clock };
}

/** The app's purchase flow against the sandbox store: checkout (store) → verify (server). */
async function buy(auth: Auth, productId = MONTHLY, storeAccount = randomUUID()) {
  const { receipt } = await json(auth, "POST", "/billing/dev/checkout", { productId, storeAccount });
  const verified = await call(auth, "POST", "/billing/verify", { platform: "ios", productId, receipt });
  return { receipt, storeAccount, status: verified.statusCode, entitlements: verified.json() };
}
const simulate = (auth: Auth, event: string) => json(auth, "POST", "/billing/dev/simulate", { event });
const ent = (auth: Auth) => json(auth, "GET", "/entitlements");

describe("Free and Pro", () => {
  it("Free is useful and honest about its allowances; Pro unlocks the premium layer", async () => {
    const u = await setup();
    const free = await ent(u.auth);
    expect(free).toMatchObject({ tier: "free", state: "FREE", features: [], limits: { foodScansPerDay: 3, coachChatPerDay: 5, mealPlanDays: 1, analyticsRangeDays: 30 }, usage: { foodScansToday: 0, coachChatsToday: 0 } });
    // Free keeps the core: logging, workouts, one-day plans, 30-day progress, Body Quest.
    expect((await call(u.auth, "POST", "/workouts", workoutPayload({ localDate: "2026-10-05" }))).statusCode).toBe(201);
    expect((await call(u.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 1 })).statusCode).toBe(201);
    expect((await call(u.auth, "GET", "/analytics/progress?range=30")).statusCode).toBe(200);
    expect((await json(u.auth, "GET", "/body-quest")).bodyQuest).toBeTruthy();
    // Pro features answer 402 with the feature id — one paywall for every client.
    for (const [method, url, body, feature] of [
      ["POST", "/meal-plans", { clientPlanId: randomUUID(), days: 7 }, "MEAL_PLANNER_ADVANCED"],
      ["GET", "/meal-plans/rest-of-today", undefined, "MEAL_PLANNER_ADVANCED"],
      ["GET", "/analytics/progress?range=90", undefined, "ADVANCED_PROGRESS"],
      ["GET", "/exercises/squat/form-intelligence", undefined, "ADVANCED_FORM_ANALYSIS"],
      ["POST", "/reports/weekly", undefined, "WEEKLY_AI_REPORT"],
    ] as const) {
      const r = await call(u.auth, method, url, body);
      expect([url, r.statusCode, r.json().error.code, r.json().error.details.feature]).toEqual([url, 402, "pro_required", feature]);
    }
    // Locked analytics sections carry no data at all — the server never sends what Free can't see.
    const a = (await json(u.auth, "GET", "/analytics/progress?range=30")).analytics;
    expect(a.form).toMatchObject({ available: false, locked: { feature: "ADVANCED_FORM_ANALYSIS" }, data: { averageScore: null, reps: 0, chart: { points: [], state: "no_data" } } });
    expect(a.rom.locked.feature).toBe("ADVANCED_ROM_ANALYSIS");
    expect(a.strength.locked ?? null).toBeNull();
    expect((await json(u.auth, "GET", "/body-quest")).insights).toBeNull();
    expect((await json(u.auth, "GET", "/workouts/today")).plan.generator.id).toBe("rule_based");

    // Upgrade through the sandbox store.
    const bought = await buy(u.auth);
    expect(bought.status).toBe(200);
    expect(bought.entitlements).toMatchObject({ tier: "pro", state: "PRO_ACTIVE", environment: "development", source: "development", productId: MONTHLY, willRenew: true });
    for (const url of ["/analytics/progress?range=90", "/exercises/squat/form-intelligence", "/meal-plans/rest-of-today"]) expect([url, (await call(u.auth, "GET", url)).statusCode]).toEqual([url, 200]);
    expect((await call(u.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 7 })).statusCode).toBe(201);
    expect((await json(u.auth, "GET", "/analytics/progress?range=30")).analytics.form.locked ?? null).toBeNull();
    expect((await json(u.auth, "GET", "/body-quest")).insights.stats).toHaveLength(6);
    // Today's plan is rebuilt by the adaptive generator now that the user has it.
    expect((await json(u.auth, "GET", "/workouts/today")).plan.generator.id).toBe("adaptive");
    expect((await ent(u.auth)).limits).toBeNull();
  });
});

describe("Free allowances", () => {
  const recogniser: FoodRecognitionProvider = {
    kind: "food_recognition",
    development: false,
    status: () => ({ state: "ready", provider: "Test recogniser" }),
    recognize: async () => ({ ok: true, value: { imageQuality: "ok", containsFood: false, items: [] } }),
  };
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]).toString("base64");
  const scan = (auth: Auth, clientScanId = randomUUID()) => call(auth, "POST", "/nutrition/scans", { clientScanId, image: { mimeType: "image/jpeg", data: jpeg } });

  it("meal scans: 3 a day free, then a useful paywall — weighing, search and manual logging stay unlimited", async () => {
    const u = await setup({ providers: { ...createUnconfiguredProviders(), food: recogniser }, config: { foodRecognition: { ...testConfig.foodRecognition, provider: "anthropic" } } });
    await allow(app, u.auth, { foodScans: true });
    const first = randomUUID();
    for (const id of [first, randomUUID(), randomUUID()]) expect((await scan(u.auth, id)).statusCode).toBe(201);
    expect((await scan(u.auth, first)).statusCode).toBe(200); // a retry of an earlier scan is never blocked
    const fourth = await scan(u.auth);
    expect(fourth.statusCode).toBe(402);
    expect(fourth.json().error).toMatchObject({ code: "pro_required", details: { feature: "FOOD_SCANNER_PREMIUM" } });
    expect(fourth.json().error.message).toContain("Weighing, search and labels are always unlimited");
    expect((await call(u.auth, "POST", "/nutrition/logs", { clientLogId: randomUUID(), amountMethod: "measured", food: { foodId: "fdb:banana", quantity: 118, unit: "g" } })).statusCode).toBe(201);
    expect((await call(u.auth, "POST", "/nutrition/logs", foodLog())).statusCode).toBe(201);
    expect((await ent(u.auth)).usage.foodScansToday).toBe(3);
    // Tomorrow the allowance is back.
    u.clock.set("2026-10-06T12:00:00Z");
    expect((await scan(u.auth)).statusCode).toBe(201);
    // Pro scans past the free allowance.
    await buy(u.auth);
    for (let i = 0; i < 4; i++) expect((await scan(u.auth)).statusCode).toBe(201);
  });

  it("coach: a few chats and AI answers a day free; Pro gets the configured limits", async () => {
    let aiCalls = 0;
    const ai: AiCoachProvider = {
      kind: "ai",
      status: () => ({ state: "ready", provider: "Test AI" }),
      respond: async () => (aiCalls++, { ok: true, value: { message: "Keep the next session steady.", category: "consistency", priority: "normal", evidence: [{ fact: "training.workoutsLast7Days", claim: "Sessions" }], actions: [], confidence: "high" } }),
    };
    const u = await setup({ providers: { ...createUnconfiguredProviders(), ai }, config: { coach: { ...testConfig.coach, provider: "anthropic" } } });
    await allow(app, u.auth, { aiCoach: true });
    const replies = [];
    for (let i = 0; i < 5; i++) replies.push((await json(u.auth, "POST", "/coach/messages", { clientMessageId: randomUUID(), message: `How am I doing ${i}?` })).response);
    // 3 real AI answers, then labelled rule-based ones — never an unlabelled downgrade.
    expect(replies.map((r) => r.provider.type)).toEqual(["real_ai", "real_ai", "real_ai", "deterministic_fallback", "deterministic_fallback"]);
    expect(replies[3].degraded).toBe("daily_limit");
    const sixth = await call(u.auth, "POST", "/coach/messages", { clientMessageId: randomUUID(), message: "One more?" });
    expect(sixth.statusCode).toBe(402);
    expect(sixth.json().error.details.feature).toBe("AI_COACH_ADVANCED");
    // Daily tips keep working on Free.
    expect((await call(u.auth, "GET", "/coach/insight?topic=home")).statusCode).toBe(200);
    await buy(u.auth);
    const pro = await json(u.auth, "POST", "/coach/messages", { clientMessageId: randomUUID(), message: "And now?" });
    expect(pro.response.provider.type).toBe("real_ai");
    expect(aiCalls).toBe(4);
  });
});

describe("subscription lifecycle (development store)", () => {
  it("products come from the provider — prices configured, trial only when configured", async () => {
    const u = await setup();
    const p = await json(u.auth, "GET", "/billing/products?platform=ios");
    expect(p.provider).toMatchObject({ configured: true, environment: "development" });
    expect(p.products.map((x: { id: string; plan: string; price: { display: string }; trialDays: number | null }) => [x.id, x.plan, x.price.display, x.trialDays])).toEqual([
      [MONTHLY, "monthly", "$9.99", null],
      [ANNUAL, "annual", "$59.99", null],
    ]);
    expect(p.features).toHaveLength(11);
    expect(p.manageUrl).toBeNull(); // the sandbox has no store account page
    await app.close();
    const t = await setup({ config: devBilling({ trialDays: 7 }) });
    expect((await json(t.auth, "GET", "/billing/products")).products[0].trialDays).toBe(7);
    expect((await buy(t.auth)).entitlements).toMatchObject({ state: "PRO_TRIAL", accessUntil: "2026-10-12T12:00:00.000Z" });
  });

  it("purchase → renewal → cancellation keeps access until the period ends → expiry; history is never deleted", async () => {
    const u = await setup();
    expect((await call(u.auth, "POST", "/workouts", workoutPayload({ localDate: "2026-10-05" }))).statusCode).toBe(201);
    const { entitlements } = await buy(u.auth, ANNUAL);
    expect(entitlements).toMatchObject({ state: "PRO_ACTIVE", accessUntil: "2027-10-05T12:00:00.000Z" });
    u.clock.set("2026-10-13T12:00:00Z");
    const report = await json(u.auth, "POST", "/reports/weekly");
    expect(report.weekStart).toBe("2026-10-05");
    expect(report.report.training.workouts).toBe(1);
    expect((await simulate(u.auth, "renew")).entitlements.accessUntil).toBe("2028-10-05T12:00:00.000Z");
    const cancelled = (await simulate(u.auth, "cancel")).entitlements;
    expect(cancelled).toMatchObject({ tier: "pro", state: "PRO_CANCELLED", willRenew: false }); // still Pro after cancelling
    expect((await simulate(u.auth, "resume")).entitlements.state).toBe("PRO_ACTIVE");
    const expired = (await simulate(u.auth, "expire")).entitlements;
    expect(expired).toMatchObject({ tier: "free", state: "PRO_EXPIRED", features: [] });
    // Only future Pro features stop: workouts, the report already made, everything else stays.
    expect((await json(u.auth, "GET", "/workouts")).workouts).toHaveLength(1);
    const reports = await json(u.auth, "GET", "/reports/weekly");
    expect(reports).toMatchObject({ canGenerate: false, reports: [{ weekStart: "2026-10-05" }] });
    expect((await call(u.auth, "GET", "/analytics/progress?range=90")).statusCode).toBe(402);
  });

  it("billing problems: grace keeps access, then it stops until payment recovers; a refund ends it at once", async () => {
    const u = await setup();
    await buy(u.auth);
    expect((await simulate(u.auth, "billing_issue")).entitlements).toMatchObject({ tier: "pro", state: "PRO_GRACE_PERIOD", accessUntil: "2026-10-21T12:00:00.000Z" });
    expect((await simulate(u.auth, "grace_expired")).entitlements).toMatchObject({ tier: "free", state: "PRO_BILLING_ISSUE" });
    expect((await simulate(u.auth, "recover")).entitlements).toMatchObject({ tier: "pro", state: "PRO_ACTIVE" });
    expect((await simulate(u.auth, "refund")).entitlements).toMatchObject({ tier: "free", state: "PRO_EXPIRED" });
  });

  it("survives a restart, restores on another device, and one store subscription unlocks one FORM account", async () => {
    const u = await setup();
    const { storeAccount } = await buy(u.auth);
    // App restart / new sign-in: the server's state is the truth.
    const again = await json(null, "POST", "/auth/login", { email: u.email, password: "correct-horse-battery" });
    expect((await ent({ authorization: `Bearer ${again.token}` })).tier).toBe("pro");
    // Account switch on the same device: the other account is Free, and can't borrow this purchase.
    const other = await registerUser(app);
    expect((await ent(other.auth)).tier).toBe("free");
    const { receipts } = await json(other.auth, "POST", "/billing/dev/receipts", { storeAccount });
    const borrowed = await json(other.auth, "POST", "/billing/restore", { platform: "ios", receipts });
    expect(borrowed).toMatchObject({ restored: 0, linkedElsewhere: 1, entitlements: { tier: "free" } });
    expect((await call(other.auth, "POST", "/billing/verify", { platform: "ios", productId: MONTHLY, receipt: receipts[0] })).json().error.code).toBe("subscription_owned_elsewhere");
    // The owner restoring on a new device gets it back.
    const restored = await json(u.auth, "POST", "/billing/restore", { platform: "android", receipts });
    expect(restored).toMatchObject({ restored: 1, entitlements: { tier: "pro" } });
  });
});

describe("billing security", () => {
  it("can't be unlocked from the client: forged receipts, swapped products, request fields", async () => {
    const u = await setup();
    const forged = `dev1.${Buffer.from(JSON.stringify({ otid: "dev_x", acct: randomUUID(), iat: "2026-10-05" })).toString("base64url")}.${"A".repeat(43)}`;
    expect((await call(u.auth, "POST", "/billing/verify", { platform: "ios", productId: MONTHLY, receipt: forged })).statusCode).toBeGreaterThanOrEqual(400);
    const { receipt } = await json(u.auth, "POST", "/billing/dev/checkout", { productId: MONTHLY, storeAccount: randomUUID() });
    expect((await call(u.auth, "POST", "/billing/verify", { platform: "ios", productId: ANNUAL, receipt })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await call(u.auth, "POST", "/billing/verify", { platform: "ios", productId: MONTHLY, receipt, tier: "pro" })).statusCode).toBe(400);
    expect((await call(u.auth, "PATCH", "/me/settings", { tier: "pro" })).statusCode).toBe(400);
    expect((await call(u.auth, "POST", "/entitlements", { tier: "pro" })).statusCode).toBe(404);
    expect((await ent(u.auth)).tier).toBe("free");
    // Without the development store, its routes don't exist.
    await app.close();
    ({ app, ctx } = await makeApp());
    const v = await registerUser(app);
    expect((await call(v.auth, "POST", "/billing/dev/checkout", { productId: MONTHLY, storeAccount: randomUUID() })).statusCode).toBe(404);
    expect((await call(null, "POST", "/billing/webhooks/development", "{}", { "content-type": "application/json" })).statusCode).toBe(404);
  });

  it("webhooks: authentic, fresh, applied once and in order", async () => {
    const u = await setup();
    await buy(u.auth);
    const sub = ctx.db.prepare("SELECT original_transaction_id AS id FROM subscriptions WHERE user_id = ?").get(u.id) as { id: string };
    const secret = testConfig.billing.dev.secret;
    const now = () => Math.floor(u.clock.now().getTime() / 1000);
    const signed = (body: string, t = now(), key = secret) => ({ "content-type": "application/json", [DEV_SIGNATURE_HEADER]: `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}` });
    const event = (id: string, type: string, occurredAt: string, status: string) =>
      JSON.stringify({ id, type, occurredAt, transaction: { productId: MONTHLY, originalTransactionId: sub.id, status, autoRenew: false, periodEnd: "2026-11-05T12:00:00.000Z", graceEnd: null, environment: "development" } });
    const send = (body: string, headers: Record<string, string>) => call(null, "POST", "/billing/webhooks/development", body, headers);

    const refund = event("evt-1", "refunded", "2026-10-05T12:30:00.000Z", "revoked");
    expect((await send(refund, signed(refund, now(), "the-wrong-secret-value-for-signing!!"))).statusCode).toBe(401); // forged
    expect((await send(refund, signed(refund, now() - 600))).statusCode).toBe(401); // replayed later
    expect((await send(refund.replace("revoked", "active"), signed(refund))).statusCode).toBe(401); // tampered
    expect((await send(refund, { "content-type": "application/json" })).statusCode).toBe(401); // unsigned
    expect((await ent(u.auth)).tier).toBe("pro");

    u.clock.set("2026-10-05T13:00:00Z");
    expect((await send(refund, signed(refund))).json().outcome).toBe("applied");
    expect((await ent(u.auth)).tier).toBe("free");
    expect((await send(refund, signed(refund))).json().outcome).toBe("duplicate"); // the same event twice
    // An older event arriving late never overrides a newer one.
    const late = event("evt-0", "renewed", "2026-10-05T12:10:00.000Z", "active");
    expect((await send(late, signed(late))).json().outcome).toBe("stale");
    expect((await ent(u.auth)).tier).toBe("free");
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM billing_events WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(2);
  });

  it("production refuses the development store", () => {
    expect(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: "x".repeat(40), CORS_ORIGINS: "https://app.example", BILLING_PROVIDER: "development" })).toThrow(/BILLING_PROVIDER=development is not allowed in production/);
  });
});

describe("Pro features use real data", () => {
  it("form intelligence and the weekly report come from verified reps and logged food — nothing invented", async () => {
    const u = await setup({ clock: new TestClock(new Date("2026-09-28T12:00:00Z")) });
    await buy(u.auth);
    for (const [d, kg, bottom] of [["2026-09-28", 60, 90], ["2026-09-30", 62.5, 92], ["2026-10-02", 65, 95]] as const) {
      u.clock.set(`${d}T12:00:00Z`);
      expect((await call(u.auth, "POST", "/workouts", { clientWorkoutId: randomUUID(), localDate: d, durationMinutes: 40, painLevel: "none", sets: [{ exerciseId: "squat", reps: 5, loadKg: kg, trace: squatTrace(5, bottom) }] })).statusCode).toBe(201);
      await call(u.auth, "POST", "/nutrition/logs", foodLog({ localDate: d, kcal: 2400, proteinG: 160, carbsG: 250, fatG: 80 }));
    }
    u.clock.set("2026-10-06T12:00:00Z");
    const f = (await json(u.auth, "GET", "/exercises/squat/form-intelligence?range=30")).intelligence;
    expect(f.sessions.map((s: { topLoadKg: number }) => s.topLoadKg)).toEqual([60, 62.5, 65]);
    expect(f.sessions.every((s: { verifiedReps: number }) => s.verifiedReps > 0)).toBe(true);
    expect(f.reps).toBe(f.sessions.reduce((a: number, s: { verifiedReps: number }) => a + s.verifiedReps, 0));
    const r = await json(u.auth, "POST", "/reports/weekly");
    expect(r.weekStart).toBe("2026-09-28");
    expect(r.report.training).toMatchObject({ workouts: 3, trainingDays: 3, minutes: 120 });
    expect(r.report.training.verifiedReps).toBe(f.reps);
    expect(r.report.nutrition).toMatchObject({ daysLogged: 3 });
    expect(r.coach.provider.type).toBe("deterministic_fallback"); // labelled: rules, not AI
    // Generated once: asking again returns the same report.
    expect((await json(u.auth, "POST", "/reports/weekly")).generatedAt).toBe(r.generatedAt);
  });

  it("leaves the coach note out of a report made days after its week, rather than mixing in another week", async () => {
    const u = await setup({ clock: new TestClock(new Date("2026-10-09T12:00:00Z")) });
    await buy(u.auth);
    const r = await json(u.auth, "POST", "/reports/weekly");
    expect(r.weekStart).toBe("2026-09-28");
    expect(r.coach).toBeNull();
  });

  it("makes each week's report once: asking again returns the same one", async () => {
    const u = await setup();
    await buy(u.auth);
    const r = await json(u.auth, "POST", "/reports/weekly");
    expect((await json(u.auth, "POST", "/reports/weekly")).generatedAt).toBe(r.generatedAt);
  });
});
