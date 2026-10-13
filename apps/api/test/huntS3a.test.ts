import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { ALLERGENS, libraryRecipe, RECIPE_LIBRARY } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { stripJpegMetadata } from "../src/modules/users/photo";
import { loadPreferences, writePreferences } from "../src/modules/users/repo";
import type { AppContext } from "../src/shared/context";
import { foodLog, grantPro, makeApp, onboard, registerUser, TODAY, YESTERDAY } from "./helpers";

/** Bug-hunt batch S3a: meal-plan allergy safety, markEaten keys, day caps, last weight, photo metadata. */

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const req = (auth: Auth, method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, payload?: object) => app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

interface MealV {
  id: string;
  date: string;
  slot: string;
  recipeId: string;
  servings: number;
  status: string;
  canMarkEaten: boolean;
  unsafe: boolean;
  unsafeReason: string | null;
  foodLogId: string | null;
  nutrients: { kcal: number; proteinG: number };
}

async function user() {
  ({ app, ctx } = await makeApp());
  const u = await registerUser(app);
  grantPro(ctx, u.id);
  await onboard(app, u.auth); // vegetarian, peanut allergy, custom "kiwi", dislikes olives
  return u;
}

async function newPlan(auth: Auth, days: 1 | 7 = 1) {
  const res = await req(auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days });
  expect(res.statusCode).toBe(201);
  return res.json().plan;
}

const getPlan = async (auth: Auth, id: string) => (await req(auth, "GET", `/meal-plans/${id}`)).json().plan;
const groceryFoodIds = async (auth: Auth): Promise<string[]> =>
  ((await req(auth, "GET", "/grocery")).json().list.sections as { items: { foodId: string | null }[] }[]).flatMap((s) => s.items.map((i) => i.foodId ?? "")).sort();
const setPrefs = (auth: Auth, payload: object) => req(auth, "PATCH", "/me/preferences", payload);

/** Recipes the user can currently be offered, with the allergens each carries. */
async function offered(auth: Auth) {
  const recipes = (await req(auth, "GET", "/recipes")).json().recipes as { id: string }[];
  return recipes.map((r) => libraryRecipe(r.id)!);
}

/** A recipe carrying `allergen` that the (vegetarian, peanut-free) user is offered today, plus one ingredient no meal in the plan shares. */
async function recipeWith(auth: Auth, allergen: string, plan: { meals: MealV[] }, needUnique = true) {
  const inPlan = new Set(plan.meals.flatMap((m) => libraryRecipe(m.recipeId)!.ingredients.map((i) => i.foodId)));
  for (const r of await offered(auth)) {
    if (!r.allergens.includes(allergen as never)) continue;
    const unique = r.ingredients.find((i) => !inPlan.has(i.foodId)) ?? (needUnique ? undefined : r.ingredients[0]);
    if (unique) return { recipe: r, uniqueFoodId: unique.foodId };
  }
  throw new Error(`no ${allergen} recipe with a unique ingredient available`);
}

async function addToToday(auth: Auth, planId: string, recipe: { id: string; slots: readonly string[] }) {
  const res = await req(auth, "POST", `/meal-plans/${planId}/meals`, { date: TODAY, slot: recipe.slots[0], recipeId: recipe.id, servings: 1 });
  expect(res.statusCode).toBe(201);
  const meals = res.json().plan.meals as MealV[];
  return meals.find((m) => m.recipeId === recipe.id && m.date === TODAY)!;
}

