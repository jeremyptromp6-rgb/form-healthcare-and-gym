import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, type CoachContext, type ProviderRegistry } from "@form/domain";
import { testConfig } from "./helpers";
import type { FastifyInstance } from "fastify";
import { migrate, openDb, schemaVersion } from "../src/db";
import { MIGRATIONS } from "../src/db/migrations";
import type { AppContext } from "../src/shared/context";
import { allow, foodLog, makeApp, onboard, registerUser, TestClock, TODAY, YESTERDAY } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth, payload });
const patch = (auth: Auth, url: string, payload: object) => app.inject({ method: "PATCH", url, headers: auth, payload });

async function user(opts: { clock?: TestClock; onboarded?: boolean; onboardDate?: string } = {}) {
  ({ app, ctx } = await makeApp({ clock: opts.clock }));
  const u = await registerUser(app);
  if (opts.onboarded) await onboard(app, u.auth, opts.onboardDate);
  return u;
}

const fromFood = (foodId: string, quantity: number, unit: string, extra: Record<string, unknown> = {}) => ({
  clientLogId: randomUUID(),
  localDate: TODAY,
  mealType: "lunch",
  amountMethod: unit === "serving" ? "label" : "measured",
  food: { foodId, quantity, unit, ...(extra.servingId ? { servingId: extra.servingId } : {}) },
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "servingId")),
});

describe("food search, detail and user foods", () => {
  it("searches the verified database and returns full food details", async () => {
    const u = await user();
    const res = await get(u.auth, "/foods/search?q=chicken%20breast");
    expect(res.foods[0]).toMatchObject({ origin: "verified_database", basis: "g" });
    expect(res.foods.map((f: { name: string }) => f.name)).toContain("Chicken breast, skinless, cooked");
    const detail = await get(u.auth, "/foods/fdb:chicken_breast_cooked");
    expect(detail.food).toMatchObject({ per100: { kcal: 165, proteinG: 31 }, servings: [{ id: "s1", amount: 172 }] });
    expect((await app.inject({ method: "GET", url: "/foods/fdb:nope", headers: u.auth })).statusCode).toBe(404);
    expect((await get(u.auth, "/foods/search?q=")).foods).toEqual([]);
  });

  it("creates user foods idempotently from label numbers; they're private and searchable", async () => {
    const a = await user();
    const b = await registerUser(app);
    const body = { clientFoodId: randomUUID(), name: "Acme protein bar", brand: "Acme", basis: "g", servingLabel: "1 bar", servingAmount: 60, perServing: { kcal: 240, proteinG: 20, carbsG: 24, fatG: 8 } };
    const first = await post(a.auth, "/foods", body);
    expect(first.statusCode).toBe(201);
    expect(first.json().food).toMatchObject({ origin: "user_food", per100: { kcal: 400 } });
    expect(first.json().food.per100.proteinG).toBeCloseTo(33.333, 3); // kept at full precision
    const again = await post(a.auth, "/foods", body);
    expect(again.statusCode).toBe(200);
    expect(again.json().food.id).toBe(first.json().food.id);
    expect((await get(a.auth, "/foods/mine")).foods).toHaveLength(1);
    expect((await get(a.auth, "/foods/search?q=acme")).foods[0].id).toBe(first.json().food.id);
    // Another user can't see or log it.
    expect((await get(b.auth, "/foods/search?q=acme")).foods).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/foods/${first.json().food.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await post(b.auth, "/nutrition/logs", fromFood(first.json().food.id, 1, "serving", { servingId: "s1" }))).statusCode).toBe(404);
    // Impossible labels are refused.
    expect((await post(a.auth, "/foods", { ...body, clientFoodId: randomUUID(), perServing: { kcal: 900, proteinG: 0, carbsG: 0, fatG: 0 }, servingAmount: 10 })).statusCode).toBe(422);
  });

  it("deleting a user food keeps history intact", async () => {
    const u = await user();
    const food = (await post(u.auth, "/foods", { clientFoodId: randomUUID(), name: "Granola", basis: "g", servingLabel: "½ cup", servingAmount: 50, perServing: { kcal: 220, proteinG: 5, carbsG: 32, fatG: 8 } })).json().food;
    await post(u.auth, "/nutrition/logs", fromFood(food.id, 2, "serving", { servingId: "s1" }));
    expect((await app.inject({ method: "DELETE", url: `/foods/${food.id}`, headers: u.auth })).statusCode).toBe(204);
    const day = await get(u.auth, `/nutrition/days/${TODAY}`);
    expect(day.logs[0]).toMatchObject({ name: "Granola", kcal: 440, source: "user_food" });
    expect((await get(u.auth, "/foods/mine")).foods).toEqual([]);
    expect((await get(u.auth, "/foods/recent")).recent).toEqual([]);
  });
});

