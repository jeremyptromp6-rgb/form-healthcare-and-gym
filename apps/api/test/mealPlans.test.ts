import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { libraryRecipe } from "@form/domain";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../src/shared/context";
import { makeApp, onboard, registerUser, type TestClock, TODAY, YESTERDAY, grantPro } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const req = async (auth: Auth, method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, payload?: object) => app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

async function user(opts: { clock?: TestClock; onboarded?: boolean } = { onboarded: true }) {
  ({ app, ctx } = await makeApp({ clock: opts.clock }));
  const u = await registerUser(app);
  grantPro(ctx, u.id); // week plans are FORM Pro (Free one-day plans: proR.test.ts)
  if (opts.onboarded !== false) await onboard(app, u.auth); // vegetarian, peanut allergy, custom "kiwi", dislikes olives
  return u;
}

async function newPlan(auth: Auth, days: 1 | 7 = 7, extra: object = {}) {
  const res = await req(auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().plan;
}

interface MealV {
  id: string;
  date: string;
  slot: string;
  recipeId: string;
  servings: number;
  status: string;
  canMarkEaten: boolean;
  nutrients: { kcal: number; proteinG: number };
}

describe("recipes", () => {
  it("lists only recipes safe for the user, with nutrition, fit and allergens", async () => {
    const u = await user();
    const res = await req(u.auth, "GET", "/recipes");
    expect(res.statusCode).toBe(200);
    const recipes = res.json().recipes as { id: string; allergens: string[]; suitableFor: string[]; perServing: { kcal: number }; fit: { verdict: string } }[];
    expect(recipes.length).toBeGreaterThan(10);
    for (const r of recipes) {
      expect(r.allergens).not.toContain("peanuts");
      expect(r.suitableFor).toContain("vegetarian");
      expect(r.fit.verdict).toBe("ok");
      expect(r.perServing.kcal).toBeGreaterThan(0);
    }
    expect(recipes.find((r) => r.id === "chicken_quinoa_bowl")).toBeUndefined();
    const breakfasts = (await req(u.auth, "GET", "/recipes?slot=breakfast")).json().recipes as { slots: string[] }[];
    expect(breakfasts.every((r) => r.slots.includes("breakfast"))).toBe(true);
  });

  it("a recipe opened directly says when it doesn't fit; unknown recipes are 404", async () => {
    const u = await user();
    const chicken = (await req(u.auth, "GET", "/recipes/chicken_quinoa_bowl")).json().recipe;
    expect(chicken.fit.verdict).toBe("excluded");
    expect(chicken.ingredients[0]).toMatchObject({ foodId: "fdb:chicken_breast_cooked", amount: 300, unit: "g", aisle: "protein" });
    expect((await req(u.auth, "GET", "/recipes/nope")).statusCode).toBe(404);
  });

  it("saving is a per-user bookmark", async () => {
    const u = await user();
    expect((await req(u.auth, "PUT", "/recipes/red_lentil_soup/saved")).statusCode).toBe(204);
    expect((await req(u.auth, "PUT", "/recipes/red_lentil_soup/saved")).statusCode).toBe(204); // idempotent
    expect((await req(u.auth, "GET", "/recipes?saved=true")).json().recipes.map((r: { id: string }) => r.id)).toEqual(["red_lentil_soup"]);
    expect((await req(u.auth, "GET", "/recipes/red_lentil_soup")).json().recipe.saved).toBe(true);
    const other = await registerUser(app);
    expect((await req(other.auth, "GET", "/recipes/red_lentil_soup")).json().recipe.saved).toBe(false);
    await req(u.auth, "DELETE", "/recipes/red_lentil_soup/saved");
    expect((await req(u.auth, "GET", "/recipes?saved=true")).json().recipes).toEqual([]);
  });
});

describe("meal plan generation", () => {
  it("creates a week of safe meals that respects targets and the safe floor, idempotently", async () => {
    const u = await user();
    const body = { clientPlanId: randomUUID(), days: 7 };
    const res = await req(u.auth, "POST", "/meal-plans", body);
    expect(res.statusCode).toBe(201);
    const plan = res.json().plan;
    expect(plan.dates).toHaveLength(7);
    expect(plan.dates[0]).toBe(TODAY);
    for (const m of plan.meals as MealV[]) {
      const r = libraryRecipe(m.recipeId)!;
      expect(r.allergens).not.toContain("peanuts");
      expect(r.suitableFor).toContain("vegetarian");
      expect(m.status).toBe("planned"); // planned is never eaten
    }
    for (const d of plan.dates as string[]) expect(plan.totalsByDate[d].planned.kcal).toBeGreaterThanOrEqual(plan.targets.safeFloorKcal);
    expect(plan.totalsByDate[TODAY].eaten.kcal).toBe(0);
    const again = await req(u.auth, "POST", "/meal-plans", body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true, plan: { id: plan.id } });
    expect((await req(u.auth, "GET", "/meal-plans/current")).json().plan.id).toBe(plan.id);
  });

  it("needs targets first — no plan without a body profile", async () => {
    const u = await user({ onboarded: false });
    const res = await req(u.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("targets_required");
    expect((await req(u.auth, "GET", "/meal-plans/current")).json().plan).toBeNull();
  });

  it("a new plan replaces the one it overlaps; dates are validated", async () => {
    const u = await user();
    const first = await newPlan(u.auth, 7);
    const daily = await newPlan(u.auth, 1);
    expect((await req(u.auth, "GET", `/meal-plans/${first.id}`)).json().plan.status).toBe("archived");
    expect((await req(u.auth, "GET", "/meal-plans/current")).json().plan.id).toBe(daily.id);
    expect((await req(u.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 1, startDate: YESTERDAY })).statusCode).toBe(422);
    expect((await req(u.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 3 })).statusCode).toBe(400);
  });
});