describe("A1-07: plans follow allergies and diet added after they were made", () => {
  it("flags the now-unsafe meal, blocks marking it eaten, removes its groceries and excludes it from totals", async () => {
    const u = await user();
    const plan = await newPlan(u.auth);
    const { recipe, uniqueFoodId } = await recipeWith(u.auth, "eggs", plan);
    const meal = await addToToday(u.auth, plan.id, recipe);
    expect(meal).toMatchObject({ unsafe: false, unsafeReason: null, canMarkEaten: true });
    expect(await groceryFoodIds(u.auth)).toContain(uniqueFoodId);

    expect((await setPrefs(u.auth, { allergens: ["peanuts", "eggs"] })).statusCode).toBe(200);

    const after = await getPlan(u.auth, plan.id);
    const meals = after.meals as MealV[];
    for (const m of meals) {
      const hasEggs = libraryRecipe(m.recipeId)!.allergens.includes("eggs");
      expect(m.unsafe).toBe(hasEggs);
      if (hasEggs) {
        expect(m.canMarkEaten).toBe(false);
        expect(m.unsafeReason).toBe("Contains eggs — on your allergy list");
      } else {
        expect(m.unsafeReason).toBeNull();
      }
    }
    // The grocery list no longer asks for anything only the egg meal needed.
    expect(await groceryFoodIds(u.auth)).not.toContain(uniqueFoodId);
    // Planned totals count only meals the user can still eat.
    const safeKcal = meals.filter((m) => !m.unsafe).reduce((a, m) => a + m.nutrients.kcal, 0);
    expect(Math.abs(after.totalsByDate[TODAY].planned.kcal - safeKcal)).toBeLessThanOrEqual(meals.length);
    // Marking it eaten is refused with a clear code, and nothing is logged.
    const eat = await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${meal.id}/eaten`, { clientLogId: randomUUID() });
    expect(eat.statusCode).toBe(422);
    expect(eat.json().error.code).toBe("meal_unsuitable");
    expect((await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs).toHaveLength(0);
    // The existing alternatives are safe, and swapping the meal clears the flag.
    const alts = (await req(u.auth, "GET", `/meal-plans/${plan.id}/meals/${meal.id}/alternatives`)).json().alternatives as { recipeId: string; servings: number }[];
    expect(alts.length).toBeGreaterThan(0);
    for (const a of alts) expect(libraryRecipe(a.recipeId)!.allergens).not.toContain("eggs");
    const swapped = await req(u.auth, "PATCH", `/meal-plans/${plan.id}/meals/${meal.id}`, { recipeId: alts[0]!.recipeId, servings: alts[0]!.servings });
    expect(swapped.statusCode).toBe(200);
    expect((swapped.json().plan.meals as MealV[]).find((m) => m.id === meal.id)).toMatchObject({ unsafe: false, canMarkEaten: true });
  });

  it("a plan that is still safe is unaffected by a change that doesn't touch it", async () => {
    const u = await user();
    const plan = await newPlan(u.auth);
    const used = new Set((plan.meals as MealV[]).flatMap((m) => libraryRecipe(m.recipeId)!.allergens as string[]));
    const harmless = ALLERGENS.map((a) => a.key as string).find((k) => !used.has(k) && k !== "peanuts")!;
    const groceriesBefore = await groceryFoodIds(u.auth);
    expect((await setPrefs(u.auth, { allergens: ["peanuts", harmless] })).statusCode).toBe(200);
    const after = await getPlan(u.auth, plan.id);
    expect(after.meals).toEqual(plan.meals);
    expect(after.totalsByDate).toEqual(plan.totalsByDate);
    expect((after.meals as MealV[]).every((m) => !m.unsafe && m.unsafeReason === null)).toBe(true);
    expect(await groceryFoodIds(u.auth)).toEqual(groceriesBefore);
    // …and its meals can still be eaten.
    const first = (after.meals as MealV[]).find((m) => m.canMarkEaten)!;
    expect((await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${first.id}/eaten`, { clientLogId: randomUUID() })).statusCode).toBe(200);
  });

  it("a diet change (vegan) flags meals that no longer fit it", async () => {
    const u = await user();
    const plan = await newPlan(u.auth);
    const notVegan = (await offered(u.auth)).find((r) => !r.suitableFor.includes("vegan"))!;
    const meal = await addToToday(u.auth, plan.id, notVegan);
    expect((await setPrefs(u.auth, { dietaryPreferences: ["vegan"] })).statusCode).toBe(200);
    const after = (await getPlan(u.auth, plan.id)).meals as MealV[];
    expect(after.find((m) => m.id === meal.id)).toMatchObject({ unsafe: true, unsafeReason: "Doesn't fit your diet", canMarkEaten: false });
    for (const m of after) expect(m.unsafe).toBe(!libraryRecipe(m.recipeId)!.suitableFor.includes("vegan"));
    const eat = await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${meal.id}/eaten`, { clientLogId: randomUUID() });
    expect(eat.json().error.code).toBe("meal_unsuitable");
  });

  it("re-checks on read: preferences written without the hook still flag meals and block eating", async () => {
    const u = await user();
    const plan = await newPlan(u.auth);
    const { recipe } = await recipeWith(u.auth, "eggs", plan);
    const meal = await addToToday(u.auth, plan.id, recipe);
    const prefs = loadPreferences(ctx.db, u.id)!;
    writePreferences(ctx.db, u.id, { ...prefs, allergens: [...prefs.allergens, "eggs"] }, new Date());
    const seen = (await getPlan(u.auth, plan.id)).meals as MealV[];
    expect(seen.find((m) => m.id === meal.id)).toMatchObject({ unsafe: true, canMarkEaten: false });
    const eat = await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${meal.id}/eaten`, { clientLogId: randomUUID() });
    expect(eat.statusCode).toBe(422);
    expect(eat.json().error.code).toBe("meal_unsuitable");
  });

  it("repeating a day never copies a now-unsafe meal onto other days", async () => {
    const u = await user();
    const plan = await newPlan(u.auth, 7);
    const { recipe } = await recipeWith(u.auth, "eggs", plan, false);
    const dates = plan.dates as string[];
    const added = await req(u.auth, "POST", `/meal-plans/${plan.id}/meals`, { date: dates[0], slot: recipe.slots[0], recipeId: recipe.id, servings: 1 });
    expect(added.statusCode).toBe(201);
    await setPrefs(u.auth, { allergens: ["peanuts", "eggs"] });
    const res = await req(u.auth, "POST", `/meal-plans/${plan.id}/days/${dates[0]}/repeat`, { toDates: [dates[1]] });
    if (res.statusCode === 200) {
      for (const m of (res.json().plan.meals as MealV[]).filter((x) => x.date === dates[1])) expect(libraryRecipe(m.recipeId)!.allergens).not.toContain("eggs");
    } else {
      expect(res.json().error.code).toBe("nothing_to_repeat");
    }
  });
});

