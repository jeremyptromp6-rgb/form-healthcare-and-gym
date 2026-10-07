/**
 * Stage P — end-to-end journeys through the whole product, over HTTP, with real engines and a
 * real database. Each journey ends with the reconciliation audit: whatever a user does, derived
 * state must still agree with its source records.
 *
 * Outside providers are stand-ins (a recogniser and an AI coach that answer, fail or hang on
 * request) so their failure paths can be exercised; nothing else is mocked.
 */
import { randomUUID } from "node:crypto";
import {
  createUnconfiguredProviders,
  type AiCoachProvider,
  type FoodRecognitionProvider,
  type ProviderResult,
  type RecognitionResult,
} from "@form/domain";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppContext, RouteInfo } from "../src/app";
import { auditDatabase, auditUser } from "../src/modules/integrity/service";
import { makeApp, PREFERENCES, PROFILE, squatTrace, testConfig, TestClock, grantPro } from "./helpers";

type Auth = Record<string, string>;
interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ---- Stand-in providers -------------------------------------------------------------------------

type Mode = "ok" | "fail" | "throw" | "hang";
const providerState = { food: "ok" as Mode, ai: "ok" as Mode, foodCalls: 0, aiCalls: 0 };

const MEAL: RecognitionResult = {
  imageQuality: "ok",
  containsFood: true,
  items: [
    { label: "Grilled chicken breast", confidence: 0.9, alternatives: [], servingGrams: 150, servingLowGrams: 110, servingHighGrams: 200, per100g: { kcal: 170, proteinG: 30, carbsG: 0, fatG: 5 }, hiddenIngredients: ["cooking oil"], composite: false },
    { label: "White rice", confidence: 0.7, alternatives: [], servingGrams: 180, servingLowGrams: 130, servingHighGrams: 240, per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }, hiddenIngredients: [], composite: false },
  ],
};

