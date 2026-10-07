import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, type AiCoachProvider, type CoachProviderRequest, type ProviderRegistry } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { analyticsCacheStats } from "../src/modules/analytics/service";
import type { AppContext } from "../src/shared/context";
import { allow, foodLog, makeApp, onboard, registerUser, squatTrace, TestClock, testConfig, grantPro } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth, payload });
const analytics = async (auth: Auth, q = "range=30") => (await get(auth, `/analytics/progress?${q}`)).analytics;

async function user(at = "2026-09-30T12:00:00Z", profile: Record<string, unknown> = {}) {
  const clock = new TestClock(new Date(at));
  ({ app, ctx } = await makeApp({ clock }));
  const u = await registerUser(app);
  grantPro(ctx, u.id); // 90-day ranges and form/ROM trends are FORM Pro
  await onboard(app, u.auth, at.slice(0, 10));
  if (Object.keys(profile).length) await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { ...profile, localDate: at.slice(0, 10) } });
  return { ...u, clock };
}
const squat = (localDate: string, loadKg: number, bottom = 90, reps = 5) => ({ clientWorkoutId: randomUUID(), localDate, durationMinutes: 40, painLevel: "none", sets: [{ exerciseId: "squat", reps, loadKg, trace: squatTrace(reps, bottom) }] });
const pushUps = (localDate: string, reps = 10) => ({ clientWorkoutId: randomUUID(), localDate, durationMinutes: 20, painLevel: "none", sets: [{ exerciseId: "push_up", reps, loadKg: 0 }] });
async function trainOn(u: { auth: Auth; clock: TestClock }, date: string, body: object) {
  u.clock.set(`${date}T12:00:00Z`);
  const r = await post(u.auth, "/workouts", body);
  expect(r.statusCode).toBe(201);
}

describe("ranges", () => {
  it("accepts 7, 30 and 90 days only, ending on the user's today", async () => {
    const u = await user();
    for (const days of [7, 30, 90]) expect((await analytics(u.auth, `range=${days}`)).range).toMatchObject({ days, to: "2026-09-30" });
    expect((await analytics(u.auth, "range=7")).range.from).toBe("2026-09-24");
    expect((await app.inject({ method: "GET", url: "/analytics/progress?range=14", headers: u.auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/analytics/progress?range=30&bogus=1", headers: u.auth })).statusCode).toBe(400);
  });

  it("uses the user's own time zone for day boundaries", async () => {
    const u = await user("2026-09-30T12:00:00Z");
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone: "Pacific/Auckland" } });
    u.clock.set("2026-09-30T11:30:00Z"); // 00:30 on 1 Oct in Auckland
    expect((await post(u.auth, "/workouts", pushUps("2026-10-01"))).statusCode).toBe(201);
    const a = await analytics(u.auth, "range=7");
    expect(a.range).toMatchObject({ to: "2026-10-01", timezone: "Pacific/Auckland" });
    expect(a.consistency.data.trainingDays).toBe(1);
    expect(a.summaries.daily.at(-1)).toMatchObject({ key: "2026-10-01", workouts: 1 });
  });
});

describe("an empty user", () => {
  it("gets honest empty states, never invented trends", async () => {
    const u = await user();
    const a = await analytics(u.auth, "range=90");
    for (const s of ["strength", "form", "rom", "verifiedReps", "nutrition", "prs", "quests"]) expect(a[s].available).toBe(false);
    // The only real data point: the weight given during onboarding — one entry is no trend.
    expect(a.weight.data).toMatchObject({ entries: 1, chart: { state: "insufficient_data", trend: { direction: "insufficient_data", reason: "too_few_points" } } });
    expect(a.form.data.chart).toMatchObject({ state: "no_data", trend: { direction: "insufficient_data" } });
    expect(a.consistency.data).toMatchObject({ trainingDays: 0, adherencePercent: null }); // started today: nothing expected yet
    expect(a.summaries.weekly.every((w: { hasData: boolean }) => !w.hasData)).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/percentile|body ?fat|lean mass/i);
  });
});

