import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, type AiCoachProvider, type CoachProviderRequest, type ProviderRegistry } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config";
import { dataMap, remainingData } from "../src/modules/privacy/service";
import type { AppContext } from "../src/shared/context";
import { allow, foodLog, makeApp, onboard, PROFILE, registerUser, squatTrace, TestClock, testConfig, TODAY, YESTERDAY } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const inject = (auth: Auth, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: object) => app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });
const PASSWORD = "correct-horse-battery";

async function setup(opts: { providers?: ProviderRegistry; clock?: TestClock; config?: NonNullable<Parameters<typeof makeApp>[0]>["config"] } = {}) {
  ({ app, ctx } = await makeApp(opts));
  const u = await registerUser(app);
  await onboard(app, u.auth);
  return u;
}

describe("profile and preferences", () => {
  it("edits name, body, training and equipment; a goal change applies from today and never rewrites history", async () => {
    const clock = new TestClock(new Date(`${YESTERDAY}T12:00:00Z`));
    ({ app, ctx } = await makeApp({ clock }));
    const u = await registerUser(app);
    await onboard(app, u.auth, YESTERDAY);
    const before = (await inject(u.auth, "GET", `/nutrition/days/${YESTERDAY}`)).json().targets;
    clock.set(`${TODAY}T12:00:00Z`);
    const edited = await inject(u.auth, "PATCH", "/me/profile", { localDate: TODAY, displayName: "Robin", primaryGoal: "lose_fat", ageYears: 31, heightCm: 178, experience: "advanced", trainingDaysPerWeek: 4, equipment: ["dumbbells", "bench"] });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().profile).toMatchObject({ displayName: "Robin", primaryGoal: "lose_fat", ageYears: 31, heightCm: 178, experience: "advanced", trainingDaysPerWeek: 4, equipment: ["dumbbells", "bench"] });
    // History is untouched: yesterday is still judged against the targets in force yesterday.
    expect((await inject(u.auth, "GET", `/nutrition/days/${YESTERDAY}`)).json().targets).toEqual(before);
    expect((await inject(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().targets.targetKcal).toBeLessThan(before.targetKcal);
    const history = ctx.db.prepare("SELECT primary_goal AS goal, effective_from AS since FROM goal_history WHERE user_id = ? ORDER BY effective_from").all(u.id);
    expect(history.at(-1)).toEqual({ goal: "lose_fat", since: TODAY });
  });

  it("keeps allergies and dislikes separate", async () => {
    const u = await setup();
    const res = await inject(u.auth, "PATCH", "/me/preferences", { allergens: ["peanuts"], customAllergies: ["kiwi"], dislikedFoods: ["olives", "mushrooms"], cookingTime: "15_30", foodBudget: "low" });
    expect(res.json().preferences).toMatchObject({ allergens: ["peanuts"], customAllergies: ["kiwi"], dislikedFoods: ["olives", "mushrooms"], cookingTime: "15_30", foodBudget: "low" });
    const p = (await inject(u.auth, "GET", "/me/personalization")).json();
    expect(p.nutrition.hard).toMatchObject({ allergens: ["peanuts"], customAllergies: ["kiwi"] });
    expect(p.nutrition.soft.dislikedFoods).toEqual(["olives", "mushrooms"]);
  });

  it("keeps weight history: add, list, correct, delete — within a 30-day backdate window", async () => {
    const u = await setup();
    for (const [d, kg] of [["2026-09-20", 81], ["2026-09-24", 80.4], [TODAY, 80]] as const) expect((await inject(u.auth, "POST", "/me/weight", { localDate: d, weightKg: kg })).statusCode).toBeLessThan(300);
    await inject(u.auth, "POST", "/me/weight", { localDate: "2026-09-24", weightKg: 80.6 }); // a same-day correction replaces, never duplicates
    const entries = (await inject(u.auth, "GET", "/me/weight")).json().entries;
    expect(entries.map((e: { localDate: string; weightKg: number }) => [e.localDate, e.weightKg])).toEqual([[TODAY, 80], ["2026-09-24", 80.6], ["2026-09-20", 81]]);
    expect((await inject(u.auth, "POST", "/me/weight", { localDate: "2026-08-20", weightKg: 82 })).statusCode).toBe(422);
    expect((await inject(u.auth, "DELETE", "/me/weight/2026-09-20")).statusCode).toBe(204);
    expect((await inject(u.auth, "DELETE", "/me/weight/2026-09-20")).statusCode).toBe(404);
  });

  it("summarises workouts and food from real records", async () => {
    const u = await setup();
    await inject(u.auth, "POST", "/workouts", { clientWorkoutId: randomUUID(), localDate: TODAY, durationMinutes: 40, painLevel: "none", sets: [{ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) }] });
    await inject(u.auth, "POST", "/nutrition/logs", foodLog({ localDate: TODAY }));
    const s = (await inject(u.auth, "GET", "/me/summary")).json();
    expect(s.workouts).toMatchObject({ rangeDays: 30, workouts: 1, trainingDays: 1, minutes: 40, verifiedReps: 5 });
    expect(s.nutrition).toMatchObject({ rangeDays: 7, daysLogged: 1, hasTargets: true });
    expect(s.recordsBeaten).toBe(0); // first lifts are baselines
  });
});

