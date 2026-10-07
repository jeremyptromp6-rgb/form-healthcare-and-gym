import { MEAL_TYPES, SERVING_STEPS } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { addCustomItem, addRecipeToGroceries, clearChecked, deleteItem, groceryList, setChecked } from "./grocery";
import { can, proRequired, requireFeature } from "../billing/entitlements";
import { restOfToday } from "./service";
import { addMeal, alternatives, createPlan, currentPlan, deletePlan, getPlan, getRecipe, listRecipes, markEaten, removeMeal, repeatDay, saveRecipe, unmarkEaten, updateMeal } from "./service";

const id = z.string().min(1).max(64);
const uuid = z.string().uuid();
const servings = z.number().refine((n) => (SERVING_STEPS as readonly number[]).includes(n), { message: `servings must be one of ${SERVING_STEPS.join(", ")}` });
const aisle = z.enum(["protein", "carbohydrates", "produce", "other"]);

/** Recipes, meal plans and the grocery list. Every query is scoped to the caller. */
export function mealRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- Recipes -----------------------------------------------------------------------------
  app.get("/recipes", async (req) => {
    const q = z.object({ slot: z.enum(MEAL_TYPES).optional(), q: z.string().max(60).optional(), saved: z.enum(["true", "false"]).transform((v) => v === "true").optional() }).parse(req.query);
    return { recipes: listRecipes(ctx.db, req.user.sub, userClock(ctx, req.user.sub).today, q) };
  });

  app.get("/recipes/:id", async (req) => {
    const p = z.object({ id }).parse(req.params);
    return { recipe: getRecipe(ctx.db, req.user.sub, userClock(ctx, req.user.sub).today, p.id) };
  });

  app.put("/recipes/:id/saved", async (req, reply) => {
    saveRecipe(ctx, req.user.sub, z.object({ id }).parse(req.params).id, true);
    return reply.status(204).send();
  });

  app.delete("/recipes/:id/saved", async (req, reply) => {
    saveRecipe(ctx, req.user.sub, z.object({ id }).parse(req.params).id, false);
    return reply.status(204).send();
  });

  // ---- Plans -------------------------------------------------------------------------------
  app.post("/meal-plans", async (req, reply) => {
    const body = z.object({ clientPlanId: uuid, startDate: dateKey.optional(), days: z.union([z.literal(1), z.literal(7)]) }).strict().parse(req.body);
    const advanced = can(ctx, req.user.sub, "MEAL_PLANNER_ADVANCED");
    if (body.days > 1 && !advanced) throw proRequired("MEAL_PLANNER_ADVANCED", "Week-long meal plans are part of FORM Pro. One-day plans are free.");
    const result = createPlan(ctx, req.user.sub, { ...body, preferSaved: advanced }, userClock(ctx, req.user.sub));
    return reply.status(result.created ? 201 : 200).send({ duplicate: !result.created, plan: result.plan });
  });

  /** FORM Pro: meals for the rest of today, sized to what's left of today's targets. Suggestions only — nothing is replaced. */
  app.get("/meal-plans/rest-of-today", async (req) => {
    requireFeature(ctx, req.user.sub, "MEAL_PLANNER_ADVANCED", "Planning the rest of your day is part of FORM Pro.");
    return { suggestion: restOfToday(ctx, req.user.sub, userClock(ctx, req.user.sub)) };
  });

  app.get("/meal-plans/current", async (req) => ({ plan: currentPlan(ctx, req.user.sub, userClock(ctx, req.user.sub)) }));

  app.get("/meal-plans/:planId", async (req) => {
    const { planId } = z.object({ planId: uuid }).parse(req.params);
    return { plan: getPlan(ctx, req.user.sub, planId, userClock(ctx, req.user.sub)) };
  });

  app.delete("/meal-plans/:planId", async (req, reply) => {
    const { planId } = z.object({ planId: uuid }).parse(req.params);
    deletePlan(ctx, req.user.sub, planId, userClock(ctx, req.user.sub));
    return reply.status(204).send();
  });

  app.post("/meal-plans/:planId/meals", async (req, reply) => {
    const { planId } = z.object({ planId: uuid }).parse(req.params);
    const body = z.object({ date: dateKey, slot: z.enum(MEAL_TYPES), recipeId: id, servings }).strict().parse(req.body);
    return reply.status(201).send({ plan: addMeal(ctx, req.user.sub, planId, body, userClock(ctx, req.user.sub)) });
  });

  app.patch("/meal-plans/:planId/meals/:mealId", async (req) => {
    const p = z.object({ planId: uuid, mealId: uuid }).parse(req.params);
    const body = z.object({ servings: servings.optional(), recipeId: id.optional() }).strict().refine((b) => b.servings !== undefined || b.recipeId !== undefined, { message: "Change the servings or the recipe" }).parse(req.body);
    return { plan: updateMeal(ctx, req.user.sub, p.planId, p.mealId, body, userClock(ctx, req.user.sub)) };
  });

  app.delete("/meal-plans/:planId/meals/:mealId", async (req) => {
    const p = z.object({ planId: uuid, mealId: uuid }).parse(req.params);
    return { plan: removeMeal(ctx, req.user.sub, p.planId, p.mealId, userClock(ctx, req.user.sub)) };
  });

  app.get("/meal-plans/:planId/meals/:mealId/alternatives", async (req) => {
    const p = z.object({ planId: uuid, mealId: uuid }).parse(req.params);
    return { alternatives: alternatives(ctx, req.user.sub, p.planId, p.mealId, userClock(ctx, req.user.sub)) };
  });

  app.post("/meal-plans/:planId/meals/:mealId/eaten", async (req) => {
    const p = z.object({ planId: uuid, mealId: uuid }).parse(req.params);
    const body = z.object({ clientLogId: uuid }).strict().parse(req.body);
    return { plan: markEaten(ctx, req.user.sub, p.planId, p.mealId, body.clientLogId, userClock(ctx, req.user.sub)) };
  });

  app.delete("/meal-plans/:planId/meals/:mealId/eaten", async (req) => {
    const p = z.object({ planId: uuid, mealId: uuid }).parse(req.params);
    return { plan: unmarkEaten(ctx, req.user.sub, p.planId, p.mealId, userClock(ctx, req.user.sub)) };
  });

  app.post("/meal-plans/:planId/days/:date/repeat", async (req) => {
    const p = z.object({ planId: uuid, date: dateKey }).parse(req.params);
    const body = z.object({ toDates: z.array(dateKey).min(1).max(6) }).strict().parse(req.body);
    return { plan: repeatDay(ctx, req.user.sub, p.planId, p.date, body.toDates, userClock(ctx, req.user.sub)) };
  });

  // ---- Grocery -----------------------------------------------------------------------------
  app.get("/grocery", async (req) => ({ list: groceryList(ctx.db, req.user.sub) }));

  app.post("/grocery/items", async (req, reply) => {
    const body = z.object({ clientItemId: uuid, name: z.string().max(200), quantity: z.string().max(100).nullish(), aisle: aisle.nullish() }).strict().parse(req.body);
    const result = addCustomItem(ctx, req.user.sub, body);
    return reply.status(result.created ? 201 : 200).send({ list: result.list });
  });

  app.post("/grocery/recipes/:id", async (req) => {
    const p = z.object({ id }).parse(req.params);
    const body = z.object({ servings: z.number().positive().max(20) }).strict().parse(req.body);
    return { list: addRecipeToGroceries(ctx, req.user.sub, p.id, body.servings) };
  });

  app.patch("/grocery/items/:itemId", async (req) => {
    const p = z.object({ itemId: uuid }).parse(req.params);
    const body = z.object({ checked: z.boolean() }).strict().parse(req.body);
    return { list: setChecked(ctx, req.user.sub, p.itemId, body.checked) };
  });

  app.delete("/grocery/items/:itemId", async (req) => {
    const p = z.object({ itemId: uuid }).parse(req.params);
    return { list: deleteItem(ctx, req.user.sub, p.itemId) };
  });

  app.post("/grocery/clear-checked", async (req) => ({ list: clearChecked(ctx, req.user.sub) }));
}