describe("logging: servings, units and server-computed macros", () => {
  it("computes macros from the food and the portion — never from the client", async () => {
    const u = await user();
    const res = await post(u.auth, "/nutrition/logs", fromFood("fdb:chicken_breast_cooked", 150, "g"));
    expect(res.statusCode).toBe(201);
    expect(res.json().log).toMatchObject({ kcal: 248, proteinG: 46.5, fatG: 5.4, amount: 150, amountUnit: "g", source: "verified_database", amountMethod: "measured", isEstimate: false });
    const oz = (await post(u.auth, "/nutrition/logs", fromFood("fdb:chicken_breast_cooked", 4, "oz"))).json().log;
    expect(oz).toMatchObject({ amount: 113.4, kcal: 187 });
    const serving = (await post(u.auth, "/nutrition/logs", fromFood("fdb:egg_whole", 2, "serving", { servingId: "s1" }))).json().log;
    expect(serving).toMatchObject({ amount: 100, kcal: 143, servingLabel: "1 large egg (50 g)", amountMethod: "label" });
    const milk = (await post(u.auth, "/nutrition/logs", fromFood("fdb:milk_whole", 8, "fl_oz"))).json().log;
    expect(milk).toMatchObject({ amount: 236.6, amountUnit: "ml", kcal: 151 });
    // A client can't smuggle in its own numbers for a catalog food.
    const smuggled = { ...fromFood("fdb:banana", 1, "serving", { servingId: "s1" }), food: { foodId: "fdb:banana", quantity: 1, unit: "serving", servingId: "s1", kcal: 1 } };
    expect((await post(u.auth, "/nutrition/logs", smuggled)).statusCode).toBe(400);
  });

  it("rejects units that don't fit the food, unknown servings and impossible amounts", async () => {
    const u = await user();
    expect((await post(u.auth, "/nutrition/logs", fromFood("fdb:chicken_breast_cooked", 1, "cup"))).statusCode).toBe(422); // no density known
    expect((await post(u.auth, "/nutrition/logs", fromFood("fdb:orange_juice", 1, "piece", { servingId: "s1" }))).statusCode).toBe(422);
    expect((await post(u.auth, "/nutrition/logs", fromFood("fdb:oats_dry", 1, "serving", { servingId: "s9" }))).statusCode).toBe(422);
    expect((await post(u.auth, "/nutrition/logs", fromFood("fdb:oats_dry", 999, "oz"))).statusCode).toBe(422);
    expect((await post(u.auth, "/nutrition/logs", fromFood("fdb:oats_dry", 0, "g"))).statusCode).toBe(400);
    expect((await post(u.auth, "/nutrition/logs", fromFood("fdb:unknown", 10, "g"))).statusCode).toBe(404);
  });

  it("keeps measured and estimated honest", async () => {
    const u = await user();
    // "Measured" needs a weight/volume: a serving is a label amount, not a measurement.
    expect((await post(u.auth, "/nutrition/logs", { ...fromFood("fdb:banana", 1, "serving", { servingId: "s1" }), amountMethod: "measured" })).statusCode).toBe(422);
    const guess = (await post(u.auth, "/nutrition/logs", { ...fromFood("fdb:banana", 1, "serving", { servingId: "s1" }), amountMethod: "estimated" })).json().log;
    expect(guess).toMatchObject({ amountMethod: "estimated", isEstimate: true });
    const day = await get(u.auth, `/nutrition/days/${TODAY}`);
    expect(day.totals.estimatedKcalShare).toBe(1);
    // The database refuses a "measured" scan even if application code tried to write one.
    expect(() =>
      ctx.db
        .prepare(
          `INSERT INTO food_logs (id, user_id, local_date, meal_type, logged_at, name, source, amount_method, amount, amount_unit, kcal, protein_g, carbs_g, fat_g, created_at, updated_at)
           VALUES ('x', ?, ?, 'lunch', 'now', 'Pasta', 'scan_estimate', 'measured', 200, 'g', 300, 10, 50, 5, 'now', 'now')`,
        )
        .run(u.id, TODAY),
    ).toThrow(/CHECK/);
  });

  it("is idempotent: retries and concurrent duplicates create one entry", async () => {
    const u = await user();
    const body = fromFood("fdb:apple", 1, "serving", { servingId: "s1" });
    expect((await post(u.auth, "/nutrition/logs", body)).statusCode).toBe(201);
    const retry = await post(u.auth, "/nutrition/logs", body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    const concurrent = fromFood("fdb:banana", 1, "serving", { servingId: "s1" });
    await Promise.all([1, 2, 3].map(() => post(u.auth, "/nutrition/logs", concurrent)));
    expect((await get(u.auth, `/nutrition/days/${TODAY}`)).logs).toHaveLength(2);
  });

  it("quick-adds manual entries with typed-in macros", async () => {
    const u = await user();
    const res = await post(u.auth, "/nutrition/logs", foodLog({ localDate: TODAY, name: "Restaurant curry", grams: null, kcal: 850, mealType: "dinner" }));
    expect(res.json().log).toMatchObject({ source: "manual", amountMethod: "estimated", isEstimate: true, kcal: 850, mealType: "dinner", quantity: null });
    expect((await post(u.auth, "/nutrition/logs", foodLog({ localDate: TODAY, grams: null, amountMethod: "measured" }))).statusCode).toBe(422);
  });
});

describe("edit and delete", () => {
  it("edits recompute from the snapshot taken at logging; meal, date and method can change", async () => {
    const u = await user();
    const log = (await post(u.auth, "/nutrition/logs", fromFood("fdb:rice_white_cooked", 1, "serving", { servingId: "s1" }))).json().log;
    expect(log.kcal).toBe(205);
    const doubled = (await patch(u.auth, `/nutrition/logs/${log.id}`, { quantity: 2 })).json().log;
    expect(doubled).toMatchObject({ quantity: 2, amount: 316, kcal: 411, amountMethod: "label" });
    const weighed = (await patch(u.auth, `/nutrition/logs/${log.id}`, { quantity: 180, unit: "g", amountMethod: "measured" })).json().log;
    expect(weighed).toMatchObject({ unit: "g", amount: 180, kcal: 234, amountMethod: "measured", servingLabel: null });
    // Back to a serving while still claiming "measured" is refused.
    expect((await patch(u.auth, `/nutrition/logs/${log.id}`, { unit: "serving", servingId: "s1" })).statusCode).toBe(422);
    const moved = (await patch(u.auth, `/nutrition/logs/${log.id}`, { mealType: "dinner", localDate: YESTERDAY })).json().log;
    expect(moved).toMatchObject({ mealType: "dinner", localDate: YESTERDAY });
    expect((await get(u.auth, `/nutrition/days/${TODAY}`)).logs).toEqual([]);
    expect((await get(u.auth, `/nutrition/days/${YESTERDAY}`)).totals.kcal).toBe(234);
    // Database macros can't be overwritten by hand.
    expect((await patch(u.auth, `/nutrition/logs/${log.id}`, { kcal: 10 })).statusCode).toBe(422);
  });

  it("manual entries take edited macros; other users get 404 for edit and delete", async () => {
    const a = await user();
    const b = await registerUser(app);
    const log = (await post(a.auth, "/nutrition/logs", foodLog({ localDate: TODAY, grams: null, kcal: 500 }))).json().log;
    expect((await patch(a.auth, `/nutrition/logs/${log.id}`, { kcal: 650, name: "Bigger lunch" })).json().log).toMatchObject({ kcal: 650, name: "Bigger lunch" });
    expect((await patch(b.auth, `/nutrition/logs/${log.id}`, { kcal: 1 })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/nutrition/logs/${log.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/nutrition/logs/${log.id}`, headers: a.auth })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/nutrition/logs/${log.id}`, headers: a.auth })).statusCode).toBe(404);
    expect((await get(a.auth, `/nutrition/days/${TODAY}`)).totals.kcal).toBe(0);
  });
});