describe("settings", () => {
  it("stores time zone and date preferences, and rejects unknown zones", async () => {
    const u = await setup();
    expect((await inject(u.auth, "PATCH", "/me/settings", { timezone: "Mars/Olympus" })).statusCode).toBe(400);
    const s = (await inject(u.auth, "PATCH", "/me/settings", { timezone: "Asia/Tokyo", timezoneAuto: false, dateFormat: "iso", units: "imperial" })).json();
    expect(s).toMatchObject({ timezone: "Asia/Tokyo", timezoneAuto: false, dateFormat: "iso", units: "imperial" });
    expect((await inject(u.auth, "PATCH", "/me/settings", { dateFormat: "weird" })).statusCode).toBe(400);
    expect((await inject(u.auth, "GET", "/home")).json().timezone).toBe("Asia/Tokyo");
  });

  it("keeps notification preferences (all off by default) separate from device permission", async () => {
    const u = await setup();
    const defaults = (await inject(u.auth, "GET", "/me/notifications")).json();
    expect(defaults).toMatchObject({ workoutReminders: false, mealReminders: false, weeklySummary: false, achievementAlerts: false, streakAlerts: false, coachTips: false, workoutReminderTime: "18:00" });
    const next = (await inject(u.auth, "PATCH", "/me/notifications", { workoutReminders: true, workoutReminderTime: "07:30", quietHours: null })).json();
    expect(next).toMatchObject({ workoutReminders: true, workoutReminderTime: "07:30", quietHours: null });
    expect((await inject(u.auth, "PATCH", "/me/notifications", { workoutReminderTime: "25:00" })).statusCode).toBe(400);
    expect((await inject(u.auth, "PATCH", "/me/notifications", { osPermission: "granted" })).statusCode).toBe(400); // only the device grants that
  });

  it("lets the user switch the coach off, keep the AI out until they agree, and stop chat history", async () => {
    const calls: CoachProviderRequest[] = [];
    const ai: AiCoachProvider = { kind: "ai", status: () => ({ state: "ready", provider: "Test AI" }), respond: async (r) => (calls.push(r), { ok: true, value: { message: "Keep going.", category: "general", priority: "normal", evidence: [{ fact: "training.workoutsLast7Days", claim: "Workouts" }], actions: [], confidence: "medium" } }) };
    const u = await setup({ providers: { ...createUnconfiguredProviders(), ai }, config: { coach: { ...testConfig.coach, provider: "anthropic" } } });
    // No consent yet: rules answer, and nothing is sent to the AI.
    const first = (await inject(u.auth, "GET", "/coach/insight")).json().insight;
    expect(first).toMatchObject({ provider: { type: "deterministic_fallback" }, degraded: "no_consent" });
    expect((await inject(u.auth, "GET", "/coach/status")).json()).toMatchObject({ reason: "consent_required", aiAvailable: true });
    expect(calls).toHaveLength(0);
    await allow(app, u.auth, { aiCoach: true });
    await inject(u.auth, "POST", "/coach/messages", { message: "hi", clientMessageId: randomUUID() });
    expect(calls).toHaveLength(1);
    expect((await inject(u.auth, "GET", "/coach/messages")).json().messages).toHaveLength(2);
    // History off: existing chat cleared, new chats not stored and no history sent.
    await inject(u.auth, "PATCH", "/me/settings", { coachKeepHistory: false });
    expect((await inject(u.auth, "GET", "/coach/messages")).json().messages).toEqual([]);
    await inject(u.auth, "POST", "/coach/messages", { message: "again", clientMessageId: randomUUID() });
    expect(calls.at(-1)!.history).toEqual([]);
    expect((await inject(u.auth, "GET", "/coach/messages")).json().messages).toEqual([]);
    // Coach off: no coaching at all.
    await inject(u.auth, "PATCH", "/me/settings", { aiCoachEnabled: false });
    expect((await inject(u.auth, "GET", "/coach/insight")).json().error.code).toBe("coach_disabled");
    expect((await inject(u.auth, "GET", "/home")).json().coach.mode).toBe("unavailable");
  });

  it("never sends a meal photo to an outside recogniser without consent", async () => {
    let called = 0;
    const food = { kind: "food_recognition" as const, development: false, status: () => ({ state: "ready" as const, provider: "Test vision" }), recognize: async () => (called++, { ok: false as const, code: "unavailable" as const, message: "x", retryable: true }) };
    ({ app, ctx } = await makeApp({ providers: { ...createUnconfiguredProviders(), food } }));
    const u = await registerUser(app);
    const res = await inject(u.auth, "POST", "/nutrition/scans", { clientScanId: randomUUID(), image: { mimeType: "image/jpeg", data: "/9j/4AAQSkZJRgABAQ==" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("scan_consent_required");
    expect(called).toBe(0);
  });
});

describe("account and sessions", () => {
  it("changes the password only with the current one, signing out every other device", async () => {
    const u = await setup();
    const phone = (await app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, password: PASSWORD } })).json().token;
    expect((await inject(u.auth, "POST", "/auth/password", { currentPassword: "wrong-password", newPassword: "a-brand-new-password" })).statusCode).toBe(403);
    expect((await inject(u.auth, "POST", "/auth/password", { currentPassword: PASSWORD, newPassword: PASSWORD })).statusCode).toBe(400);
    const changed = await inject(u.auth, "POST", "/auth/password", { currentPassword: PASSWORD, newPassword: "a-brand-new-password" });
    expect(changed.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${phone}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${changed.json().token}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, password: "a-brand-new-password" } })).statusCode).toBe(200);
  });

  it("switching accounts never mixes data, and signing out everywhere ends every session", async () => {
    const a = await setup();
    const b = await registerUser(app);
    await inject(a.auth, "POST", "/nutrition/logs", foodLog({ localDate: TODAY, name: "A's oats" }));
    expect((await inject(b.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs ?? []).toEqual([]);
    expect((await inject(b.auth, "GET", "/me")).json().user.email).toBe(b.email);
    expect((await inject(a.auth, "POST", "/auth/logout-all")).statusCode).toBe(204);
    expect((await inject(a.auth, "GET", "/me")).statusCode).toBe(401);
    expect((await inject(b.auth, "GET", "/me")).statusCode).toBe(200);
  });

  it("publishes only the legal links the operator configured", async () => {
    await setup();
    expect((await app.inject({ method: "GET", url: "/legal" })).json()).toEqual({ termsUrl: null, privacyUrl: null });
    await app.close();
    ({ app, ctx } = await makeApp({ config: { legal: { termsUrl: "https://example.com/terms", privacyUrl: "https://example.com/privacy" } } }));
    expect((await app.inject({ method: "GET", url: "/legal" })).json()).toEqual({ termsUrl: "https://example.com/terms", privacyUrl: "https://example.com/privacy" });
    expect(() => loadConfig({ NODE_ENV: "test", LEGAL_TERMS_URL: "http://insecure.example.com" } as never)).toThrow(/LEGAL_TERMS_URL/);
  });
});

