import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate, openDb, schemaVersion } from "../src/db";
import { MIGRATIONS } from "../src/db/migrations";
import type { AppContext } from "../src/shared/context";
import { makeApp, registerUser, TestClock, testConfig, TODAY, YESTERDAY } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth, payload });
const patch = (auth: Auth, url: string, payload: object) => app.inject({ method: "PATCH", url, headers: auth, payload });
const del = (auth: Auth, url: string) => app.inject({ method: "DELETE", url, headers: auth });

async function user(opts: { clock?: TestClock; scans?: boolean } = {}) {
  ({ app, ctx } = await makeApp({
    clock: opts.clock,
    config: opts.scans ? { foodRecognition: { ...testConfig.foodRecognition, provider: "development" } } : {},
  }));
  return registerUser(app);
}

const log = (food: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  clientLogId: randomUUID(),
  localDate: TODAY,
  mealType: "lunch",
  amountMethod: "measured",
  food,
  ...extra,
});

const day = (auth: Auth, date = TODAY) => get(auth, `/nutrition/days/${date}`);
const row = (id: string) => ctx.db.prepare("SELECT * FROM food_logs WHERE id = ?").get(id) as Record<string, unknown>;

/** A confirmed development scan: chicken + white rice estimates (greens removed). */
async function scanEstimates(auth: Auth, localDate = TODAY) {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0xff, 0xd9]).toString("base64");
  const scan = (await post(auth, "/nutrition/scans", { clientScanId: randomUUID(), image: { mimeType: "image/jpeg", data: jpeg } })).json().scan;
  const res = await post(auth, `/nutrition/scans/${scan.id}/confirm`, {
    confirmKey: randomUUID(),
    localDate,
    mealType: "dinner",
    mealName: "Chicken plate",
    items: [{ itemId: "i1" }, { itemId: "i2" }, { itemId: "i3", remove: true }],
  });
  expect(res.statusCode).toBe(201);
  const [chicken, rice] = res.json().scan.logs as { id: string; name: string; amount: number }[];
  return { scanId: scan.id as string, chicken: chicken!, rice: rice! };
}