describe("dates and time zones", () => {
  it("the user's time zone decides the day and the default meal", async () => {
    // 06:30 UTC on the 28th is 23:30 on the 27th in Los Angeles.
    const clock = new TestClock(new Date("2026-09-28T06:30:00Z"));
    const u = await user({ clock });
    await patch(u.auth, "/me/settings", { timezone: "America/Los_Angeles" });
    const late = (await post(u.auth, "/nutrition/logs", { ...fromFood("fdb:apple", 1, "serving", { servingId: "s1" }), localDate: undefined, mealType: undefined })).json().log;
    expect(late).toMatchObject({ localDate: "2026-09-27", mealType: "snack" });
    clock.set("2026-09-28T15:00:00Z"); // 08:00 in LA
    const breakfast = (await post(u.auth, "/nutrition/logs", { ...fromFood("fdb:oats_dry", 40, "g"), localDate: undefined, mealType: undefined })).json().log;
    expect(breakfast).toMatchObject({ localDate: "2026-09-28", mealType: "breakfast" });
  });

  it("logs today or up to 7 days back — never the future", async () => {
    const u = await user();
    const at = (localDate: string) => post(u.auth, "/nutrition/logs", { ...fromFood("fdb:apple", 1, "serving", { servingId: "s1" }), localDate });
    expect((await at("2026-09-20")).statusCode).toBe(201);
    expect((await at("2026-09-19")).statusCode).toBe(422);
    expect((await at("2026-09-28")).statusCode).toBe(422);
  });
});