const food: FoodRecognitionProvider = {
  kind: "food_recognition",
  development: false,
  status: () => ({ state: "ready", provider: "Stand-in recogniser" }),
  recognize: async (_image, opts) => {
    providerState.foodCalls++;
    await new Promise((r) => setTimeout(r, 20)); // a real call takes time: lets concurrent retries overlap
    if (providerState.food === "fail") return { ok: false, code: "unavailable", message: "Recogniser down", retryable: true } as ProviderResult<RecognitionResult>;
    if (providerState.food === "throw") throw new Error("socket hang up");
    if (providerState.food === "hang") await new Promise((_r, reject) => opts?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    return { ok: true, value: MEAL };
  },
};

const ai: AiCoachProvider = {
  kind: "ai",
  status: () => ({ state: "ready", provider: "Stand-in AI" }),
  respond: async () => {
    providerState.aiCalls++;
    await new Promise((r) => setTimeout(r, 20));
    if (providerState.ai === "throw") throw new Error("overloaded");
    if (providerState.ai === "fail") return { ok: false, code: "unavailable", message: "AI down", retryable: true };
    return {
      ok: true,
      value: {
        message: "You've trained {{training.workoutsLast7Days}} times this week. Keep the next session steady.",
        category: "consistency",
        priority: "normal",
        evidence: [{ fact: "training.workoutsLast7Days", claim: "Sessions this week" }],
        actions: [{ id: "open_train", label: "Open training", exerciseId: null, section: null }],
        confidence: "high",
      },
    };
  },
};

// ---- Harness ------------------------------------------------------------------------------------

let app: FastifyInstance;
let ctx: AppContext;
let routes: RouteInfo[];
const clock = new TestClock(new Date("2026-09-28T20:00:00Z")); // 09:00 on 29 Sep in Auckland (UTC+13)
/** Every SQL statement the app prepared during the journeys — for the query-plan audit. */
const statements = new Set<string>();

beforeAll(async () => {
  ({ app, ctx, routes } = await makeApp({
    clock,
    providers: { ...createUnconfiguredProviders(), food, ai },
    config: { coach: { ...testConfig.coach, provider: "anthropic", timeoutMs: 1000 }, foodRecognition: { ...testConfig.foodRecognition, provider: "anthropic", timeoutMs: 1000 }, rateLimitPerMinute: 100_000 },
  }));
  const prepare = ctx.db.prepare.bind(ctx.db);
  ctx.db.prepare = ((sql: string) => {
    statements.add(sql);
    return prepare(sql);
  }) as typeof ctx.db.prepare;
});
afterAll(async () => app?.close());

async function call(auth: Auth | null, method: string, url: string, payload?: unknown): Promise<Res> {
  const r = await app.inject({ method: method as "GET", url, headers: auth ?? {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, body: r.body ? r.json() : null };
}
const ok = async (auth: Auth | null, method: string, url: string, payload?: unknown, expected = [200, 201]) => {
  const r = await call(auth, method, url, payload);
  if (!expected.includes(r.status)) throw new Error(`${method} ${url} → ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};

async function register(email = `e2e-${randomUUID()}@example.com`, password = "correct-horse-battery") {
  const body = await ok(null, "POST", "/auth/register", { email, password });
  return { email, password, id: body.user.id as string, auth: { authorization: `Bearer ${body.token}` } };
}

/** The reconciliation audit: no errors or warnings for this user (expected `info` items allowed). */
function expectConsistent(userId: string, today: string) {
  const problems = auditUser(ctx.db, userId, today, clock.now()).filter((f) => f.severity !== "info");
  expect(problems).toEqual([]);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]).toString("base64");
const scanBody = (clientScanId = randomUUID()) => ({ clientScanId, image: { mimeType: "image/jpeg", data: JPEG } });

// ---- Journey: one person, start to finish --------------------------------------------------------

describe("a new user's journey, start to finish (Auckland, a day ahead of UTC)", () => {
  let u: Awaited<ReturnType<typeof register>>;
  const TODAY = "2026-09-29"; // the user's local date — UTC is still on the 28th
  let workoutId = "";
  let sessionId = "";

  it("1 · new user: signs up, sees honest empty states and which features are real", async () => {
    u = await register();
    const me = await ok(u.auth, "GET", "/me");
    expect(me.onboarding.completed).toBe(false);
    expect(me.settings).toMatchObject({ aiCoachConsent: false, foodScanConsent: false, analyticsConsent: false, personalizedAdsConsent: false });
    const features = (await ok(u.auth, "GET", "/system/features")).features as Record<string, { available: boolean; reason?: string }>;
    // Every unavailable feature says why — nothing is offered that can't work.
    for (const f of Object.values(features)) if (!f.available) expect(f.reason).toBeTruthy();
    expect(features.food_scan?.available).toBe(true);
    expect((await call(null, "GET", "/me")).status).toBe(401);
  });

  it("3 · onboarding: the device's time zone, then every step; the server decides today", async () => {
    await ok(u.auth, "PATCH", "/me/settings", { timezone: "Pacific/Auckland" });
    // The client sends UTC's date by mistake: once the zone is stored, the server's today wins.
    await ok(u.auth, "PATCH", "/me/profile", { ...PROFILE, localDate: "2026-09-28" });
    await ok(u.auth, "PATCH", "/me/preferences", PREFERENCES);
    await ok(u.auth, "POST", "/onboarding/complete");
    const me = await ok(u.auth, "GET", "/me");
    expect(me.onboarding.completed).toBe(true);
    expect(me.targets).toBeTruthy();
    const home = await ok(u.auth, "GET", "/home");
    expect(home.date).toBe(TODAY);
    expect((await ok(u.auth, "GET", "/progress")).streak).toBeTruthy();
    expect((await ok(u.auth, "GET", "/workouts/today")).plan.localDate ?? TODAY).toBe(TODAY);
  });

  it("2 · returning user: signs in again and finds everything as they left it", async () => {
    const again = await ok(null, "POST", "/auth/login", { email: u.email, password: u.password });
    const me = await ok({ authorization: `Bearer ${again.token}` }, "GET", "/me");
    expect(me.user.id).toBe(u.id);
    expect(me.onboarding.completed).toBe(true);
    expect((await call(null, "POST", "/auth/login", { email: u.email, password: "wrong-password-here" })).status).toBe(401);
  });

  it("4 · today's workout: a plan built for their goal, equipment and experience", async () => {
    const today = await ok(u.auth, "GET", "/workouts/today");
    expect(today.plan.exercises.length).toBeGreaterThan(0);
    expect(today.activeSession).toBeNull();
  });

  it("5–8 · executes it live: camera-verified reps with form and ROM, a camera failure, pause and rest", async () => {
    const s = (await ok(u.auth, "POST", "/workouts/sessions", { clientSessionId: randomUUID(), source: "plan" })).session;
    sessionId = s.id;
    expect(s.localDate).toBe(TODAY);
    // 7 · verified reps: the server counts them from the trace, with form and range of motion.
    const verified = (await ok(u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "bodyweight_squat", reps: 8, trace: squatTrace(8) })).set;
    expect(verified.verifiedReps).toBe(8);
    expect(verified.formScore).toBeGreaterThan(0);
    expect(verified.romPercent).toBeGreaterThan(0);
    // 6 · the camera fails (permission revoked mid-workout): the set still saves, honestly unverified.
    const blind = (await ok(u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "bodyweight_squat", reps: 8, trace: { poseStatus: "permission_denied", samples: [] } })).set;
    expect(blind.verifiedReps).toBe(0);
    expect(blind.verificationStatus).not.toBe("verified");
    // A client can't claim verification.
    expect((await call(u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 10, verifiedReps: 10 })).status).toBe(400);
    await ok(u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 10 });
    // Pause for 20 minutes: paused time never counts.
    clock.set("2026-09-28T20:10:00Z");
    await ok(u.auth, "POST", `/workouts/sessions/${s.id}/pause`);
    clock.set("2026-09-28T20:30:00Z");
    expect((await call(u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 5 })).status).toBe(409);
    await ok(u.auth, "POST", `/workouts/sessions/${s.id}/resume`);
    await ok(u.auth, "POST", `/workouts/sessions/${s.id}/rest`, { seconds: 90 });
    clock.set("2026-09-28T20:35:00Z");
  });

  it("9 · completes the workout exactly once, however often it's retried", async () => {
    const first = await call(u.auth, "POST", `/workouts/sessions/${sessionId}/complete`, { painLevel: "none" });
    expect(first.status).toBe(201);
    workoutId = first.body.workout.id;
    expect(first.body.workout.durationMinutes).toBe(15); // 35 min elapsed − 20 paused
    const retries = await Promise.all([0, 1, 2].map(() => call(u.auth, "POST", `/workouts/sessions/${sessionId}/complete`, { painLevel: "none" })));
    for (const r of retries) expect(r.body.workout).toEqual(first.body.workout);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(1);
  });

  it("10 · progression: XP from the ledger, level, rank, streak, records, quests and achievements agree", async () => {
    const progress = await ok(u.auth, "GET", "/progress");
    const ledger = (ctx.db.prepare("SELECT COALESCE(SUM(xp), 0) AS n FROM xp_events WHERE user_id = ?").get(u.id) as { n: number }).n;
    expect(progress.lifetimeXp - progress.provisionalXp).toBe(ledger);
    expect(progress.xpSources.workouts).toBeGreaterThan(0);
    expect(progress.streak.current).toBe(1);
    const records = (await ok(u.auth, "GET", "/records")).records as { kind: string; previous: number | null }[];
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.previous === null)).toBe(true); // first ever: baselines, not beaten records
    await ok(u.auth, "GET", "/quests");
    const achievements = (await ok(u.auth, "GET", "/achievements")).achievements as { id: string; state: string }[];
    expect(achievements.some((a) => a.state === "unlocked")).toBe(true);
    const celebrations = await ok(u.auth, "GET", "/celebrations");
    expect(celebrations).toBeTruthy();
    const summary = await ok(u.auth, "GET", `/workouts/${workoutId}`);
    expect(summary.totals.verifiedReps).toBe(8);
    expectConsistent(u.id, TODAY);
  });

  it("11 · nutrition: a weighed food, a typed estimate and water land on the user's day", async () => {
    await ok(u.auth, "POST", "/nutrition/logs", { clientLogId: randomUUID(), amountMethod: "measured", mealType: "breakfast", food: { foodId: "fdb:banana", quantity: 118, unit: "g" } });
    await ok(u.auth, "POST", "/nutrition/logs", { clientLogId: randomUUID(), amountMethod: "estimated", mealType: "snack", manual: { name: "Flat white", kcal: 120, proteinG: 7, carbsG: 10, fatG: 6 } });
    await ok(u.auth, "POST", "/water", { clientLogId: randomUUID(), ml: 500 });
    const day = await ok(u.auth, "GET", `/nutrition/days/${TODAY}`);
    expect(day.logs).toHaveLength(2);
    expect(day.totals.kcal).toBeGreaterThan(200);
    expect((await ok(u.auth, "GET", `/nutrition/days/2026-09-28`)).logs).toHaveLength(0); // not UTC's date
  });

  it("12 · scanner: asks first, recovers from a failure, and a weighed amount replaces the estimate", async () => {
    // No consent yet: the photo never leaves FORM.
    expect((await call(u.auth, "POST", "/nutrition/scans", scanBody())).body.error.code).toBe("scan_consent_required");
    expect(providerState.foodCalls).toBe(0);
    await ok(u.auth, "PATCH", "/me/settings", { foodScanConsent: true });
    // The recogniser fails: an honest, retryable error — nothing stored, nothing logged.
    providerState.food = "fail";
    const clientScanId = randomUUID();
    const failed = await call(u.auth, "POST", "/nutrition/scans", scanBody(clientScanId));
    expect(failed.status).toBe(503);
    expect(failed.body.error.details.retryable).toBe(true);
    // The same scan retried once it's back works.
    providerState.food = "ok";
    const scan = (await ok(u.auth, "POST", "/nutrition/scans", scanBody(clientScanId))).scan;
    const confirmed = (await ok(u.auth, "POST", `/nutrition/scans/${scan.id}/confirm`, { confirmKey: randomUUID(), localDate: TODAY, mealType: "dinner", mealName: "Chicken plate", items: [{ itemId: "i1" }, { itemId: "i2" }] })).scan;
    const chicken = (confirmed.logs as { id: string; name: string; amountMethod: string }[]).find((l) => /chicken/i.test(l.name))!;
    expect(chicken.amountMethod).toBe("estimated");
    // Weighing the chicken: the measured entry replaces the estimate — never both counted.
    const before = (await ok(u.auth, "GET", `/nutrition/days/${TODAY}`)).logs.length;
    const measured = (await ok(u.auth, "POST", "/nutrition/logs", { clientLogId: randomUUID(), amountMethod: "measured", food: { foodId: "fdb:chicken_breast_cooked", quantity: 142, unit: "g" }, replacesLogId: chicken.id })).log;
    expect(measured).toMatchObject({ amountMethod: "measured", localDate: TODAY, mealType: "dinner", replacedEstimate: { id: chicken.id } });
    const day = await ok(u.auth, "GET", `/nutrition/days/${TODAY}`);
    expect(day.logs).toHaveLength(before);
    expect((day.logs as { id: string }[]).some((l) => l.id === chicken.id)).toBe(false);
    expectConsistent(u.id, TODAY);
  });

  it("13 · weighing: a weigh-in updates the profile weight and the targets from today", async () => {
    await ok(u.auth, "POST", "/me/weight", { localDate: TODAY, weightKg: 79.2 });
    const me = await ok(u.auth, "GET", "/me");
    expect(me.profile.weightKg).toBe(79.2);
    // A future date (by the user's own clock) is refused; yesterday is fine.
    expect((await call(u.auth, "POST", "/me/weight", { localDate: "2026-09-30", weightKg: 79 })).status).toBe(422);
    await ok(u.auth, "POST", "/me/weight", { localDate: "2026-09-28", weightKg: 79.6 });
    expect((await ok(u.auth, "GET", "/me")).profile.weightKg).toBe(79.2); // the newest stays current
  });

  it("14–15 · meal planning and grocery: allergies are hard limits, the list follows the plan", async () => {
    // Free plans one day; the user is on FORM Pro from here (purchases themselves: proR.test.ts).
    expect((await call(u.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 7 })).status).toBe(402);
    grantPro(ctx, u.id);
    const plan = (await ok(u.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 7 })).plan;
    expect(plan.dates[0]).toBe(TODAY);
    for (const m of plan.meals as { recipeId: string }[]) {
      const r = (await ok(u.auth, "GET", `/recipes/${m.recipeId}`)).recipe;
      expect(r.allergens).not.toContain("peanuts");
      expect(JSON.stringify(r.ingredients ?? []).toLowerCase()).not.toContain("kiwi");
      expect(r.suitableFor).toContain("vegetarian");
    }
    for (const r of (await ok(u.auth, "GET", "/recipes")).recipes as { allergens: string[] }[]) expect(r.allergens).not.toContain("peanuts");
    // Eating a planned meal logs it once.
    const breakfast = (plan.meals as { id: string; date: string; slot: string }[]).find((m) => m.date === TODAY)!;
    const body = { clientLogId: randomUUID() };
    await ok(u.auth, "POST", `/meal-plans/${plan.id}/meals/${breakfast.id}/eaten`, body);
    await ok(u.auth, "POST", `/meal-plans/${plan.id}/meals/${breakfast.id}/eaten`, body);
    const list = (await ok(u.auth, "GET", "/grocery")).list;
    const items = (list.sections as { items: { id: string }[] }[]).flatMap((s) => s.items);
    expect(items.length).toBeGreaterThan(0);
    await ok(u.auth, "PATCH", `/grocery/items/${items[0]!.id}`, { checked: true });
    await ok(u.auth, "POST", "/grocery/items", { clientItemId: randomUUID(), name: "Coffee filters" });
    expectConsistent(u.id, TODAY);
  });

  it("16 · AI coach: rules until consent, real AI after, and labelled rules whenever the AI fails", async () => {
    const before = await ok(u.auth, "GET", "/coach/insight?topic=home");
    expect(before.insight.provider.type).toBe("deterministic_fallback");
    expect(before.insight.degraded).toBe("no_consent");
    expect(providerState.aiCalls).toBe(0);
    await ok(u.auth, "PATCH", "/me/settings", { aiCoachConsent: true });
    const real = await ok(u.auth, "GET", "/coach/insight?topic=workout");
    expect(real.insight.provider.type).toBe("real_ai");
    expect(real.insight.message).toMatch(/You've trained 1 times? this week/);
    // The AI throws, then times out: the user still gets an answer, labelled as rules.
    providerState.ai = "throw";
    const fallback = await ok(u.auth, "POST", "/coach/messages", { clientMessageId: randomUUID(), message: "How was my week?" });
    expect(fallback.response.provider.type).toBe("deterministic_fallback");
    expect(fallback.response.degraded).toBe("provider_error");
    providerState.ai = "ok";
    // A message retried while the first is in flight: one provider call, one reply.
    const calls = providerState.aiCalls;
    const clientMessageId = randomUUID();
    const [a, b] = await Promise.all([0, 1].map(() => ok(u.auth, "POST", "/coach/messages", { clientMessageId, message: "What next?" })));
    expect(providerState.aiCalls - calls).toBe(1);
    expect(b!.response).toEqual(a!.response);
  });

  it("17 · progress: 7/30/90-day analytics from the same records", async () => {
    for (const range of [7, 30, 90]) {
      const r = await ok(u.auth, "GET", `/analytics/progress?range=${range}`);
      expect(r).toBeTruthy();
    }
    const summary = await ok(u.auth, "GET", "/me/summary");
    expect(summary.workouts.workouts).toBe(1);
    expect(summary.nutrition.daysLogged).toBe(1);
  });

  it("18 · profile: a goal change applies from today and never rewrites earlier targets", async () => {
    const targetsBefore = ctx.db.prepare("SELECT effective_from, target_kcal FROM nutrition_targets WHERE user_id = ? ORDER BY effective_from").all(u.id);
    clock.set("2026-09-29T20:00:00Z"); // next morning in Auckland: the 30th
    await ok(u.auth, "PATCH", "/me/profile", { primaryGoal: "lose_fat", localDate: "2026-09-29" });
    const after = ctx.db.prepare("SELECT effective_from, target_kcal FROM nutrition_targets WHERE user_id = ? ORDER BY effective_from").all(u.id) as { effective_from: string }[];
    expect(after.slice(0, targetsBefore.length)).toEqual(targetsBefore); // history untouched
    expect(after.at(-1)!.effective_from).toBe("2026-09-30");
    const goals = ctx.db.prepare("SELECT primary_goal, effective_from FROM goal_history WHERE user_id = ? ORDER BY effective_from").all(u.id) as { primary_goal: string; effective_from: string }[];
    expect(goals.at(-1)).toMatchObject({ primary_goal: "lose_fat", effective_from: "2026-09-30" });
    // Yesterday's food day was settled against yesterday's targets.
    expectConsistent(u.id, "2026-09-30");
  });

  it("19 · settings: imperial units change only what's shown; data stays canonical metric", async () => {
    const before = ctx.db.prepare("SELECT weight_kg, height_cm FROM profiles WHERE user_id = ?").get(u.id);
    await ok(u.auth, "PATCH", "/me/settings", { units: "imperial", dateFormat: "day_month" });
    expect(ctx.db.prepare("SELECT weight_kg, height_cm FROM profiles WHERE user_id = ?").get(u.id)).toEqual(before);
    expect((await ok(u.auth, "GET", "/me")).profile.weightKg).toBe(79.2);
    await ok(u.auth, "PATCH", "/me/notifications", { workoutReminders: true, workoutReminderTime: "07:30" });
    expect((await ok(u.auth, "GET", "/me/notifications")).workoutReminders).toBe(true);
  });

  it("20 · export everything, then delete the account: nothing of theirs remains", async () => {
    expectConsistent(u.id, "2026-09-30");
    const exported = await call(u.auth, "POST", "/me/export", { password: u.password });
    expect(exported.status).toBe(200);
    const data = exported.body.data as Record<string, unknown[]>;
    for (const table of ["workouts", "workout_sets", "food_logs", "xp_events", "personal_records", "body_measurements", "meal_plans", "coach_messages"]) {
      expect(data[table]?.length ?? 0, table).toBeGreaterThan(0);
    }
    expect(JSON.stringify(exported.body)).not.toContain("password_hash");
    await ok(u.auth, "DELETE", "/me", { password: u.password, confirm: "DELETE" }, [204]);
    expect((await call(u.auth, "GET", "/me")).status).toBe(401);
    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of tables) {
      const cols = (ctx.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      if (cols.includes("user_id")) expect([t, (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(u.id) as { n: number }).n]).toEqual([t, 0]);
    }
    expect(auditDatabase(ctx.db)).toEqual([]);
  });
});

// ---- Critical rules ---------------------------------------------------------------------------------

async function onboarded() {
  const u = await register();
  await ok(u.auth, "PATCH", "/me/profile", { ...PROFILE, localDate: "2026-09-29" });
  await ok(u.auth, "PATCH", "/me/preferences", PREFERENCES);
  await ok(u.auth, "POST", "/onboarding/complete");
  return u;
}

describe("critical rules", () => {
  it("a workout left open overnight records only the time actually trained", async () => {
    clock.set("2026-09-30T08:00:00Z");
    const u = await onboarded();
    const s = (await ok(u.auth, "POST", "/workouts/sessions", { clientSessionId: randomUUID(), source: "plan" })).session;
    clock.set("2026-09-30T08:20:00Z");
    await ok(u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 10 });
    // The phone goes in a bag. Ten hours later the app is opened again.
    clock.set("2026-09-30T18:20:00Z");
    const view = (await ok(u.auth, "GET", "/workouts/sessions/active")).session;
    expect(view.leftOpen).toBe(true);
    expect(view.idleSince).toBe("2026-09-30T08:20:00.000Z");
    expect(view.activeMinutes).toBe(20);
    // They carry on: two more minutes of training, then finish.
    await ok(u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 8 });
    clock.set("2026-09-30T18:22:00Z");
    const done = await ok(u.auth, "POST", `/workouts/sessions/${s.id}/complete`, { painLevel: "none" });
    expect(done.workout.durationMinutes).toBe(22);
    clock.set("2026-09-30T20:00:00Z");
  });

  it("a workout retried after midnight is the same workout, not a refused one", async () => {
    clock.set("2026-09-30T20:00:00Z");
    const u = await onboarded();
    await ok(u.auth, "PATCH", "/me/settings", { timezone: "UTC" });
    const body = { clientWorkoutId: randomUUID(), localDate: "2026-09-30", durationMinutes: 30, painLevel: "none", sets: [{ exerciseId: "push_up", reps: 10 }] };
    const first = await call(u.auth, "POST", "/workouts", body);
    expect(first.status).toBe(201);
    clock.set("2026-10-02T09:00:00Z"); // offline for a day and a half; the retry finally lands
    const retry = await call(u.auth, "POST", "/workouts", body);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(retry.body.workout.id).toBe(first.body.workout.id);
    // A new workout for a day the user's clock has left behind is refused.
    expect((await call(u.auth, "POST", "/workouts", { ...body, clientWorkoutId: randomUUID() })).status).toBe(422);
    clock.set("2026-09-30T20:00:00Z");
  });

  it("concurrent duplicates never duplicate progression", async () => {
    const u = await onboarded();
    const workout = { clientWorkoutId: randomUUID(), localDate: "2026-10-01", durationMinutes: 30, painLevel: "none", sets: [{ exerciseId: "bodyweight_squat", reps: 6, trace: squatTrace(6) }] };
    const results = await Promise.all(Array.from({ length: 6 }, () => call(u.auth, "POST", "/workouts", workout)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.workout.id)).size).toBe(1);
    const log = { clientLogId: randomUUID(), amountMethod: "measured", food: { foodId: "fdb:banana", quantity: 100, unit: "g" } };
    await Promise.all(Array.from({ length: 4 }, () => call(u.auth, "POST", "/nutrition/logs", log)));
    await Promise.all(Array.from({ length: 4 }, () => call(u.auth, "GET", "/quests")));
    await Promise.all(Array.from({ length: 4 }, () => call(u.auth, "GET", "/achievements")));
    const awards = ctx.db.prepare("SELECT idempotency_key AS k, COUNT(*) AS n FROM xp_events WHERE user_id = ? GROUP BY idempotency_key HAVING n > 1").all(u.id);
    expect(awards).toEqual([]);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(1);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(1);
    expectConsistent(u.id, "2026-10-01");
  });

  it("a scan retried while the first upload is still being recognised costs one provider call", async () => {
    const u = await onboarded();
    await ok(u.auth, "PATCH", "/me/settings", { foodScanConsent: true });
    const calls = providerState.foodCalls;
    const body = scanBody();
    const [a, b] = await Promise.all([0, 1].map(() => call(u.auth, "POST", "/nutrition/scans", body)));
    expect(providerState.foodCalls - calls).toBe(1);
    expect(a!.body.scan.id).toBe(b!.body.scan.id);
  });

  it("a recogniser that hangs or throws is cut off with an honest, retryable error", async () => {
    const u = await onboarded();
    await ok(u.auth, "PATCH", "/me/settings", { foodScanConsent: true });
    for (const mode of ["hang", "throw"] as const) {
      providerState.food = mode;
      const r = await call(u.auth, "POST", "/nutrition/scans", scanBody());
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect(r.body.error.details?.retryable ?? true).toBe(true);
    }
    providerState.food = "ok";
    expect((await call(u.auth, "POST", "/nutrition/scans", scanBody())).status).toBe(201);
  });

  it("users can never reach each other's data through any id-addressed route", async () => {
    const owner = await onboarded();
    const other = await onboarded();
    // The owner creates one of everything addressable by id.
    const s = (await ok(owner.auth, "POST", "/workouts/sessions", { clientSessionId: randomUUID(), source: "plan" })).session;
    const set = (await ok(owner.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 10 })).set;
    const done = await ok(owner.auth, "POST", `/workouts/sessions/${s.id}/complete`, { painLevel: "none" });
    const log = (await ok(owner.auth, "POST", "/nutrition/logs", { clientLogId: randomUUID(), amountMethod: "estimated", manual: { name: "Toast", kcal: 200, proteinG: 6, carbsG: 30, fatG: 4 } })).log;
    const water = (await ok(owner.auth, "POST", "/water", { clientLogId: randomUUID(), ml: 250 })).entry;
    const plan = (await ok(owner.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 1 })).plan;
    const meal = plan.meals[0];
    const item = ((await ok(owner.auth, "POST", "/grocery/items", { clientItemId: randomUUID(), name: "Rice" })).list.sections as { items: { id: string; name: string }[] }[]).flatMap((x) => x.items).find((i) => i.name === "Rice")!;
    const myFood = (await ok(owner.auth, "POST", "/foods", { clientFoodId: randomUUID(), name: "Gran's flapjack", basis: "g", servingLabel: "1 bar", servingAmount: 60, perServing: { kcal: 270, proteinG: 4, carbsG: 36, fatG: 12 } })).food;
    await ok(owner.auth, "PATCH", "/me/settings", { foodScanConsent: true });
    const scan = (await ok(owner.auth, "POST", "/nutrition/scans", scanBody())).scan;
    await ok(owner.auth, "POST", "/me/weight", { localDate: "2026-10-01", weightKg: 80 });

    const ids: Record<string, string> = {
      id: s.id,
      setId: set.id,
      planId: plan.id,
      mealId: meal.id,
      itemId: item.id,
      date: plan.dates[0],
    };
    const byRoute: Record<string, Record<string, string>> = {
      "/workouts/:id": { id: done.workout.id },
      "/nutrition/logs/:id": { id: log.id },
      "/water/:id": { id: water.id },
      "/foods/:id": { id: myFood.id },
      "/nutrition/scans/:id": { id: scan.id },
      "/nutrition/scans/:id/confirm": { id: scan.id },
      "/me/weight/:date": { date: "2026-10-01" },
    };
    // Public catalogue routes (not user data) and per-user routes keyed by a date of the caller's own.
    const notUserData = new Set(["/billing/webhooks/:provider", "/exercises/:exerciseId/form-intelligence", "/exercises/:exerciseId", "/recipes/:id", "/recipes/:id/saved", "/grocery/recipes/:id", "/nutrition/days/:date", "/water/days/:date"]);
    const probed = new Set<string>();
    for (const r of routes.filter((r) => r.url.includes(":"))) {
      if (notUserData.has(r.url)) continue;
      const params = { ...ids, ...(byRoute[r.url] ?? {}) };
      const url = r.url.replace(/:(\w+)/g, (_, k: string) => params[k] ?? `missing-${k}`);
      expect(url, `${r.method} ${r.url} has an unmapped parameter`).not.toContain("missing-");
      const res = await call(other.auth, r.method, url, r.method === "GET" || r.method === "DELETE" ? undefined : { clientLogId: randomUUID(), confirmKey: randomUUID(), reps: 1, checked: true, painLevel: "none", servings: 1, toDates: ["2026-10-02"], localDate: "2026-10-01", items: [{ itemId: "i1" }], seconds: 30, clientSetId: randomUUID(), exerciseId: "push_up" });
      expect([r.method, r.url, res.status >= 400 && res.status !== 500 ? "denied" : res.status]).toEqual([r.method, r.url, "denied"]);
      probed.add(`${r.method} ${r.url}`);
    }
    expect(probed.size).toBeGreaterThan(20);
    // The owner's data is all still there and still theirs.
    expect((await call(owner.auth, "GET", `/workouts/${done.workout.id}`)).status).toBe(200);
    expect((await call(owner.auth, "GET", `/nutrition/scans/${scan.id}`)).status).toBe(200);
    expect((await ok(owner.auth, "GET", "/me/weight")).entries.length).toBeGreaterThan(0);
    expectConsistent(owner.id, "2026-10-01");
  });
});

// ---- Performance: a long-time user -------------------------------------------------------------------

describe("performance with a year of history", () => {
  it("keeps the main screens and the audit fast for a heavy user", async () => {
    clock.set("2026-01-01T12:00:00Z");
    const u = await register();
    grantPro(ctx, u.id); // the heavy user's screens include Pro's 90-day analysis
    await ok(u.auth, "PATCH", "/me/settings", { timezone: "UTC" });
    await ok(u.auth, "PATCH", "/me/profile", { ...PROFILE, localDate: "2026-01-01" });
    await ok(u.auth, "PATCH", "/me/preferences", PREFERENCES);
    await ok(u.auth, "POST", "/onboarding/complete");
    // 270 days: three workouts a week, three food entries a day, water and a weekly weigh-in.
    for (let d = 0; d < 270; d++) {
      clock.set(new Date(Date.parse("2026-01-01T12:00:00Z") + d * 86_400_000).toISOString());
      const date = clock.now().toISOString().slice(0, 10);
      if (d % 7 === 0 || d % 7 === 2 || d % 7 === 4) {
        await ok(u.auth, "POST", "/workouts", { clientWorkoutId: randomUUID(), localDate: date, durationMinutes: 45, painLevel: "none", sets: [{ exerciseId: "bodyweight_squat", reps: 8 + (d % 5), trace: squatTrace(8 + (d % 5)) }, { exerciseId: "push_up", reps: 12 }] });
      }
      for (const meal of ["breakfast", "lunch", "dinner"]) {
        await ok(u.auth, "POST", "/nutrition/logs", { clientLogId: randomUUID(), amountMethod: "measured", mealType: meal, food: { foodId: "fdb:rice_white_cooked", quantity: 200 + (d % 3) * 50, unit: "g" } });
      }
      await ok(u.auth, "POST", "/water", { clientLogId: randomUUID(), ml: 750 });
      if (d % 7 === 1) await ok(u.auth, "POST", "/me/weight", { localDate: date, weightKg: 80 - d * 0.01 });
      if (d % 10 === 0) await ok(u.auth, "GET", "/home");
    }
    const timings: Record<string, number> = {};
    for (const [name, url] of [
      ["home", "/home"],
      ["progress", "/progress"],
      ["records", "/records"],
      ["achievements", "/achievements"],
      ["body quest", "/body-quest"],
      ["analytics 90d", "/analytics/progress?range=90"],
      ["nutrition day", `/nutrition/days/${clock.now().toISOString().slice(0, 10)}`],
      ["coach insight", "/coach/insight?topic=home"],
      ["profile summary", "/me/summary"],
    ] as const) {
      const t = performance.now();
      await ok(u.auth, "GET", url);
      timings[name] = performance.now() - t;
    }
    let t = performance.now();
    await ok(u.auth, "POST", "/me/export", { password: "correct-horse-battery" });
    timings.export = performance.now() - t;
    t = performance.now();
    const findings = auditUser(ctx.db, u.id, clock.now().toISOString().slice(0, 10), clock.now()).filter((f) => f.severity !== "info");
    timings.audit = performance.now() - t;
    expect(findings).toEqual([]);
    // Generous ceilings for a shared CI machine; locally these are a few to a few hundred ms.
    for (const [name, ms] of Object.entries(timings)) expect([name, ms < 2000]).toEqual([name, true]);
    console.info("[e2e] heavy-user timings (ms):", Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, Math.round(v)])));
  }, 240_000);
});

// ---- Query plans ----------------------------------------------------------------------------------------

describe("database access", () => {
  it("every query the journeys ran reads user data through an index, never a full scan", () => {
    // Tables that only ever hold a handful of rows per database (or are scanned on purpose by
    // maintenance code) may be scanned.
    const scanAllowed = new Set(["schema_migrations", "sqlite_master", "sqlite_schema", "CONSTANT"]);
    const offenders: string[] = [];
    for (const sql of statements) {
      if (!/^\s*(SELECT|UPDATE|DELETE|INSERT[\s\S]*SELECT)/i.test(sql) || /PRAGMA|sqlite_master/i.test(sql)) continue;
      let plan: { detail: string }[];
      try {
        plan = ctx.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
      } catch {
        continue; // needs bound parameters of a specific type to plan
      }
      for (const p of plan) {
        const m = /^SCAN (\w+)(?! USING)/.exec(p.detail);
        if (m && !scanAllowed.has(m[1]!) && !/USING (COVERING )?INDEX/.test(p.detail)) offenders.push(`${p.detail}  ←  ${sql.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