describe("editing a plan", () => {
  it("swaps a meal for a close, safe alternative and changes servings", async () => {
    const u = await user();
    const plan = await newPlan(u.auth, 1);
    const dinner = (plan.meals as MealV[]).find((m) => m.slot === "dinner")!;
    const alts = (await req(u.auth, "GET", `/meal-plans/${plan.id}/meals/${dinner.id}/alternatives`)).json().alternatives as { recipeId: string; servings: number; nutrients: { kcal: number } }[];
    expect(alts.length).toBeGreaterThan(0);
    for (const a of alts) {
      expect(a.recipeId).not.toBe(dinner.recipeId);
      expect(libraryRecipe(a.recipeId)!.suitableFor).toContain("vegetarian");
    }
    const swapped = await req(u.auth, "PATCH", `/meal-plans/${plan.id}/meals/${dinner.id}`, { recipeId: alts[0]!.recipeId, servings: alts[0]!.servings });
    expect(swapped.statusCode).toBe(200);
    expect((swapped.json().plan.meals as MealV[]).find((m) => m.id === dinner.id)).toMatchObject({ recipeId: alts[0]!.recipeId, servings: alts[0]!.servings });
    // Hard rules hold on edits too.
    const unsafe = await req(u.auth, "PATCH", `/meal-plans/${plan.id}/meals/${dinner.id}`, { recipeId: "salmon_potato_broccoli" });
    expect(unsafe.statusCode).toBe(422);
    expect(unsafe.json().error.code).toBe("recipe_not_suitable");
    expect((await req(u.auth, "PATCH", `/meal-plans/${plan.id}/meals/${dinner.id}`, { servings: 0.3 })).statusCode).toBe(400);
  });

  it("adds, removes and repeats meals", async () => {
    const u = await user();
    const plan = await newPlan(u.auth, 7);
    const [d0, d1, d2] = plan.dates as [string, string, string];
    const added = (await req(u.auth, "POST", `/meal-plans/${plan.id}/meals`, { date: d0, slot: "snack", recipeId: "banana_almonds", servings: 1 })).json().plan;
    const snacks = (added.meals as MealV[]).filter((m) => m.date === d0 && m.slot === "snack");
    expect(snacks.some((m) => m.recipeId === "banana_almonds")).toBe(true);
    const removed = (await req(u.auth, "DELETE", `/meal-plans/${plan.id}/meals/${snacks.find((m) => m.recipeId === "banana_almonds")!.id}`)).json().plan;
    expect((removed.meals as MealV[]).filter((m) => m.date === d0)).toHaveLength((plan.meals as MealV[]).filter((m) => m.date === d0).length);
    const repeated = (await req(u.auth, "POST", `/meal-plans/${plan.id}/days/${d0}/repeat`, { toDates: [d1, d2] })).json().plan;
    const recipesOn = (d: string) => (repeated.meals as MealV[]).filter((m) => m.date === d).map((m) => `${m.slot}:${m.recipeId}:${m.servings}`);
    expect(recipesOn(d1)).toEqual(recipesOn(d0));
    expect(recipesOn(d2)).toEqual(recipesOn(d0));
    expect((await req(u.auth, "POST", `/meal-plans/${plan.id}/meals`, { date: "2030-01-01", slot: "snack", recipeId: "banana_almonds", servings: 1 })).statusCode).toBe(422);
  });
});