describe("A1-19: markEaten idempotency", () => {
  it("a clientLogId that belongs to an unrelated log never attaches that log to the meal", async () => {
    const u = await user();
    const plan = await newPlan(u.auth);
    const [a, b] = (plan.meals as MealV[]).filter((m) => m.canMarkEaten);
    const unrelatedId = randomUUID();
    const unrelated = (await req(u.auth, "POST", "/nutrition/logs", foodLog({ clientLogId: unrelatedId, localDate: TODAY, name: "Biscuit", kcal: 100 }))).json().log;

    const first = await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${a!.id}/eaten`, { clientLogId: unrelatedId });
    expect(first.statusCode).toBe(200);
    const eatenA = (first.json().plan.meals as MealV[]).find((m) => m.id === a!.id)!;
    expect(eatenA.status).toBe("eaten");
    expect(eatenA.foodLogId).not.toBe(unrelated.id);
    // The same key on another meal makes its own log too (previously both meals shared one entry).
    const second = await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${b!.id}/eaten`, { clientLogId: unrelatedId });
    expect(second.statusCode).toBe(200);
    const eatenB = (second.json().plan.meals as MealV[]).find((m) => m.id === b!.id)!;
    expect(eatenB.foodLogId).not.toBe(eatenA.foodLogId);
    expect(eatenB.foodLogId).not.toBe(unrelated.id);
    const day = (await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json();
    expect(day.logs).toHaveLength(3);
    expect(day.logs.find((l: { id: string }) => l.id === unrelated.id).name).toBe("Biscuit");
  });

  it("a retry for the same meal stays idempotent, including after the log was deleted from Eat", async () => {
    const u = await user();
    const plan = await newPlan(u.auth);
    const meal = (plan.meals as MealV[]).find((m) => m.canMarkEaten)!;
    const body = { clientLogId: randomUUID() };
    const url = `/meal-plans/${plan.id}/meals/${meal.id}/eaten`;
    const first = await req(u.auth, "POST", url, body);
    const retry = await req(u.auth, "POST", url, body);
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect((retry.json().plan.meals as MealV[]).find((m) => m.id === meal.id)!.foodLogId).toBe((first.json().plan.meals as MealV[]).find((m) => m.id === meal.id)!.foodLogId);
    expect((await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs).toHaveLength(1);
    // Delete the entry from Eat, then tap again with the same key: a fresh log, never a 500.
    const logId = (await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs[0].id;
    await req(u.auth, "DELETE", `/nutrition/logs/${logId}`);
    const again = await req(u.auth, "POST", url, body);
    expect(again.statusCode).toBe(200);
    expect((await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs).toHaveLength(1);
  });
});

describe("A1-22: moving a log onto a full day", () => {
  it("applies the per-day cap to the target day", async () => {
    ({ app, ctx } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    for (let i = 0; i < 100; i++) {
      const r = await req(u.auth, "POST", "/nutrition/logs", foodLog({ localDate: YESTERDAY, name: `Item ${i}`, kcal: 10 }));
      expect(r.statusCode).toBe(201);
    }
    const today = (await req(u.auth, "POST", "/nutrition/logs", foodLog({ localDate: TODAY, name: "Mover", kcal: 10 }))).json().log;
    const moved = await req(u.auth, "PATCH", `/nutrition/logs/${today.id}`, { localDate: YESTERDAY });
    expect(moved.statusCode).toBe(422);
    expect(moved.json().error.code).toBe("too_many_logs");
    expect((await req(u.auth, "GET", `/nutrition/days/${YESTERDAY}`)).json().logs).toHaveLength(100);
    // Editing an entry that is already on the full day (same date) is fine.
    const onFull = (await req(u.auth, "GET", `/nutrition/days/${YESTERDAY}`)).json().logs[0];
    expect((await req(u.auth, "PATCH", `/nutrition/logs/${onFull.id}`, { localDate: YESTERDAY, mealType: "dinner" })).statusCode).toBe(200);
  });
});

describe("A1-20: deleting the last weight entry", () => {
  it("keeps the stated profile weight and targets, while the weight history is simply empty", async () => {
    ({ app, ctx } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    const me = async () => (await req(u.auth, "GET", "/me")).json();
    const before = await me();
    const entries = (await req(u.auth, "GET", "/me/weight")).json().entries as { localDate: string }[];
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect((await req(u.auth, "DELETE", `/me/weight/${e.localDate}`)).statusCode).toBe(204);
    expect((await req(u.auth, "GET", "/me/weight")).json().entries).toEqual([]);
    const after = await me();
    expect(after.profile.weightKg).toBe(before.profile.weightKg);
    expect(after.targets).toEqual(before.targets);
    // Logging a weight again takes over as the current weight.
    expect((await req(u.auth, "POST", "/me/weight", { localDate: TODAY, weightKg: 77.5 })).json().currentWeightKg).toBe(77.5);
    expect((await me()).profile.weightKg).toBe(77.5);
  });
});

// ---- A1-21: photo metadata ----------------------------------------------------------

const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const JFIF = seg(0xe0, Buffer.from("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00", "latin1"));

/** A little-endian EXIF block with Orientation, a GPS-ish pointer and a camera model string. */
function exif(orientation: number, big = false): Buffer {
  const w16 = (n: number) => (big ? Buffer.from([n >> 8, n & 0xff]) : Buffer.from([n & 0xff, n >> 8]));
  const w32 = (n: number) => (big ? Buffer.from([0, 0, n >> 8, n & 0xff]) : Buffer.from([n & 0xff, n >> 8, 0, 0]));
  const model = Buffer.from("iPhone 15 Pro GPS 51.5007N 0.1246W\0", "latin1");
  const entries = 3;
  const modelOffset = 8 + 2 + entries * 12 + 4;
  const ifd = Buffer.concat([
    w16(entries),
    w16(0x010f), w16(2), w32(model.length), w32(modelOffset), // Make/Model string
    w16(0x0112), w16(3), w32(1), Buffer.concat([w16(orientation), Buffer.alloc(2)]), // Orientation
    w16(0x8825), w16(4), w32(1), w32(0x1234), // GPS IFD pointer
    w32(0),
  ]);
  const tiff = Buffer.concat([Buffer.from(big ? "MM" : "II", "latin1"), w16(0x2a), w32(8), ifd, model]);
  return seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]));
}

/** The orientation of the first APP1 EXIF segment of a JPEG, found by walking its segments. */
function readOrientation(jpeg: Buffer): number | null {
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff && jpeg[i + 1] !== 0xda && jpeg[i + 1] !== 0xd9) {
    const len = jpeg.readUInt16BE(i + 2);
    if (jpeg[i + 1] === 0xe1 && jpeg.subarray(i + 4, i + 10).toString("latin1") === "Exif\0\0") {
      const tiff = jpeg.subarray(i + 10, i + 2 + len);
      const le = tiff.subarray(0, 2).toString("latin1") === "II";
      const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
      const ifd = le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
      for (let n = 0; n < u16(ifd); n++) if (u16(ifd + 2 + n * 12) === 0x0112) return u16(ifd + 2 + n * 12 + 8);
      return null;
    }
    i += 2 + len;
  }
  return null;
}

const SOS = seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]));
const ENTROPY = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56]); // includes a stuffed FF00 and a restart marker

