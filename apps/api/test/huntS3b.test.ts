/**
 * Bug-hunt batch S3b: privacy, auth and miscellaneous fixes (register items A1-09 to A1-25).
 */
import { randomUUID } from "node:crypto";
import { createUnconfiguredProviders, TREND, type ProviderRegistry } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppContext } from "../src/app";
import { loadConfig } from "../src/config";
import { analyticsForCoach, lockForTier, progressAnalytics } from "../src/modules/analytics/service";
import { entitlementsFor } from "../src/modules/billing/entitlements";
import { userClock } from "../src/shared/userClock";
import { geminiFoodRecognition, normaliseRecognition } from "../src/providers/foodRecognition";
import { grantPro, makeApp, onboard, registerUser, testConfig, TestClock, TODAY, workoutPayload } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, opts: { auth?: Auth; payload?: unknown; ip?: string; headers?: Record<string, string> } = {}) =>
  app.inject({ method, url, headers: { ...(opts.auth ?? {}), ...(opts.headers ?? {}) }, remoteAddress: opts.ip, ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}) });

async function loggedApp(config: Partial<typeof testConfig> = {}) {
  const raw: string[] = [];
  const lines: Record<string, unknown>[] = [];
  ({ app, ctx } = await buildApp({
    config: { ...testConfig, logLevel: "info", ...config },
    now: new TestClock().now,
    logger: true,
    logStream: {
      write(line: string) {
        raw.push(line);
        lines.push(JSON.parse(line));
      },
    },
  }));
  return { raw, lines };
}

describe("A1-09 token lifetime", () => {
  it("defaults to 30 days, and logout-all still revokes every token", async () => {
    const c = loadConfig({ NODE_ENV: "test" });
    expect(c.tokenTtl).toBe("30d");
    ({ app, ctx } = await makeApp({ config: { tokenTtl: c.tokenTtl } }));
    const u = await registerUser(app);
    const claims = JSON.parse(Buffer.from(u.token.split(".")[1]!, "base64url").toString()) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBe(30 * 24 * 3600);
    expect((await call("GET", "/me", { auth: u.auth })).statusCode).toBe(200);
    expect((await call("POST", "/auth/logout-all", { auth: u.auth })).statusCode).toBe(204);
    expect((await call("GET", "/me", { auth: u.auth })).statusCode).toBe(401);
  });
});