describe("the Eat day: meals, targets, remaining, water", () => {
  it("groups by meal and reports remaining against the day's targets, with water", async () => {
    const u = await user({ onboarded: true });
    await post(u.auth, "/nutrition/logs", { ...fromFood("fdb:oats_dry", 80, "g"), mealType: "breakfast" });
    await post(u.auth, "/nutrition/logs", { ...fromFood("fdb:chicken_breast_cooked", 200, "g"), mealType: "lunch" });
    await post(u.auth, "/water", { clientLogId: randomUUID(), ml: 500, localDate: TODAY });
    const day = await get(u.auth, `/nutrition/days/${TODAY}?today=${TODAY}`);
    expect(day.byMeal.breakfast).toMatchObject({ kcal: 303, entries: 1 });
    expect(day.byMeal.lunch).toMatchObject({ kcal: 330, entries: 1 });
    expect(day.byMeal.dinner.entries).toBe(0);
    expect(day.totals.kcal).toBe(633);
    expect(day.progress.kcal).toMatchObject({ consumed: 633, target: day.targets.targetKcal, remaining: day.targets.targetKcal - 633, over: 0 });
    expect(day.water).toMatchObject({ totalMl: 500, progress: { consumed: 500 } });
    // Home shows the same real numbers.
    const home = await get(u.auth, `/home?today=${TODAY}`);
    expect(home.nutrition).toMatchObject({ kcal: 633, mealsLogged: 2, mealsWithFood: 2, remainingKcal: day.progress.kcal.remaining });
  });

  it("recent foods list the last portion used", async () => {
    const u = await user();
    await post(u.auth, "/nutrition/logs", fromFood("fdb:banana", 1, "serving", { servingId: "s1" }));
    await post(u.auth, "/nutrition/logs", fromFood("fdb:oats_dry", 40, "g"));
    await post(u.auth, "/nutrition/logs", fromFood("fdb:banana", 2, "serving", { servingId: "s1" }));
    const recent = (await get(u.auth, "/foods/recent")).recent;
    expect(recent.map((r: { food: { id: string } }) => r.food.id)).toEqual(["fdb:banana", "fdb:oats_dry"]);
    expect(recent[0].last).toMatchObject({ quantity: 2, unit: "serving", servingId: "s1" });
  });

  it("aggregates water history, zero-filling days without entries", async () => {
    const u = await user();
    await post(u.auth, "/water", { clientLogId: randomUUID(), ml: 2000, localDate: TODAY });
    await post(u.auth, "/water", { clientLogId: randomUUID(), ml: 300, localDate: YESTERDAY });
    const h = await get(u.auth, "/water/history?days=3");
    expect(h.days.map((d: { totalMl: number }) => d.totalMl)).toEqual([0, 300, 2000]);
    expect(h).toMatchObject({ targetMl: 2000, averageMl: 1150, daysMetTarget: 1 });
  });
});