describe("training analytics", () => {
  it("tracks strength, form, ROM and verified reps from verified sets, with exercise filtering", async () => {
    const u = await user("2026-09-07T12:00:00Z");
    const plan: [string, number][] = [["2026-09-07", 60], ["2026-09-10", 62.5], ["2026-09-14", 65], ["2026-09-17", 67.5], ["2026-09-21", 70]];
    for (const [d, kg] of plan) await trainOn(u, d, squat(d, kg));
    await trainOn(u, "2026-09-24", pushUps("2026-09-24"));
    u.clock.set("2026-09-30T12:00:00Z");
    const a = await analytics(u.auth);
    expect(a.strength.data.exercises.map((e: { exerciseId: string }) => e.exerciseId)).toEqual(["squat"]); // push-ups weren't verified
    expect(a.strength.data.selected).toMatchObject({ exerciseId: "squat", measure: "estimated_1rm", chart: { trend: { direction: "improving", movement: "up" } } });
    expect(a.strength.interpretation).toMatch(/Trending up/);
    expect(a.verifiedReps.data.total).toBe(25);
    expect(a.form.data.averageScore).toBeGreaterThan(0);
    expect(a.rom.data.chart.trend.direction).toBe("stable");
    expect(a.consistency.data).toMatchObject({ trainingDays: 6, workouts: 6 });
    // Weeks before the user started aren't missed weeks: 90 days reads the same as 30 here.
    const wide = await analytics(u.auth, "range=90");
    expect(wide.consistency.data.adherencePercent).toBe(a.consistency.data.adherencePercent);
    expect(wide.consistency.data.plannedDays).toBe(a.consistency.data.plannedDays);
    // Filtering to an exercise with no verified data is honest, and an unknown one is refused.
    const pushup = await analytics(u.auth, "range=30&exercise=push_up");
    expect(pushup.strength.data.selected).toMatchObject({ exerciseId: "push_up", chart: { state: "no_data" } });
    expect(pushup.form.available).toBe(false);
    expect((await app.inject({ method: "GET", url: "/analytics/progress?range=30&exercise=made_up", headers: u.auth })).statusCode).toBe(400);
  });

  it("sees range of motion improve when reps get deeper", async () => {
    const u = await user("2026-09-07T12:00:00Z");
    const depths: [string, number][] = [["2026-09-07", 100], ["2026-09-12", 97], ["2026-09-17", 94], ["2026-09-22", 90]];
    for (const [d, bottom] of depths) await trainOn(u, d, squat(d, 60, bottom));
    u.clock.set("2026-09-30T12:00:00Z");
    const rom = (await analytics(u.auth)).rom.data.chart;
    const values = rom.points.filter((p: { value: number | null }) => p.value !== null).map((p: { value: number }) => p.value);
    expect(values.length).toBe(4);
    expect(values[3]).toBeGreaterThan(values[0]);
    expect(rom.trend.direction).toBe("improving");
  });

  it("lists records beaten in range apart from first-time baselines, and counts XP", async () => {
    const u = await user("2026-09-21T12:00:00Z");
    await trainOn(u, "2026-09-21", squat("2026-09-21", 60));
    await trainOn(u, "2026-09-24", squat("2026-09-24", 65));
    u.clock.set("2026-09-30T12:00:00Z");
    const a = await analytics(u.auth);
    const beaten = a.prs.data.records.filter((r: { beaten: boolean }) => r.beaten);
    expect(beaten.map((r: { label: string }) => r.label)).toEqual(expect.arrayContaining(["Heaviest weight", "Estimated one-rep max"]));
    expect(beaten.find((r: { label: string }) => r.label === "Heaviest weight")).toMatchObject({ display: "65 kg", previousDisplay: "60 kg", date: "2026-09-24" });
    expect(a.prs.data.records.some((r: { beaten: boolean }) => !r.beaten)).toBe(true);
    expect(a.xp.data.earned).toBeGreaterThan(0);
    const xp = a.xp.data.chart.points.filter((p: { value: number | null }) => p.value !== null).map((p: { value: number }) => p.value);
    expect(xp.at(-1)).toBeGreaterThanOrEqual(xp[0]); // active XP only falls on decay or reset
    expect(a.achievements.unlocked.map((x: { title: string }) => x.title)).toEqual(expect.arrayContaining(["First Workout", "First Rep"]));
    expect(a.streaks.workout.longest).toBeGreaterThanOrEqual(1);
  });

  it("shows Body Quest history from weekly snapshots", async () => {
    const u = await user("2026-09-07T12:00:00Z");
    for (const d of ["2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14", "2026-09-16", "2026-09-18", "2026-09-21", "2026-09-23"]) await trainOn(u, d, squat(d, 60));
    u.clock.set("2026-09-30T12:00:00Z");
    const a = await analytics(u.auth);
    expect(a.bodyQuest.available).toBe(true);
    expect(a.bodyQuest.data.chart.points.filter((p: { value: number | null }) => p.value !== null).length).toBeGreaterThanOrEqual(2);
    expect(a.bodyQuest.data.stage).toBeTruthy();
  });
});