describe("A1-10 / A3-12 /status", () => {
  const IMAGE = { mimeType: "image/jpeg" as const, data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };

  it("never publishes free text from model output, and reports the stage", async () => {
    const gem = geminiFoodRecognition({
      model: "m",
      fallbackModel: null,
      apiKey: "AIzaFAKEKEYFAKEKEYFAKEKEY",
      fetch: (async () => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Sorry, I see a half eaten tub of Ben&Jerry's Cookie Dough and 3 beers" }] } }] }), { status: 200 })) as typeof fetch,
    });
    const providers: ProviderRegistry = { ...createUnconfiguredProviders(), food: gem as never };
    ({ app, ctx } = await makeApp({ providers, config: { foodRecognition: { ...testConfig.foodRecognition, provider: "gemini" } } }));
    expect(await gem.recognize(IMAGE)).toMatchObject({ ok: false });
    const st = await call("GET", "/status");
    expect(st.statusCode).toBe(200);
    expect(st.body).not.toMatch(/cookie|beers|Jerry/i);
    const failure = st.json().foodRecognition.lastFailure;
    expect(failure).toMatchObject({ stage: "unreadable answer", finishReason: "STOP", model: "m" });
    expect(failure).toHaveProperty("at");
    expect(failure).not.toHaveProperty("detail");
    expect(st.json().stage).toBe("live");
  });

  it("says testing when APP_STAGE=testing", async () => {
    ({ app, ctx } = await makeApp({ config: { stage: "testing" } }));
    expect((await call("GET", "/status")).json().stage).toBe("testing");
  });

  it("warns at boot when the sandbox store runs on a testing stage", async () => {
    const { lines } = await loggedApp({ stage: "testing", billing: { ...testConfig.billing, provider: "development" } });
    expect(lines.some((l) => l.level === 40 && /APP_STAGE=testing/.test(String(l.msg)))).toBe(true);
    await app.close();
    const quiet = await loggedApp({ stage: "live" });
    expect(quiet.lines.some((l) => l.level === 40)).toBe(false);
  });
});

describe("A1-11 request logs", () => {
  it("carry the route pattern and never the query string", async () => {
    const { raw, lines } = await loggedApp();
    const u = await registerUser(app);
    await call("GET", "/foods/search?q=ben%20and%20jerrys%20cookie%20dough", { auth: u.auth });
    await call("DELETE", "/me/weight/2026-09-01", { auth: u.auth });
    await call("GET", "/nope?secret=abc");
    const text = raw.join("\n");
    expect(text).not.toMatch(/cookie|jerry/i);
    expect(text).not.toContain("secret=abc");
    const incoming = lines.filter((l) => l.msg === "incoming request").map((l) => l.req as Record<string, unknown>);
    expect(incoming.find((r) => String(r.url).startsWith("/foods/search"))).toEqual({ method: "GET", url: "/foods/search", remoteAddress: expect.any(String) });
    expect(incoming.some((r) => r.url === "/me/weight/:date")).toBe(true);
    expect(incoming.find((r) => String(r.url).startsWith("/nope"))).toMatchObject({ url: "/nope" });
    for (const r of incoming) expect(Object.keys(r).sort()).toEqual(["method", "remoteAddress", "url"]);
  });
});

describe("A1-14 proxy trust", () => {
  it("in production only the last proxy hop's address is believed, not a forged X-Forwarded-For", async () => {
    const { lines } = await loggedApp({ env: "production" });
    await call("GET", "/health", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.7" }, ip: "10.1.1.1" });
    const req = lines.find((l) => l.msg === "incoming request")!.req as { remoteAddress: string };
    expect(req.remoteAddress).toBe("203.0.113.7");
  });

  it("outside production the header is ignored", async () => {
    const { lines } = await loggedApp();
    await call("GET", "/health", { headers: { "x-forwarded-for": "6.6.6.6" }, ip: "10.1.1.1" });
    expect((lines.find((l) => l.msg === "incoming request")!.req as { remoteAddress: string }).remoteAddress).toBe("10.1.1.1");
  });

  it("TRUST_PROXY_HOPS defaults to 1", () => {
    expect(loadConfig({ NODE_ENV: "test" }).trustProxyHops).toBe(1);
    expect(loadConfig({ NODE_ENV: "test", TRUST_PROXY_HOPS: "2" }).trustProxyHops).toBe(2);
  });
});

describe("A1-13 login throttle", () => {
  const login = (email: string, password: string, ip: string) => call("POST", "/auth/login", { payload: { email, password }, ip });

  it("an attacker failing 10 times from one address does not lock the victim out from another", async () => {
    ({ app, ctx } = await makeApp());
    const victim = await registerUser(app);
    for (let i = 0; i < 10; i++) expect((await login(victim.email, `wrong-guess-${i}`, "198.51.100.66")).statusCode).toBe(401);
    // The attacker is stopped (by the throttle or the per-address rate limit); the victim is not.
    expect((await login(victim.email, "correct-horse-battery", "198.51.100.66")).statusCode).toBe(429);
    expect((await login(victim.email, "correct-horse-battery", "203.0.113.5")).statusCode).toBe(200);
  });

  it("guessing spread across many addresses is still capped per account (looser ceiling)", async () => {
    ({ app, ctx } = await makeApp());
    const victim = await registerUser(app);
    // 5 addresses x 10 failures = 50: no single address reaches its own limit twice, but the account does.
    for (let ip = 1; ip <= 5; ip++) for (let i = 0; i < 10; i++) await login(victim.email, `wrong-${ip}-${i}`, `192.0.2.${ip}`);
    const blocked = await login(victim.email, "correct-horse-battery", "203.0.113.77");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("too_many_attempts");
    // Other accounts are unaffected.
    const other = await registerUser(app);
    expect((await login(other.email, "correct-horse-battery", "203.0.113.77")).statusCode).toBe(200);
  });
});

describe("A1-12 Pro form data", () => {
  async function withForm(pro: boolean) {
    ({ app, ctx } = await makeApp());
    const u = await registerUser(app);
    await call("PATCH", "/me/settings", { auth: u.auth, payload: { timezone: "UTC" } });
    await onboard(app, u.auth);
    if (pro) grantPro(ctx, u.id);
    expect((await call("POST", "/workouts", { auth: u.auth, payload: workoutPayload({ clientWorkoutId: randomUUID() }) })).statusCode).toBe(201);
    return u;
  }

  it("Free users get no averageForm in the period summaries; Pro users do", async () => {
    const pro = await withForm(true);
    const proSummaries = (await call("GET", `/analytics/progress?range=7&today=${TODAY}`, { auth: pro.auth })).json().analytics.summaries.daily as { averageForm: number | null }[];
    expect(proSummaries.some((p) => p.averageForm !== null)).toBe(true);
    await app.close();

    const free = await withForm(false);
    const res = (await call("GET", `/analytics/progress?range=7&today=${TODAY}`, { auth: free.auth })).json().analytics;
    expect(res.summaries.daily.length).toBeGreaterThan(0);
    for (const p of res.summaries.daily as { averageForm: number | null }[]) expect(p.averageForm).toBeNull();
    const weekly = (await call("GET", `/analytics/progress?range=30&today=${TODAY}`, { auth: free.auth })).json().analytics.summaries.weekly as { averageForm: number | null }[];
    for (const p of weekly) expect(p.averageForm).toBeNull();
  });

  it("the coach gets form and ROM trends only for Pro", async () => {
    const u = await withForm(false);
    const a = structuredClone(progressAnalytics(ctx, u.id, userClock(ctx, u.id, TODAY), { range: 30 }, { sync: false }));
    a.form.data.chart.trend.direction = TREND.IMPROVING;
    a.rom.data.chart.trend.direction = TREND.DECLINING;
    const free = entitlementsFor(ctx, u.id);
    expect(analyticsForCoach(a, free).trends).toMatchObject({ form: TREND.INSUFFICIENT_DATA, rom: TREND.INSUFFICIENT_DATA });
    expect(analyticsForCoach(a).trends).toMatchObject({ form: TREND.INSUFFICIENT_DATA, rom: TREND.INSUFFICIENT_DATA });
    grantPro(ctx, u.id);
    expect(analyticsForCoach(a, entitlementsFor(ctx, u.id)).trends).toMatchObject({ form: TREND.IMPROVING, rom: TREND.DECLINING });
    expect(lockForTier(a, entitlementsFor(ctx, u.id)).form.data.chart.trend.direction).toBe(TREND.IMPROVING);
  });
});

describe("A1-15 Gemini normalisation", () => {
  const item = (over: Record<string, unknown> = {}) => ({ label: "rice", servingGrams: 100, per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }, ...over });
  const run = (items: unknown[]) => (normaliseRecognition({ containsFood: true, items }) as { items: { confidence: number; alternatives: unknown[] }[] }).items;

  it("a missing confidence is low, not a coin flip", () => {
    expect(run([item()])[0]!.confidence).toBeLessThanOrEqual(0.3);
    expect(run([item({ confidence: "0.9" })])[0]!.confidence).toBe(0.9);
  });

  it("drops items with missing or non-numeric macros instead of inventing zeros", () => {
    expect(run([item({ per100g: {} })])).toHaveLength(0);
    expect(run([item({ per100g: { kcal: 130, proteinG: 2.7, carbsG: "lots", fatG: 0.3 } })])).toHaveLength(0);
    expect(run([item({ per100g: { kcal: 130, proteinG: 2.7, carbsG: 28 } })])).toHaveLength(0);
  });

  it("drops items whose macros imply far more calories than stated", () => {
    // 4*2.7 + 4*28 + 9*0.3 = 125.5 kcal; stating 50 is far below that (125.5 > 1.25 * 50 + 25).
    expect(run([item({ per100g: { kcal: 50, proteinG: 2.7, carbsG: 28, fatG: 0.3 } })])).toHaveLength(0);
    // 40 g of fat is 360 kcal from macros; stating 50 is wrong.
    expect(run([item({ label: "oil", per100g: { kcal: 50, proteinG: 0, carbsG: 0, fatG: 40 } })])).toHaveLength(0);
    // Close enough (within tolerance) stays, in either direction.
    expect(run([item({ per100g: { kcal: 150, proteinG: 2.7, carbsG: 28, fatG: 0.3 } })])).toHaveLength(1);
    expect(run([item({ per100g: { kcal: 110, proteinG: 2.7, carbsG: 28, fatG: 0.3 } })])).toHaveLength(1);
    // Small absolute differences on low-calorie foods stay.
    expect(run([item({ per100g: { kcal: 10, proteinG: 0.5, carbsG: 1, fatG: 0 } })])).toHaveLength(1);
  });

  it("keeps drinks whose calories exceed their macros (alcohol is 7 kcal/g), and ordinary foods", () => {
    expect(run([item({ label: "red wine", per100g: { kcal: 83, proteinG: 0.1, carbsG: 2.6, fatG: 0 } })])).toHaveLength(1);
    expect(run([item({ label: "whisky", per100g: { kcal: 250, proteinG: 0, carbsG: 0, fatG: 0 } })])).toHaveLength(1);
    expect(run([item({ label: "beer", per100g: { kcal: 43, proteinG: 0.5, carbsG: 3.6, fatG: 0 } })])).toHaveLength(1);
    expect(run([item({ label: "chicken breast", per100g: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 } })])).toHaveLength(1);
  });

  it("drops impossible values (negative, or more than 9 kcal per gram)", () => {
    expect(run([item({ per100g: { kcal: 100, proteinG: -5, carbsG: 10, fatG: 1 } })])).toHaveLength(0);
    expect(run([item({ per100g: { kcal: -10, proteinG: 0, carbsG: 0, fatG: 0 } })])).toHaveLength(0);
    expect(run([item({ per100g: { kcal: 2000, proteinG: 1, carbsG: 1, fatG: 1 } })])).toHaveLength(0);
  });

  it("applies the same test to alternatives", () => {
    const alts = [
      { label: "ok", confidence: 0.1, per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 } },
      { label: "no macros", confidence: 0.1, per100g: {} },
      { label: "wild kcal", confidence: 0.1, per100g: { kcal: 2000, proteinG: 1, carbsG: 1, fatG: 1 } },
    ];
    expect(run([item({ alternatives: alts })])[0]!.alternatives).toHaveLength(1);
  });
});