describe("targets with dietary context", () => {
  it("a diet-style change sets new macros from today; past days keep their targets", async () => {
    const clock = new TestClock(new Date(`${YESTERDAY}T12:00:00Z`));
    const u = await user({ clock, onboarded: true, onboardDate: YESTERDAY });
    const before = (await get(u.auth, `/nutrition/days/${YESTERDAY}`)).targets;
    clock.set(`${TODAY}T12:00:00Z`);
    await patch(u.auth, "/me/preferences", { dietaryPreferences: ["high_protein"] });
    const today = (await get(u.auth, `/nutrition/days/${TODAY}`)).targets;
    expect(today.proteinG).toBeGreaterThan(before.proteinG);
    expect(today.targetKcal).toBe(before.targetKcal); // styles shape macros, not calories
    expect(today.dietStyles).toEqual(["high_protein"]);
    expect((await get(u.auth, `/nutrition/days/${YESTERDAY}`)).targets).toEqual(before);
  });
});

describe("coach context", () => {
  it("receives nutrition aggregates and safety notes — never food names", async () => {
    let received: CoachContext | null = null;
    const providers: ProviderRegistry = {
      ...createUnconfiguredProviders(),
      ai: { kind: "ai", status: () => ({ state: "ready", provider: "test-ai" }), respond: async (r) => ((received = r.context), { ok: true as const, value: { message: "Keep going.", category: "general", priority: "normal", evidence: [{ fact: "training.workoutsLast7Days", claim: "Workouts this week" }], actions: [], confidence: "medium" } }) },
    };
    ({ app, ctx } = await makeApp({ providers, config: { coach: { ...testConfig.coach, provider: "anthropic" } } }));
    const u = await registerUser(app);
    await allow(app, u.auth, { aiCoach: true });
    await onboard(app, u.auth);
    await post(u.auth, "/nutrition/logs", fromFood("fdb:salmon_cooked", 150, "g"));
    await post(u.auth, "/coach/messages", { message: "What should I eat tonight?", clientMessageId: randomUUID(), today: TODAY });
    const facts = received!.facts;
    expect(facts).toMatchObject({ "nutrition.today.kcal": 309, "nutrition.today.entries": 1 });
    expect(facts["nutrition.targets.kcal"]).toBeGreaterThan(0);
    expect(received!.safety.notes.join(" ")).toMatch(/safe minimum/);
    expect(JSON.stringify(received)).not.toMatch(/salmon/i);
  });
});

describe("migration v9", () => {
  it("maps legacy food logs conservatively: only scale is measured, camera stays an estimate", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-mig9-"));
    try {
      const db = openDb(join(dir, "v8.db"), MIGRATIONS.slice(0, 8));
      db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', '2026-09-01T00:00:00Z')").run();
      db.prepare("INSERT INTO user_settings (user_id, timezone, updated_at) VALUES ('u1', 'America/New_York', '2026-09-01T00:00:00Z')").run();
      const ins = db.prepare(
        "INSERT INTO food_logs (id, user_id, local_date, name, grams, source, kcal, protein_g, carbs_g, fat_g, created_at) VALUES (?, 'u1', '2026-09-01', ?, ?, ?, 300, 10, 40, 8, ?)",
      );
      ins.run("a", "Oats", 80, "scale", "2026-09-01T12:00:00Z"); // 08:00 New York → breakfast
      ins.run("b", "Pasta", null, "camera_estimate", "2026-09-01T23:30:00Z"); // 19:30 → dinner
      ins.run("c", "Bar", null, "label", "2026-09-01T17:00:00Z"); // 13:00 → lunch
      ins.run("d", "Guess", null, "manual", "2026-09-02T03:00:00Z"); // 23:00 → snack
      expect(schemaVersion(db)).toBe(8);
      migrate(db);
      expect(schemaVersion(db)).toBe(MIGRATIONS.length);
      const rows = db.prepare("SELECT id, source, amount_method, meal_type, amount, client_log_id FROM food_logs ORDER BY id").all();
      expect(rows).toEqual([
        { id: "a", source: "manual", amount_method: "measured", meal_type: "breakfast", amount: 80, client_log_id: null },
        { id: "b", source: "scan_estimate", amount_method: "estimated", meal_type: "dinner", amount: null, client_log_id: null },
        { id: "c", source: "manual", amount_method: "label", meal_type: "lunch", amount: null, client_log_id: null },
        { id: "d", source: "manual", amount_method: "estimated", meal_type: "snack", amount: null, client_log_id: null },
      ]);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