describe("nutrition and weight", () => {
  it("separates estimated from weighed food, judges finished days only, and counts the safe minimum", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    const t = ctx.db.prepare("SELECT target_kcal AS kcal, safe_floor_kcal AS floor FROM nutrition_targets WHERE user_id = ?").get(u.id) as { kcal: number; floor: number };
    await post(u.auth, "/nutrition/logs", foodLog({ localDate: "2026-09-28", kcal: Math.round(t.kcal * 0.5), grams: null })); // estimated
    await post(u.auth, "/nutrition/logs", foodLog({ localDate: "2026-09-28", kcal: Math.round(t.kcal * 0.5), grams: 300 })); // weighed
    u.clock.set("2026-09-29T12:00:00Z");
    await post(u.auth, "/nutrition/logs", foodLog({ localDate: "2026-09-29", kcal: Math.round(t.floor * 0.5), grams: 200 })); // under the minimum
    u.clock.set("2026-09-30T12:00:00Z");
    await post(u.auth, "/nutrition/logs", foodLog({ localDate: "2026-09-30", kcal: 400, grams: 100 })); // today: not judged yet
    const n = (await analytics(u.auth, "range=7")).nutrition.data;
    expect(n).toMatchObject({ daysLogged: 3, daysOnTarget: 1, daysBelowSafeMinimum: 1, hasTargets: true });
    expect(n.estimatedPercent + n.measuredPercent).toBe(100);
    expect(n.estimatedPercent).toBeGreaterThan(0);
    expect(n.kcalChart.points.find((p: { key: string }) => p.key === "2026-09-28")).toMatchObject({ estimated: true });
    expect(n.kcalChart.points.find((p: { key: string }) => p.key === "2026-09-29")).toMatchObject({ estimated: false });
    expect(n.kcalChart).toMatchObject({ unit: "kcal", trendUnit: "%" });
  });

  it("converts weight to pounds and reads it against the user's goal", async () => {
    const u = await user("2026-09-30T12:00:00Z", { primaryGoal: "lose_fat" });
    const entries: [string, number][] = [["2026-09-05", 84], ["2026-09-12", 83.4], ["2026-09-19", 82.9], ["2026-09-30", 82.2]];
    for (const [d, kg] of entries) expect((await post(u.auth, "/me/weight", { localDate: d, weightKg: kg })).statusCode).toBeLessThan(300);
    const metric = await analytics(u.auth);
    expect(metric.weight.data).toMatchObject({ latest: 82.2, latestDate: "2026-09-30", chart: { unit: "kg", trend: { direction: "improving" } } });
    expect(metric.weight.interpretation).toMatch(/direction of your goal/);
    expect(metric.order[0]).toBe("consistency"); // lose_fat puts consistency, nutrition and weight first
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { units: "imperial" } });
    const imperial = await analytics(u.auth);
    expect(imperial.units).toBe("imperial");
    expect(imperial.weight.data.latest).toBeCloseTo(181.2, 1);
    expect(imperial.weight.data.chart).toMatchObject({ unit: "lb", trend: { direction: "improving" } });
    await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { primaryGoal: "build_muscle", localDate: "2026-09-30" } });
    expect((await analytics(u.auth)).weight.data.chart.trend.direction).toBe("declining"); // same data, the opposite goal
  });
});