describe("planned vs eaten", () => {
  it("marking a meal eaten logs it once as a recipe entry; unmarking removes it", async () => {
    const u = await user();
    const plan = await newPlan(u.auth, 7);
    const breakfast = (plan.meals as MealV[]).find((m) => m.date === TODAY && m.slot === "breakfast")!;
    // Nothing is eaten just because it was planned.
    expect((await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs).toHaveLength(0);
    const body = { clientLogId: randomUUID() };
    const eaten = await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${breakfast.id}/eaten`, body);
    expect(eaten.statusCode).toBe(200);
    const meal = (eaten.json().plan.meals as MealV[]).find((m) => m.id === breakfast.id)!;
    expect(meal.status).toBe("eaten");
    await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${breakfast.id}/eaten`, body); // retry
    await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${breakfast.id}/eaten`, { clientLogId: randomUUID() }); // double tap
    const day = (await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json();
    expect(day.logs).toHaveLength(1);
    expect(day.logs[0]).toMatchObject({ source: "recipe", amountMethod: "estimated", isEstimate: true, mealType: "breakfast", name: libraryRecipe(breakfast.recipeId)!.title, unit: "serving", quantity: breakfast.servings });
    expect(day.logs[0].kcal).toBe(breakfast.nutrients.kcal);
    expect(eaten.json().plan.totalsByDate[TODAY].eaten.kcal).toBe(breakfast.nutrients.kcal);
    // A future meal can't be eaten yet.
    const future = (plan.meals as MealV[]).find((m) => m.date > TODAY)!;
    expect(future.canMarkEaten).toBe(false);
    expect((await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${future.id}/eaten`, { clientLogId: randomUUID() })).json().error.code).toBe("not_yet");
    // An eaten meal can't be swapped until it's unmarked.
    expect((await req(u.auth, "PATCH", `/meal-plans/${plan.id}/meals/${breakfast.id}`, { servings: 2 })).statusCode).toBe(409);
    const undone = await req(u.auth, "DELETE", `/meal-plans/${plan.id}/meals/${breakfast.id}/eaten`);
    expect((undone.json().plan.meals as MealV[]).find((m) => m.id === breakfast.id)!.status).toBe("planned");
    expect((await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs).toHaveLength(0);
  });

  it("deleting the logged entry from Eat makes the meal planned again", async () => {
    const u = await user();
    const plan = await newPlan(u.auth, 1);
    const lunch = (plan.meals as MealV[]).find((m) => m.slot === "lunch")!;
    await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${lunch.id}/eaten`, { clientLogId: randomUUID() });
    const logId = (await req(u.auth, "GET", `/nutrition/days/${TODAY}`)).json().logs[0].id;
    await req(u.auth, "DELETE", `/nutrition/logs/${logId}`);
    const now = (await req(u.auth, "GET", `/meal-plans/${plan.id}`)).json().plan;
    expect((now.meals as MealV[]).find((m) => m.id === lunch.id)!.status).toBe("planned");
  });
});

describe("grocery list", () => {
  it("is generated from the plan, aggregated and grouped, and follows plan changes", async () => {
    const u = await user();
    const plan = await newPlan(u.auth, 7);
    const list = (await req(u.auth, "GET", "/grocery")).json().list;
    expect(list.sections.map((s: { aisle: string }) => s.aisle)).toEqual(expect.arrayContaining(["produce"]));
    const all = list.sections.flatMap((s: { items: unknown[] }) => s.items) as { id: string; foodId: string; unit: string; amount: number; amountText: string; source: string; checked: boolean }[];
    const keys = all.map((i) => `${i.foodId}|${i.unit}`);
    expect(new Set(keys).size).toBe(keys.length); // one row per food + unit
    expect(all.every((i) => i.source === "plan" && /\d/.test(i.amountText))).toBe(true);
    // Tick an item, then remove the plan: plan items go, nothing else is touched.
    const first = all[0]!;
    const ticked = (await req(u.auth, "PATCH", `/grocery/items/${first.id}`, { checked: true })).json().list;
    expect(ticked.remaining).toBe(ticked.total - 1);
    await req(u.auth, "POST", "/grocery/items", { clientItemId: randomUUID(), name: "Coffee filters", quantity: "1 pack" });
    // Eating a meal takes its ingredients off what's left to buy.
    const today = (plan.meals as MealV[]).filter((m) => m.date === TODAY);
    for (const m of today) await req(u.auth, "POST", `/meal-plans/${plan.id}/meals/${m.id}/eaten`, { clientLogId: randomUUID() });
    const afterEating = (await req(u.auth, "GET", "/grocery")).json().list;
    const sum = (l: typeof list) => (l.sections.flatMap((s: { items: unknown[] }) => s.items) as typeof all).filter((i) => i.source === "plan").reduce((a, i) => a + i.amount, 0);
    expect(sum(afterEating)).toBeLessThan(sum(list));
    await req(u.auth, "DELETE", `/meal-plans/${plan.id}`);
    const after = (await req(u.auth, "GET", "/grocery")).json().list;
    expect(after.total).toBe(1);
    expect(after.sections[0].items[0]).toMatchObject({ name: "Coffee filters", amountText: "1 pack", source: "custom", aisle: "other" });
  });

  it("keeps a tick through plan changes unless more is now needed", async () => {
    const u = await user();
    const plan = await newPlan(u.auth, 1);
    const items = () => req(u.auth, "GET", "/grocery").then((r) => r.json().list.sections.flatMap((s: { items: unknown[] }) => s.items) as { id: string; foodId: string; amount: number; checked: boolean }[]);
    const snack = (plan.meals as MealV[]).find((m) => m.slot === "snack")!;
    const snackFoods = libraryRecipe(snack.recipeId)!.ingredients.map((i) => i.foodId);
    const target = (await items()).find((i) => snackFoods.includes(i.foodId))!;
    await req(u.auth, "PATCH", `/grocery/items/${target.id}`, { checked: true });
    // Change something unrelated: the tick survives.
    const breakfast = (plan.meals as MealV[]).find((m) => m.slot === "breakfast")!;
    await req(u.auth, "PATCH", `/meal-plans/${plan.id}/meals/${breakfast.id}`, { servings: breakfast.servings === 1 ? 1.25 : 1 });
    expect((await items()).find((i) => i.foodId === target.foodId)!.checked).toBe(true);
    // Need more of it: unticked.
    await req(u.auth, "PATCH", `/meal-plans/${plan.id}/meals/${snack.id}`, { servings: 2.5 });
    const now = (await items()).find((i) => i.foodId === target.foodId)!;
    expect(now.amount).toBeGreaterThan(target.amount);
    expect(now.checked).toBe(false);
  });

  it("adds a recipe's ingredients (merged), custom items (idempotent), and clears ticked ones", async () => {
    const u = await user();
    let list = (await req(u.auth, "POST", "/grocery/recipes/red_lentil_soup", { servings: 2 })).json().list;
    list = (await req(u.auth, "POST", "/grocery/recipes/red_lentil_soup", { servings: 2 })).json().list;
    const lentils = list.sections.flatMap((s: { items: unknown[] }) => s.items).find((i: { foodId: string }) => i.foodId === "fdb:lentils_cooked");
    expect(lentils).toMatchObject({ amount: 600, amountText: "600 g", source: "recipe", aisle: "protein" });
    const body = { clientItemId: randomUUID(), name: "Dish soap" };
    expect((await req(u.auth, "POST", "/grocery/items", body)).statusCode).toBe(201);
    expect((await req(u.auth, "POST", "/grocery/items", body)).statusCode).toBe(200);
    list = (await req(u.auth, "GET", "/grocery")).json().list;
    const soap = list.sections.flatMap((s: { items: unknown[] }) => s.items).filter((i: { name: string }) => i.name === "Dish soap");
    expect(soap).toHaveLength(1);
    await req(u.auth, "PATCH", `/grocery/items/${soap[0].id}`, { checked: true });
    list = (await req(u.auth, "POST", "/grocery/clear-checked")).json().list;
    expect(list.sections.flatMap((s: { items: unknown[] }) => s.items).some((i: { name: string }) => i.name === "Dish soap")).toBe(false);
    expect((await req(u.auth, "POST", "/grocery/items", { clientItemId: randomUUID(), name: "   " })).statusCode).toBe(422);
  });
});

describe("security", () => {
  it("plans, meals and grocery items are private", async () => {
    const a = await user();
    const plan = await newPlan(a.auth, 1);
    const meal = (plan.meals as MealV[])[0]!;
    const b = await registerUser(app);
    expect((await req(b.auth, "GET", `/meal-plans/${plan.id}`)).statusCode).toBe(404);
    expect((await req(b.auth, "PATCH", `/meal-plans/${plan.id}/meals/${meal.id}`, { servings: 2 })).statusCode).toBe(404);
    expect((await req(b.auth, "POST", `/meal-plans/${plan.id}/meals/${meal.id}/eaten`, { clientLogId: randomUUID() })).statusCode).toBe(404);
    expect((await req(b.auth, "DELETE", `/meal-plans/${plan.id}`)).statusCode).toBe(404);
    const item = (await req(a.auth, "GET", "/grocery")).json().list.sections[0].items[0];
    expect((await req(b.auth, "PATCH", `/grocery/items/${item.id}`, { checked: true })).statusCode).toBe(404);
    expect((await req(b.auth, "GET", "/grocery")).json().list.total).toBe(0);
    expect((await app.inject({ method: "GET", url: "/meal-plans/current" })).statusCode).toBe(401);
    expect((await req(a.auth, "POST", "/meal-plans", { clientPlanId: randomUUID(), days: 1, targets: { kcal: 800 } })).statusCode).toBe(400);
  });
});

describe("feature flags", () => {
  it("meal planning, recipes and grocery are live", async () => {
    const u = await user();
    const features = (await req(u.auth, "GET", "/system/features")).json().features;
    for (const key of ["meal_planner", "recipes", "grocery"]) expect(features[key]).toMatchObject({ available: true });
  });
});