describe("measured food: units, calculation, provenance", () => {
  it("logs a weighed food in ounces: stored exact, shown rounded, clearly measured, with full provenance", async () => {
    const u = await user();
    const res = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:chicken_breast_cooked", quantity: 5, unit: "oz" }));
    expect(res.statusCode).toBe(201);
    const l = res.json().log;
    expect(l).toMatchObject({
      source: "verified_database",
      amountMethod: "measured",
      isEstimate: false,
      quantity: 5,
      unit: "oz",
      amount: 141.7,
      amountUnit: "g",
      kcal: 234,
      proteinG: 43.9,
      measurement: { via: "mass", grams: 141.7, densityGPerMl: null, weightSource: "typed" },
      basis: { per100: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 }, unit: "g", calcVersion: 1 },
    });
    const stored = row(l.id);
    expect(stored.kcal).toBeCloseTo(233.8836, 3); // full precision in storage
    expect(stored.amount).toBeCloseTo(141.747615625, 9);
  });

  it("kg and lb normalise gram-first", async () => {
    const u = await user();
    const kg = (await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_white_cooked", quantity: 0.25, unit: "kg" }))).json().log;
    expect(kg).toMatchObject({ amount: 250, kcal: 325, measurement: { grams: 250 } });
    const lb = (await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_white_cooked", quantity: 1, unit: "lb" }))).json().log;
    expect(lb).toMatchObject({ amount: 453.6, kcal: 590 });
  });

  it("cups and spoons of a solid convert through the reference density — never as a measurement", async () => {
    const u = await user();
    const cup = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_white_cooked", quantity: 1, unit: "cup" }, { amountMethod: "label" }));
    expect(cup.statusCode).toBe(201);
    expect(cup.json().log).toMatchObject({ amount: 158, kcal: 205, measurement: { via: "density", grams: 158 } });
    expect(cup.json().log.measurement.densityGPerMl).toBeCloseTo(158 / 236.5882365, 9);
    const measuredCup = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_white_cooked", quantity: 1, unit: "cup" }));
    expect(measuredCup.statusCode).toBe(422);
    expect(measuredCup.json().error.message).toMatch(/converted volume/);
    const noDensity = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:chicken_breast_cooked", quantity: 1, unit: "cup" }, { amountMethod: "estimated" }));
    expect(noDensity.statusCode).toBe(422);
  });

  it("drinks: litres and cups are direct volumes (measurable); weighing milk in grams is a measurement too", async () => {
    const u = await user();
    const litre = (await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:milk_whole", quantity: 0.5, unit: "l" }))).json().log;
    expect(litre).toMatchObject({ amount: 500, amountUnit: "ml", kcal: 320, amountMethod: "measured", measurement: { via: "volume", grams: 515 } });
    const weighed = (await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:milk_whole", quantity: 257.5, unit: "g" }))).json().log;
    expect(weighed).toMatchObject({ amount: 250, amountUnit: "ml", kcal: 160, amountMethod: "measured", measurement: { via: "mass", grams: 257.5, densityGPerMl: 1.03 } });
  });

  it("pieces, items and servings count the food's own servings; measured never applies to a count", async () => {
    const u = await user();
    const bananas = (await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:banana", quantity: 2, unit: "piece", servingId: "s1" }, { amountMethod: "label" }))).json().log;
    expect(bananas).toMatchObject({ unit: "piece", amount: 236, kcal: 210, servingLabel: "1 medium (118 g)", measurement: { via: "count" } });
    const can = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:tuna_canned_water", quantity: 1, unit: "item", servingId: "s1" }, { amountMethod: "label" }));
    expect(can.json().log).toMatchObject({ unit: "item", amount: 142 });
    expect((await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:banana", quantity: 1, unit: "item", servingId: "s1" }, { amountMethod: "label" }))).statusCode).toBe(422);
    expect((await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:banana", quantity: 1, unit: "piece", servingId: "s1" }))).statusCode).toBe(422); // measured piece
  });

  it("day totals are the rounded sum of exact values", async () => {
    const u = await user();
    // 130 ml black coffee = 1.3 kcal: each entry shows 1, three of them total 3.9 → 4.
    for (let i = 0; i < 3; i++) await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:coffee_black", quantity: 130, unit: "ml" }));
    const d = await day(u.auth);
    expect(d.logs.map((l: { kcal: number }) => l.kcal)).toEqual([1, 1, 1]);
    expect(d.totals.kcal).toBe(4);
    expect(d.totals.measuredKcalShare).toBe(1);
  });

  it("manual entries accept every weight/volume unit and keep typed numbers as typed", async () => {
    const u = await user();
    const res = await post(u.auth, "/nutrition/logs", {
      clientLogId: randomUUID(),
      localDate: TODAY,
      amountMethod: "measured",
      manual: { name: "Homemade stew", kcal: 412.5, proteinG: 30.25, carbsG: 20, fatG: 22, quantity: 0.4, unit: "kg" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().log).toMatchObject({ kcal: 413, proteinG: 30.3, amount: 400, amountUnit: "g", measurement: { via: "mass", grams: 400 }, basis: null });
    expect(row(res.json().log.id).kcal).toBe(412.5);
  });
});

describe("edit and delete", () => {
  it("re-weighing recomputes from the logged snapshot; switching to a count needs a non-measured method", async () => {
    const u = await user();
    const l = (await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:chicken_breast_cooked", quantity: 150, unit: "g" }, { weightSource: "scale" }))).json().log;
    expect(l.measurement.weightSource).toBe("scale");
    const edited = await patch(u.auth, `/nutrition/logs/${l.id}`, { quantity: 0.2, unit: "kg" });
    expect(edited.statusCode).toBe(200);
    // A new typed amount no longer came from the scale.
    expect(edited.json().log).toMatchObject({ amount: 200, kcal: 330, amountMethod: "measured", measurement: { via: "mass", weightSource: "typed" } });
    const meal = await patch(u.auth, `/nutrition/logs/${l.id}`, { mealType: "dinner" });
    expect(meal.json().log.measurement.weightSource).toBe("typed");
    expect((await patch(u.auth, `/nutrition/logs/${l.id}`, { unit: "piece", servingId: "s1", quantity: 1 })).statusCode).toBe(422);
    const counted = await patch(u.auth, `/nutrition/logs/${l.id}`, { unit: "piece", servingId: "s1", quantity: 1, amountMethod: "label" });
    expect(counted.json().log).toMatchObject({ unit: "piece", amount: 172, amountMethod: "label", measurement: { via: "count", weightSource: null } });
    expect((await del(u.auth, `/nutrition/logs/${l.id}`)).statusCode).toBe(204);
    expect((await day(u.auth)).totals.kcal).toBe(0);
  });

  it("a weight source only belongs to a measurement", async () => {
    const u = await user();
    expect((await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:banana", quantity: 100, unit: "g" }, { amountMethod: "estimated", weightSource: "scale" }))).statusCode).toBe(422);
    expect((await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:banana", quantity: 100, unit: "g" }, { weightSource: "bluetooth" }))).statusCode).toBe(400);
  });
});

describe("scanner estimate → weighed entry supersedes it", () => {
  it("the measured entry replaces the estimate on its day and in its meal, keeping a snapshot of what it replaced", async () => {
    const clock = new TestClock();
    const u = await user({ scans: true, clock });
    const { scanId, chicken, rice } = await scanEstimates(u.auth, YESTERDAY);
    const body = { clientLogId: randomUUID(), amountMethod: "measured", food: { foodId: "fdb:chicken_breast_cooked", quantity: 142, unit: "g" }, replacesLogId: chicken.id };
    const res = await post(u.auth, "/nutrition/logs", body);
    expect(res.statusCode).toBe(201);
    expect(res.json().log).toMatchObject({
      localDate: YESTERDAY, // the estimate's day, not today
      mealType: "dinner",
      mealId: scanId,
      mealName: "Chicken plate",
      amountMethod: "measured",
      isEstimate: false,
      replacedLogId: chicken.id,
      replacedEstimate: { id: chicken.id, name: chicken.name, amount: 150, amountUnit: "g", scanId },
    });
    const d = await day(u.auth, YESTERDAY);
    // Never both: the estimate is gone, the rice estimate is untouched.
    expect(d.logs.map((l: { name: string; amountMethod: string }) => [l.name, l.amountMethod])).toEqual([
      [rice.name, "estimated"],
      ["Chicken breast, skinless, cooked", "measured"],
    ]);
    // Retrying the same request is idempotent; replacing again is a conflict.
    const retry = await post(u.auth, "/nutrition/logs", body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ duplicate: true, log: { id: res.json().log.id } });
    const again = await post(u.auth, "/nutrition/logs", { ...body, clientLogId: randomUUID() });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("already_replaced");
  });

  it("the user can choose a different food; an estimate never supersedes an estimate; measurements are never replaced", async () => {
    const u = await user({ scans: true });
    const { rice, chicken } = await scanEstimates(u.auth);
    const estimated = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_brown_cooked", quantity: 150, unit: "g" }, { amountMethod: "estimated", replacesLogId: rice.id }));
    expect(estimated.statusCode).toBe(422);
    expect(estimated.json().error.code).toBe("replacement_not_better");
    const brown = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_brown_cooked", quantity: 163, unit: "g" }, { replacesLogId: rice.id }));
    expect(brown.json().log).toMatchObject({ name: "Rice, brown, cooked", replacedEstimate: { name: rice.name } });
    // A label amount also outranks an estimate.
    const label = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:chicken_breast_cooked", quantity: 1, unit: "piece", servingId: "s1" }, { amountMethod: "label", replacesLogId: chicken.id }));
    expect(label.statusCode).toBe(201);
    const onMeasured = await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:banana", quantity: 100, unit: "g" }, { replacesLogId: brown.json().log.id }));
    expect(onMeasured.statusCode).toBe(422);
    expect(onMeasured.json().error.code).toBe("not_replaceable");
  });

  it("keeping both is the user's explicit choice: without replacesLogId nothing is superseded", async () => {
    const u = await user({ scans: true });
    await scanEstimates(u.auth);
    await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:chicken_breast_cooked", quantity: 90, unit: "g" }));
    expect((await day(u.auth)).logs).toHaveLength(3);
  });

  it("two different replacements of one estimate at once: exactly one wins", async () => {
    const u = await user({ scans: true });
    const { chicken } = await scanEstimates(u.auth);
    const results = await Promise.all([0, 1].map(() => post(u.auth, "/nutrition/logs", log({ foodId: "fdb:chicken_breast_cooked", quantity: 140, unit: "g" }, { replacesLogId: chicken.id }))));
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect((await day(u.auth)).logs.filter((l: { amountMethod: string }) => l.amountMethod === "measured")).toHaveLength(1);
  });
});

describe("meals of several weighed ingredients", () => {
  const items = [
    { food: { foodId: "fdb:chicken_breast_cooked", quantity: 172.4, unit: "g" }, amountMethod: "measured", weightSource: "scale" },
    { food: { foodId: "fdb:rice_white_cooked", quantity: 1.5, unit: "cup" }, amountMethod: "label" },
    { food: { foodId: "fdb:olive_oil", quantity: 1, unit: "tbsp" }, amountMethod: "label" },
  ];

  it("logs all ingredients atomically, once, with a meal total from exact values", async () => {
    const u = await user();
    const body = { clientMealId: randomUUID(), localDate: TODAY, mealType: "dinner", mealName: "Chicken rice bowl", items };
    const res = await post(u.auth, "/nutrition/meals", body);
    expect(res.statusCode).toBe(201);
    const meal = res.json().meal;
    expect(meal.logs).toHaveLength(3);
    expect(meal.totals).toMatchObject({ kcal: 712, entries: 3 });
    expect(new Set(meal.logs.map((l: { mealId: string }) => l.mealId))).toEqual(new Set([meal.mealId]));
    expect(meal.logs[0]).toMatchObject({ mealName: "Chicken rice bowl", amountMethod: "measured", measurement: { weightSource: "scale" } });
    const retry = await post(u.auth, "/nutrition/meals", body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ duplicate: true, meal: { mealId: meal.mealId } });
    const d = await day(u.auth);
    expect(d.logs).toHaveLength(3);
    expect(d.byMeal.dinner.kcal).toBe(712);
  });

  it("one bad ingredient logs nothing", async () => {
    const u = await user();
    const res = await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [...items, { food: { foodId: "fdb:nope", quantity: 1, unit: "g" }, amountMethod: "measured" }] });
    expect(res.statusCode).toBe(404);
    const bad = await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [items[0], { food: { foodId: "fdb:rice_white_cooked", quantity: 1, unit: "cup" }, amountMethod: "measured" }] });
    expect(bad.statusCode).toBe(422);
    expect((await day(u.auth)).logs).toHaveLength(0);
    expect((await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [] })).statusCode).toBe(400);
    expect((await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: Array(21).fill(items[0]) })).statusCode).toBe(400);
  });

  it("weighing a scanned plate: each ingredient supersedes its estimate", async () => {
    const u = await user({ scans: true });
    const { scanId, chicken, rice } = await scanEstimates(u.auth);
    const res = await post(u.auth, "/nutrition/meals", {
      clientMealId: randomUUID(),
      items: [
        { ...items[0], replacesLogId: chicken.id },
        { food: { foodId: "fdb:rice_white_cooked", quantity: 171, unit: "g" }, amountMethod: "measured", replacesLogId: rice.id },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().meal).toMatchObject({ mealName: "Chicken plate" });
    const d = await day(u.auth);
    expect(d.logs.every((l: { amountMethod: string; source: string }) => l.amountMethod === "measured" && l.source !== "scan_estimate")).toBe(true);
    expect(d.logs.map((l: { replacedEstimate: { scanId: string } }) => l.replacedEstimate.scanId)).toEqual([scanId, scanId]);
    expect(d.logs[0].mealType).toBe("dinner");
    const dup = await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [{ ...items[0], replacesLogId: chicken.id }] });
    expect(dup.statusCode).toBe(409);
  });

  it("the same estimate can't be replaced twice within one meal", async () => {
    const u = await user({ scans: true });
    const { chicken } = await scanEstimates(u.auth);
    const res = await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [{ ...items[0], replacesLogId: chicken.id }, { ...items[0], replacesLogId: chicken.id }] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("duplicate_replacement");
  });
});

describe("timezone and security", () => {
  it("entries and meals count toward the user's local day and meal", async () => {
    const u = await user(); // NOW = 2026-09-27T12:00Z → Auckland 2026-09-28 01:00
    await patch(u.auth, "/me/settings", { timezone: "Pacific/Auckland" });
    const one = (await post(u.auth, "/nutrition/logs", { clientLogId: randomUUID(), amountMethod: "measured", food: { foodId: "fdb:banana", quantity: 120, unit: "g" } })).json().log;
    expect(one).toMatchObject({ localDate: "2026-09-28", mealType: "snack" });
    const meal = (await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [{ food: { foodId: "fdb:banana", quantity: 120, unit: "g" }, amountMethod: "measured" }] })).json().meal;
    expect(meal.logs[0]).toMatchObject({ localDate: "2026-09-28", mealType: "snack" });
    // "Tomorrow" in Auckland is out of range; yesterday in UTC is still loggable.
    expect((await post(u.auth, "/nutrition/meals", { clientMealId: randomUUID(), localDate: "2026-09-29", items: [{ food: { foodId: "fdb:banana", quantity: 1, unit: "g" }, amountMethod: "measured" }] })).statusCode).toBe(422);
  });

  it("another user's foods and estimates are invisible; clients can't assert nutrition", async () => {
    const a = await user({ scans: true });
    const b = await registerUser(app);
    const { chicken } = await scanEstimates(a.auth);
    const mine = (await post(a.auth, "/foods", { clientFoodId: randomUUID(), name: "A's bar", basis: "g", servingAmount: 50, perServing: { kcal: 200, proteinG: 10, carbsG: 20, fatG: 8 } })).json().food;
    expect((await post(b.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [{ food: { foodId: mine.id, quantity: 50, unit: "g" }, amountMethod: "measured" }] })).statusCode).toBe(404);
    expect((await post(b.auth, "/nutrition/logs", log({ foodId: "fdb:chicken_breast_cooked", quantity: 150, unit: "g" }, { replacesLogId: chicken.id }))).statusCode).toBe(404);
    expect((await post(b.auth, "/nutrition/meals", { clientMealId: randomUUID(), items: [{ food: { foodId: "fdb:banana", quantity: 1, unit: "g", kcal: 1 }, amountMethod: "measured" }] })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/nutrition/meals", payload: { clientMealId: randomUUID(), items: [] } })).statusCode).toBe(401);
    expect((await day(a.auth)).logs).toHaveLength(2); // A's estimates untouched
  });

  it("Home shows how much of today is measured", async () => {
    const u = await user();
    await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_white_cooked", quantity: 200, unit: "g" }));
    await post(u.auth, "/nutrition/logs", log({ foodId: "fdb:rice_white_cooked", quantity: 200, unit: "g" }, { amountMethod: "estimated" }));
    const home = await get(u.auth, `/home?today=${TODAY}`);
    expect(home.nutrition).toMatchObject({ kcal: 520, measuredKcalShare: 0.5, estimatedKcalShare: 0.5 });
  });
});

describe("migration v11", () => {
  it("keeps legacy logs and fills in their provenance conservatively", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-mig11-"));
    try {
      const db = openDb(join(dir, "v10.db"), MIGRATIONS.slice(0, 10));
      db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@example.com', 'x', '2026-09-01T00:00:00Z')").run();
      const ins = db.prepare(
        `INSERT INTO food_logs (id, user_id, local_date, meal_type, logged_at, name, source, amount_method, quantity, unit, amount, amount_unit, kcal, protein_g, carbs_g, fat_g, scan_id, created_at, updated_at)
         VALUES (?, 'u1', '2026-09-20', 'lunch', '2026-09-20T12:00:00Z', ?, ?, ?, ?, ?, ?, ?, 200, 10, 20, 5, ?, '2026-09-20T12:00:00Z', '2026-09-20T12:00:00Z')`,
      );
      ins.run("a", "Oats", "verified_database", "measured", 80, "g", 80, "g", null);
      ins.run("b", "Milk", "verified_database", "label", 8, "fl_oz", 236.6, "ml", null);
      ins.run("c", "Banana", "verified_database", "label", 1, "serving", 118, "g", null);
      ins.run("d", "Chicken", "scan_estimate", "estimated", 150, "g", 150, "g", "scan1");
      ins.run("e", "Guess", "manual", "estimated", null, null, null, null, null);
      expect(schemaVersion(db)).toBe(10);
      migrate(db);
      expect(schemaVersion(db)).toBe(MIGRATIONS.length);
      const rows = db.prepare("SELECT id, amount_via, grams, weight_source, meal_id, calc_version, kcal FROM food_logs ORDER BY id").all();
      expect(rows).toEqual([
        { id: "a", amount_via: "mass", grams: 80, weight_source: "typed", meal_id: null, calc_version: null, kcal: 200 },
        { id: "b", amount_via: "volume", grams: null, weight_source: null, meal_id: null, calc_version: null, kcal: 200 },
        { id: "c", amount_via: "count", grams: 118, weight_source: null, meal_id: null, calc_version: null, kcal: 200 },
        { id: "d", amount_via: "mass", grams: 150, weight_source: null, meal_id: "scan1", calc_version: null, kcal: 200 },
        { id: "e", amount_via: null, grams: null, weight_source: null, meal_id: null, calc_version: null, kcal: 200 },
      ]);
      // The new constraints hold: a count can't be measured.
      expect(() =>
        db
          .prepare(
            `INSERT INTO food_logs (id, user_id, local_date, meal_type, logged_at, name, source, amount_method, quantity, unit, amount, amount_unit, amount_via, kcal, protein_g, carbs_g, fat_g, created_at, updated_at)
             VALUES ('x', 'u1', '2026-09-20', 'lunch', 'z', 'X', 'verified_database', 'measured', 1, 'piece', 100, 'g', 'count', 1, 0, 0, 0, 'z', 'z')`,
          )
          .run(),
      ).toThrow(/CHECK/);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