describe("A1-17 billing responses", () => {
  it("verify, restore and simulate return the same entitlements shape as GET /entitlements", async () => {
    ({ app, ctx } = await makeApp({ config: { billing: { ...testConfig.billing, provider: "development" } } }));
    const u = await registerUser(app);
    await call("PATCH", "/me/settings", { auth: u.auth, payload: { timezone: "UTC" } });
    const storeAccount = randomUUID();
    const productId = testConfig.billing.products.monthly;
    const { receipt } = (await call("POST", "/billing/dev/checkout", { auth: u.auth, payload: { productId, storeAccount } })).json();

    const verified = (await call("POST", "/billing/verify", { auth: u.auth, payload: { platform: "ios", productId, receipt } })).json();
    const current = (await call("GET", "/entitlements", { auth: u.auth })).json();
    expect(Object.keys(verified).sort()).toEqual(Object.keys(current).sort());
    expect(verified).toHaveProperty("limits");
    expect(verified).toHaveProperty("usage");
    expect(verified.usage).toEqual({ foodScansToday: 0, coachChatsToday: 0 });
    expect(verified).toEqual(current);

    const { receipts } = (await call("POST", "/billing/dev/receipts", { auth: u.auth, payload: { storeAccount } })).json();
    const restored = (await call("POST", "/billing/restore", { auth: u.auth, payload: { platform: "ios", receipts } })).json();
    expect(Object.keys(restored.entitlements).sort()).toEqual(Object.keys(current).sort());

    const sim = (await call("POST", "/billing/dev/simulate", { auth: u.auth, payload: { event: "expire" } })).json();
    const after = (await call("GET", "/entitlements", { auth: u.auth })).json();
    expect(Object.keys(sim.entitlements).sort()).toEqual(Object.keys(after).sort());
    expect(sim.entitlements.limits).not.toBeNull(); // expired back to Free: the allowances are reported
    expect(sim.entitlements.usage).toEqual(after.usage);
  });
});