describe("A1-21: profile photo metadata", () => {
  it("drops everything after EOI", () => {
    const image = Buffer.concat([SOI, JFIF, seg(0xdb, Buffer.from([0, 1])), SOS, ENTROPY, EOI]);
    const trailer = Buffer.from("TRAILING-SECRET-DATA PK\x03\x04 hidden payload", "latin1");
    const out = stripJpegMetadata(Buffer.concat([image, trailer]));
    expect(out.equals(image)).toBe(true);
    expect(out.toString("latin1")).not.toContain("SECRET");
    expect([out.at(-2), out.at(-1)]).toEqual([0xff, 0xd9]);
  });

  it("keeps a progressive JPEG's later scans, but not metadata slipped between them", () => {
    const scan2 = Buffer.concat([seg(0xc4, Buffer.from([0, 1, 2])), SOS, Buffer.from([0x77, 0x88])]);
    const sneaky = seg(0xe1, Buffer.from("Exif\0\0GPS-HIDDEN-BETWEEN-SCANS", "latin1"));
    const out = stripJpegMetadata(Buffer.concat([SOI, JFIF, SOS, ENTROPY, sneaky, scan2, EOI, Buffer.from("tail")]));
    expect(out.equals(Buffer.concat([SOI, JFIF, SOS, ENTROPY, scan2, EOI]))).toBe(true);
    expect(out.toString("latin1")).not.toContain("GPS-HIDDEN");
  });

  it.each([
    [6, false],
    [8, true],
    [3, false],
  ])("keeps orientation %i (big-endian: %s) but none of the other EXIF fields", (orientation, big) => {
    const input = Buffer.concat([SOI, JFIF, exif(orientation, big), seg(0xfe, Buffer.from("taken at home")), SOS, ENTROPY, EOI]);
    expect(readOrientation(input)).toBe(orientation);
    const out = stripJpegMetadata(input);
    expect(readOrientation(out)).toBe(orientation);
    const text = out.toString("latin1");
    expect(text).not.toMatch(/iPhone|GPS|51\.5007|taken at home/);
    // The only EXIF left is the minimal block: header + 1 entry (orientation) and no pointers to other IFDs.
    const at = out.indexOf(Buffer.from("Exif\0\0", "latin1"));
    expect(out.readUInt16BE(at - 2)).toBe(2 + 6 + 8 + 2 + 12 + 4);
    expect(out.readUInt16BE(at + 6 + 8)).toBe(1);
    // JFIF stays first, the image data is intact, and EOI still ends the file.
    expect(out.subarray(0, 2 + JFIF.length).equals(Buffer.concat([SOI, JFIF]))).toBe(true);
    expect(out.subarray(out.length - SOS.length - ENTROPY.length - 2).equals(Buffer.concat([SOS, ENTROPY, EOI]))).toBe(true);
  });

  it("writes no EXIF when there was none, or the orientation is the default", () => {
    expect(stripJpegMetadata(Buffer.concat([SOI, JFIF, SOS, ENTROPY, EOI])).includes(Buffer.from("Exif"))).toBe(false);
    expect(stripJpegMetadata(Buffer.concat([SOI, JFIF, exif(1), SOS, ENTROPY, EOI])).includes(Buffer.from("Exif"))).toBe(false);
  });

  it("ignores a malformed EXIF block instead of failing the upload", () => {
    const broken = seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0II", "latin1"), Buffer.from([0x2a, 0x00, 0xff, 0xff, 0xff, 0x7f, 0x05, 0x00])]));
    const out = stripJpegMetadata(Buffer.concat([SOI, broken, SOS, ENTROPY, EOI]));
    expect(out.equals(Buffer.concat([SOI, SOS, ENTROPY, EOI]))).toBe(true);
  });

  it("rejects a JPEG that never ends", () => {
    expect(() => stripJpegMetadata(Buffer.concat([SOI, JFIF, SOS, ENTROPY]))).toThrow();
  });

  it("applies through PUT /me/photo", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const input = Buffer.concat([SOI, JFIF, exif(6), SOS, ENTROPY, EOI, Buffer.from("APPENDED-DATA")]);
    const res = await req(u.auth, "PUT", "/me/photo", { mimeType: "image/jpeg", data: input.toString("base64") });
    expect(res.statusCode).toBe(200);
    const stored = Buffer.from((await req(u.auth, "GET", "/me/photo")).json().data, "base64");
    expect(stored.toString("latin1")).not.toMatch(/APPENDED|iPhone|GPS/);
    expect(readOrientation(stored)).toBe(6);
    expect([stored.at(-2), stored.at(-1)]).toEqual([0xff, 0xd9]);
  });
});