describe("isolation, caching and performance", () => {
  it("never shows one user's data to another", async () => {
    const a = await user("2026-09-28T12:00:00Z");
    await trainOn(a, "2026-09-28", squat("2026-09-28", 60));
    const b = await registerUser(app);
    grantPro(ctx, b.id);
    const theirs = (await get(b.auth, "/analytics/progress?range=90")).analytics;
    expect(theirs.consistency.data.trainingDays).toBe(0);
    expect(theirs.strength.data.exercises).toEqual([]);
    expect(theirs.prs.data.records).toEqual([]);
  });

  it("computes 90 days of dense data quickly, serves repeats from cache, and invalidates on new data", async () => {
    const u = await user("2026-09-30T12:00:00Z");
    // Seed 90 days directly: a workout with three verified sets every other day, and three food logs a day.
    const insW = ctx.db.prepare("INSERT INTO workouts (id, user_id, client_workout_id, local_date, duration_minutes, pain_level, xp_flags, created_at) VALUES (?, ?, ?, ?, 45, 'none', '[]', ?)");
    const insS = ctx.db.prepare("INSERT INTO workout_sets (workout_id, set_index, exercise_id, reps, verified_reps, verification_status, rom_percent, load_kg, form_score) VALUES (?, ?, 'squat', 5, 5, 'verified', ?, ?, ?)");
    const insF = ctx.db.prepare(
      `INSERT INTO food_logs (id, user_id, client_log_id, local_date, meal_type, logged_at, name, source, amount_method, kcal, protein_g, carbs_g, fat_g, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'lunch', ?, 'Meal', 'manual', 'estimated', 700, 40, 80, 20, ?, ?)`,
    );
    ctx.db.exec("BEGIN");
    for (let i = 0; i < 90; i++) {
      const date = new Date(Date.parse("2026-07-03T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      const at = `${date}T12:00:00.000Z`;
      if (i % 2 === 0) {
        const id = randomUUID();
        insW.run(id, u.id, randomUUID(), date, at);
        for (let s = 0; s < 3; s++) insS.run(id, s, 90 + (i % 10), 60 + i / 4, 80 + (i % 15));
      }
      for (let m = 0; m < 3; m++) insF.run(randomUUID(), u.id, randomUUID(), date, at, at, at);
    }
    ctx.db.exec("COMMIT");

    const t0 = performance.now();
    const first = await analytics(u.auth, "range=90");
    const cold = performance.now() - t0;
    expect(first.consistency.data.trainingDays).toBe(45);
    expect(first.strength.data.selected.chart.trend.direction).toBe("improving");
    expect(first.nutrition.data).toMatchObject({ daysLogged: 90, estimatedPercent: 100 });
    expect(first.summaries.monthly.map((m: { key: string }) => m.key)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(cold).toBeLessThan(2000);

    const hits = analyticsCacheStats.hits;
    await analytics(u.auth, "range=90");
    expect(analyticsCacheStats.hits).toBe(hits + 1); // unchanged data: served from cache

    await post(u.auth, "/me/weight", { localDate: "2026-09-30", weightKg: 79 });
    const misses = analyticsCacheStats.misses;
    const after = await analytics(u.auth, "range=90");
    expect(analyticsCacheStats.misses).toBe(misses + 1); // new data: recomputed
    expect(after.weight.data.entries).toBeGreaterThan(0);
  });
});

describe("AI coach", () => {
  it("gets trend words and counts from analytics, not raw series", async () => {
    const calls: CoachProviderRequest[] = [];
    const ai: AiCoachProvider = {
      kind: "ai",
      status: () => ({ state: "ready", provider: "Test AI" }),
      respond: async (r) => (calls.push(r), { ok: true, value: { message: "Keep going.", category: "general", priority: "normal", evidence: [{ fact: "training.workoutsLast7Days", claim: "Workouts" }], actions: [], confidence: "medium" } }),
    };
    const clock = new TestClock(new Date("2026-09-07T12:00:00Z"));
    const providers: ProviderRegistry = { ...createUnconfiguredProviders(), ai };
    ({ app, ctx } = await makeApp({ clock, providers, config: { coach: { ...testConfig.coach, provider: "anthropic" } } }));
    const u = { ...(await registerUser(app)), clock };
    grantPro(ctx, u.id);
    await allow(app, u.auth, { aiCoach: true });
    await onboard(app, u.auth, "2026-09-07");
    for (const [d, kg] of [["2026-09-07", 60], ["2026-09-12", 62.5], ["2026-09-17", 65], ["2026-09-22", 67.5]] as [string, number][]) await trainOn(u, d, squat(d, kg));
    u.clock.set("2026-09-30T12:00:00Z");
    await get(u.auth, "/coach/insight");
    const facts = calls[0]!.context.facts;
    expect(facts).toMatchObject({ "analytics.30d.trend.strength": "improving", "analytics.30d.strengthExercise": "Barbell Back Squat", "analytics.30d.trainingDays": 4, "analytics.30d.verifiedReps": 20 });
    // Words and counts, never series: a small block per range (Pro adds the 90-day view).
    expect(Object.keys(facts).filter((k) => k.startsWith("analytics.30d.")).length).toBeLessThan(25);
    expect(Object.keys(facts).filter((k) => k.startsWith("analytics.90d.")).length).toBeLessThan(25);
    expect(facts["analytics.90d.trainingDays"]).toBe(4);
  });
});