describe("A1-25 ad analytics", () => {
  it("tracks requested and loaded once per ad, however often the client repeats them", async () => {
    const sent: { name: string }[] = [];
    const providers: ProviderRegistry = {
      ...createUnconfiguredProviders(),
      analytics: { kind: "analytics", status: () => ({ state: "ready", provider: "test" }), track: async (e) => (sent.push(e), { ok: true, value: undefined }) },
    };
    ({ app, ctx } = await makeApp({ providers }));
    const u = await registerUser(app);
    await call("PATCH", "/me/settings", { auth: u.auth, payload: { analyticsConsent: true } });
    const s = (await call("POST", "/workouts/sessions", { auth: u.auth, payload: { clientSessionId: randomUUID(), source: "empty" } })).json().session;
    await call("POST", `/workouts/sessions/${s.id}/sets`, { auth: u.auth, payload: { clientSetId: randomUUID(), exerciseId: "push_up", reps: 10 } });
    const done = await call("POST", `/workouts/sessions/${s.id}/complete`, { auth: u.auth, payload: { painLevel: "none" } });
    const decision = (await call("POST", "/ads/post-workout", { auth: u.auth, payload: { workoutId: done.json().workout.id } })).json();
    expect(decision.eligible).toBe(true);
    for (let i = 0; i < 3; i++) for (const event of ["requested", "loaded"]) await call("POST", `/ads/post-workout/${decision.adId}/events`, { auth: u.auth, payload: { event } });
    const names = sent.map((e) => e.name);
    expect(names.filter((n) => n === "post_workout_ad_requested")).toHaveLength(1);
    expect(names.filter((n) => n === "post_workout_ad_loaded")).toHaveLength(1);
  });
});