describe("export", () => {
  it("is a complete, structured, private document behind re-authentication", async () => {
    const u = await setup();
    const other = await registerUser(app);
    await inject(u.auth, "POST", "/workouts", { clientWorkoutId: randomUUID(), localDate: TODAY, durationMinutes: 40, painLevel: "none", sets: [{ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) }] });
    await inject(u.auth, "POST", "/nutrition/logs", foodLog({ localDate: TODAY }));
    await inject(u.auth, "PUT", "/me/photo", { mimeType: "image/png", data: PNG_1PX });
    await inject(other.auth, "POST", "/nutrition/logs", foodLog({ localDate: TODAY, name: "Not yours" }));

    expect((await inject(u.auth, "POST", "/me/export", { password: "wrong" })).statusCode).toBe(403);
    expect((await inject(u.auth, "POST", "/me/export", { password: PASSWORD, userId: other.id })).statusCode).toBe(400);
    const res = await inject(u.auth, "POST", "/me/export", { password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="form-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const e = res.json();
    expect(e).toMatchObject({ format: "form-data-export", version: 1, user: { id: u.id, email: u.email } });
    expect(e.user.password_hash).toBeUndefined();
    expect(JSON.stringify(e)).not.toMatch(/password_hash|token_version|Not yours/);
    expect(e.data.workouts).toHaveLength(1);
    expect(e.data.workout_sets).toHaveLength(1);
    expect(e.data.verified_reps).toHaveLength(5);
    expect(e.data.food_logs).toHaveLength(1);
    expect(e.data.xp_events.length).toBeGreaterThan(0);
    expect(e.data.profiles[0]).toMatchObject({ user_id: u.id });
    expect(e.data.profile_photos[0].data).toMatchObject({ encoding: "base64" });
    // Every table is either exported, or known to hold no personal data.
    expect(dataMap(ctx.db).unaccounted).toEqual([]);
    for (const t of dataMap(ctx.db).userTables) expect(e.data[t]).toBeDefined();
  });

  it("is rate limited", async () => {
    const u = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await inject(u.auth, "POST", "/me/export", { password: PASSWORD })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});

describe("deletion", () => {
  it("needs the password and an explicit confirmation, and reports success only when everything is gone", async () => {
    const u = await setup();
    const other = await registerUser(app);
    await inject(u.auth, "POST", "/workouts", { clientWorkoutId: randomUUID(), localDate: TODAY, durationMinutes: 40, painLevel: "none", sets: [{ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) }] });
    await inject(u.auth, "GET", "/body-quest");
    await inject(u.auth, "PUT", "/me/photo", { mimeType: "image/png", data: PNG_1PX });
    expect((await inject(u.auth, "DELETE", "/me", { password: "wrong", confirm: "DELETE" })).statusCode).toBe(403);
    expect((await inject(u.auth, "DELETE", "/me", { password: PASSWORD, confirm: "yes" })).json().error.code).toBe("confirmation_required");
    expect((await inject(u.auth, "GET", "/me")).statusCode).toBe(200); // nothing happened yet
    expect((await inject(u.auth, "DELETE", "/me", { password: PASSWORD, confirm: "DELETE" })).statusCode).toBe(204);
    expect(remainingData(ctx.db, u.id)).toEqual({});
    expect((await inject(u.auth, "GET", "/me")).statusCode).toBe(401);
    expect((await inject(other.auth, "GET", "/me")).statusCode).toBe(200); // nobody else is touched
  });

  it("warns about an active store subscription that deleting the account won't cancel", async () => {
    const u = await setup();
    ctx.db.prepare("INSERT INTO subscriptions (user_id, product_id, status, auto_renew, period_end, source, environment, created_at, updated_at) VALUES (?, 'form_pro_monthly', 'active', 1, '2099-01-01T00:00:00Z', 'store', 'production', ?, ?)").run(u.id, new Date().toISOString(), new Date().toISOString());
    const blocked = await inject(u.auth, "DELETE", "/me", { password: PASSWORD, confirm: "DELETE" });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({ code: "subscription_active" });
    expect((await inject(u.auth, "DELETE", "/me", { password: PASSWORD, confirm: "DELETE", acknowledgeSubscription: true })).statusCode).toBe(204);
  });

  it("never claims success when deletion fails — and nothing is half-deleted", async () => {
    const u = await setup();
    await inject(u.auth, "POST", "/nutrition/logs", foodLog({ localDate: TODAY }));
    // Simulate a failure deep inside the cascade.
    ctx.db.exec("CREATE TRIGGER test_block_delete BEFORE DELETE ON food_logs BEGIN SELECT RAISE(ABORT, 'disk on fire'); END;");
    const res = await inject(u.auth, "DELETE", "/me", { password: PASSWORD, confirm: "DELETE" });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("deletion_failed");
    expect((await inject(u.auth, "GET", "/me")).statusCode).toBe(200);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(1);
  });
});

describe("security audit", () => {
  it("refuses fields a client may not set (mass assignment)", async () => {
    const u = await setup();
    const attempts: [string, string, object][] = [
      ["PATCH", "/me/profile", { localDate: TODAY, userId: "someone-else" }],
      ["PATCH", "/me/profile", { localDate: TODAY, onboardingCompletedAt: "2020-01-01" }],
      ["PATCH", "/me/profile", { localDate: TODAY, energyGoal: "gain" }],
      ["PATCH", "/me/settings", { tokenVersion: 0 }],
      ["PATCH", "/me/settings", { tier: "pro" }],
      ["PATCH", "/me/preferences", { userId: "x" }],
      ["PATCH", "/me/notifications", { userId: "x" }],
      ["POST", "/workouts", { clientWorkoutId: randomUUID(), localDate: TODAY, durationMinutes: 30, painLevel: "none", sets: [], xp: 9999 }],
      ["DELETE", "/me", { password: PASSWORD, confirm: "DELETE", userId: "someone-else" }],
    ];
    for (const [method, url, body] of attempts) expect([url, (await inject(u.auth, method as "PATCH", url, body)).statusCode]).toEqual([url, 400]);
  });

  it("never lets one user reach another's records by id (IDOR)", async () => {
    const a = await setup();
    const b = await registerUser(app);
    // A creates one of everything addressable by id.
    const session = (await inject(a.auth, "POST", "/workouts/sessions", { clientSessionId: randomUUID(), source: "plan" })).json().session;
    await inject(a.auth, "POST", `/workouts/sessions/${session.id}/sets`, { clientSetId: randomUUID(), exerciseId: "bicep_curl", reps: 10, loadKg: 10 });
    const setId = (ctx.db.prepare("SELECT id FROM session_sets WHERE session_id = ?").get(session.id) as { id: string }).id;
    await inject(a.auth, "POST", "/nutrition/logs", foodLog({ localDate: TODAY }));
    await inject(a.auth, "POST", "/water", { clientLogId: randomUUID(), ml: 250 });
    await inject(a.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 1 });
    await inject(a.auth, "POST", "/grocery/items", { clientItemId: randomUUID(), name: "Rice" });
    const id = (sql: string) => (ctx.db.prepare(sql).get(a.id) as { id: string }).id;
    const log = id("SELECT id FROM food_logs WHERE user_id = ?");
    const water = id("SELECT id FROM water_logs WHERE user_id = ?");
    const plan = id("SELECT id FROM meal_plans WHERE user_id = ?");
    const meal = (ctx.db.prepare("SELECT id FROM planned_meals WHERE plan_id = ?").get(plan) as { id: string }).id;
    const item = id("SELECT id FROM grocery_items WHERE user_id = ?");
    const probes: [string, string, object?][] = [
      ["GET", `/workouts/sessions/${session.id}`],
      ["POST", `/workouts/sessions/${session.id}/sets`, { clientSetId: randomUUID(), exerciseId: "bicep_curl", reps: 5, loadKg: 5 }],
      ["PATCH", `/workouts/sessions/${session.id}/sets/${setId}`, { reps: 1 }],
      ["DELETE", `/workouts/sessions/${session.id}/sets/${setId}`],
      ["POST", `/workouts/sessions/${session.id}/complete`, { painLevel: "none" }],
      ["PATCH", `/nutrition/logs/${log}`, { mealType: "dinner" }],
      ["DELETE", `/nutrition/logs/${log}`],
      ["DELETE", `/water/${water}`],
      ["GET", `/meal-plans/${plan}`],
      ["DELETE", `/meal-plans/${plan}/meals/${meal}`],
      ["POST", `/meal-plans/${plan}/meals/${meal}/eaten`, { clientLogId: randomUUID() }],
      ["PATCH", `/grocery/items/${item}`, { checked: true }],
      ["DELETE", `/grocery/items/${item}`],
    ];
    for (const [method, url, body] of probes) {
      const code = (await inject(b.auth, method as "GET", url, body)).statusCode;
      expect([method, url, [403, 404].includes(code) ? "denied" : code]).toEqual([method, url, "denied"]);
    }
    // A's data is intact.
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ?").get(a.id) as { n: number }).n).toBe(1);
    expect((await inject(a.auth, "GET", `/workouts/sessions/${session.id}`)).statusCode).toBe(200);
  });

  it("keeps progression and subscriptions server-owned", async () => {
    const u = await setup();
    for (const [method, url] of [["POST", "/xp/events"], ["PATCH", "/progress"], ["POST", "/achievements"], ["POST", "/records"], ["PATCH", "/entitlements"]] as const) {
      expect([404, 405]).toContain((await inject(u.auth, method, url, { xp: 1000, tier: "pro" })).statusCode);
    }
    const verify = await inject(u.auth, "POST", "/billing/verify", { store: "app_store", token: "forged-receipt" });
    expect(verify.statusCode).toBeGreaterThanOrEqual(400);
    expect((await inject(u.auth, "GET", "/entitlements")).json().tier).toBe("free");
  });

  it("serves media only to its owner, never cached, and rejects anything that isn't a real image", async () => {
    const u = await setup();
    const other = await registerUser(app);
    expect((await inject(u.auth, "PUT", "/me/photo", { mimeType: "image/png", data: PNG_1PX })).statusCode).toBe(200);
    const mine = await inject(u.auth, "GET", "/me/photo");
    expect(mine.headers["cache-control"]).toBe("no-store");
    expect(mine.headers["x-content-type-options"]).toBe("nosniff");
    expect((await inject(other.auth, "GET", "/me/photo")).statusCode).toBe(404); // "me" is always the caller
    expect((await inject(u.auth, "PUT", "/me/photo", { mimeType: "image/gif", data: PNG_1PX })).statusCode).toBe(400);
    expect((await inject(u.auth, "PUT", "/me/photo", { mimeType: "image/png", data: Buffer.from("<script>alert(1)</script>").toString("base64") })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

void PROFILE;

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