describe("A1-24 dev billing secret", () => {
  it("config reads BILLING_DEV_SECRET (render.yaml generates it)", () => {
    const secret = "s".repeat(44);
    expect(loadConfig({ NODE_ENV: "test", BILLING_DEV_SECRET: secret }).billing.dev.secret).toBe(secret);
    expect(() => loadConfig({ NODE_ENV: "test", BILLING_DEV_SECRET: "short" })).toThrow(/BILLING_DEV_SECRET/);
  });
});

describe("A1-12 coach context follows the tier", () => {
  async function coachFacts(pro: boolean) {
    const { createUnconfiguredProviders: unconfigured } = await import("@form/domain");
    const { allow, squatTrace } = await import("./helpers");
    const calls: { context: { facts: Record<string, unknown> } }[] = [];
    const ai = {
      kind: "ai" as const,
      status: () => ({ state: "ready" as const, provider: "Test AI" }),
      respond: async (r: { context: { facts: Record<string, unknown> } }) => (
        calls.push(r),
        { ok: true as const, value: { message: "Keep going.", category: "general", priority: "normal", evidence: [{ fact: "training.workoutsLast7Days", claim: "Workouts" }], actions: [], confidence: "medium" } }
      ),
    };
    const clock = new TestClock(new Date("2026-09-07T12:00:00Z"));
    const providers = { ...unconfigured(), ai } as unknown as ProviderRegistry;
    ({ app, ctx } = await makeApp({ clock, providers, config: { coach: { ...testConfig.coach, provider: "anthropic" } } }));
    const u = await registerUser(app);
    if (pro) grantPro(ctx, u.id);
    await allow(app, u.auth, { aiCoach: true });
    await onboard(app, u.auth, "2026-09-07");
    // Squats that get deeper: a real range-of-motion trend.
    for (const [d, bottom] of [["2026-09-07", 110], ["2026-09-12", 100], ["2026-09-17", 90], ["2026-09-22", 80]] as [string, number][]) {
      clock.set(`${d}T12:00:00Z`);
      const r = await call("POST", "/workouts", { auth: u.auth, payload: { clientWorkoutId: randomUUID(), localDate: d, durationMinutes: 40, painLevel: "none", sets: [{ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5, bottom) }] } });
      expect(r.statusCode).toBe(201);
    }
    clock.set("2026-09-30T12:00:00Z");
    expect((await call("GET", "/coach/insight", { auth: u.auth })).statusCode).toBe(200);
    return calls[0]!.context.facts;
  }

  it("Pro coach context includes form and ROM trends; Free coach context does not", async () => {
    const proFacts = await coachFacts(true);
    expect(proFacts["analytics.30d.trend.rom"]).toBeDefined();
    expect(proFacts["analytics.30d.trend.rom"]).not.toBe("insufficient data");
    await app.close();
    const freeFacts = await coachFacts(false);
    expect(freeFacts["analytics.30d.trend.form"]).toBe("insufficient data");
    expect(freeFacts["analytics.30d.trend.rom"]).toBe("insufficient data");
  });
});
