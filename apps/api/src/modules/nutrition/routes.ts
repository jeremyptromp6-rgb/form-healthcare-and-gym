import { AMOUNT_METHODS, FOOD_UNITS, MEAL_TYPES, MEASURE_UNITS, SEARCH_LIMITS, searchFoods, USER_FOOD_LIMITS, VERIFIED_FOODS, addDays } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { createLog, createMeal, createUserFood, deleteLog, deleteUserFood, findFood, listUserFoods, MEAL_LIMITS, nutritionDay, recentFoods, updateLog } from "./service";

const macro = { kcal: z.number().min(0).max(10_000), proteinG: z.number().min(0).max(1_000), carbsG: z.number().min(0).max(2_000), fatG: z.number().min(0).max(1_000) };
const measureUnit = z.enum(MEASURE_UNITS);
const quantity = z.number().positive().max(1000);
const weightSource = z.enum(["typed", "scale"]);
const foodPortion = z.object({ foodId: z.string().min(1).max(64), quantity, unit: z.enum(FOOD_UNITS), servingId: z.string().max(16).nullish() }).strict();

// No source, kcal or protein for catalog foods: the server computes them from the food and the
// portion. .strict() rejects anything else a client might try to assert.
const logSchema = z
  .object({
    clientLogId: z.string().uuid(),
    localDate: dateKey.optional(),
    mealType: z.enum(MEAL_TYPES).optional(),
    amountMethod: z.enum(AMOUNT_METHODS),
    weightSource: weightSource.optional(),
    food: foodPortion.optional(),
    manual: z
      .object({ name: z.string().trim().min(1).max(120), brand: z.string().trim().max(60).nullish(), ...macro, quantity: quantity.nullish(), unit: measureUnit.nullish() })
      .strict()
      .optional(),
    replacesLogId: z.string().uuid().optional(),
    // Scans are logged through /nutrition/scans (review → confirm); this shape is refused with a pointer there.
    scan: z.unknown().optional(),
  })
  .strict()
  .refine((b) => [b.food, b.manual, b.scan].filter((x) => x !== undefined).length === 1, { message: "Send exactly one of food, manual or scan" });

const patchSchema = z
  .object({
    mealType: z.enum(MEAL_TYPES),
    localDate: dateKey,
    amountMethod: z.enum(AMOUNT_METHODS),
    weightSource,
    quantity,
    unit: z.enum(FOOD_UNITS),
    servingId: z.string().max(16).nullable(),
    name: z.string().trim().min(1).max(120),
    ...macro,
  })
  .partial()
  .strict();

const userFoodSchema = z
  .object({
    clientFoodId: z.string().uuid(),
    name: z.string().trim().min(1).max(USER_FOOD_LIMITS.nameLength),
    brand: z.string().trim().max(USER_FOOD_LIMITS.brandLength).nullish(),
    basis: z.enum(["g", "ml"]),
    servingLabel: z.string().trim().max(USER_FOOD_LIMITS.servingLabelLength).default(""),
    servingAmount: z.number().positive().max(USER_FOOD_LIMITS.maxServingAmount),
    perServing: z.object(macro).strict(),
  })
  .strict();

// A meal of several ingredients, each a catalog/user food portion (manual numbers aren't ingredients).
const mealSchema = z
  .object({
    clientMealId: z.string().uuid(),
    localDate: dateKey.optional(),
    mealType: z.enum(MEAL_TYPES).optional(),
    mealName: z.string().trim().max(MEAL_LIMITS.nameLength).nullish(),
    items: z
      .array(z.object({ food: foodPortion, amountMethod: z.enum(AMOUNT_METHODS), weightSource: weightSource.optional(), replacesLogId: z.string().uuid().optional() }).strict())
      .min(1)
      .max(MEAL_LIMITS.maxItems),
  })
  .strict();

const foodId = z.object({ id: z.string().min(1).max(64) });

/** Food search, user foods, food logs and the nutrition day. Every query is scoped to the caller. */
export function nutritionRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ---- Foods -------------------------------------------------------------------------

  app.get("/foods/search", async (req) => {
    const { q, limit } = z
      .object({ q: z.string().max(SEARCH_LIMITS.maxQueryLength), limit: z.coerce.number().int().min(1).max(SEARCH_LIMITS.maxResults).default(SEARCH_LIMITS.defaultResults) })
      .parse(req.query);
    return { query: q, foods: searchFoods([...listUserFoods(ctx.db, req.user.sub), ...VERIFIED_FOODS], q, limit) };
  });

  app.get("/foods/recent", async (req) => ({ recent: recentFoods(ctx.db, req.user.sub) }));

  app.get("/foods/mine", async (req) => ({ foods: listUserFoods(ctx.db, req.user.sub) }));

  app.get("/foods/:id", async (req) => {
    const { id } = foodId.parse(req.params);
    const food = findFood(ctx.db, req.user.sub, id);
    if (!food) throw new HttpError(404, "not_found", "Food not found");
    return { food };
  });

  app.post("/foods", async (req, reply) => {
    const body = userFoodSchema.parse(req.body);
    const { clientFoodId, ...input } = body;
    const result = createUserFood(ctx, req.user.sub, clientFoodId, input);
    return reply.status(result.created ? 201 : 200).send({ food: result.food });
  });

  app.delete("/foods/:id", async (req, reply) => {
    const { id } = foodId.parse(req.params);
    deleteUserFood(ctx, req.user.sub, id);
    return reply.status(204).send();
  });

  // ---- Logs --------------------------------------------------------------------------

  app.post("/nutrition/logs", async (req, reply) => {
    const body = logSchema.parse(req.body);
    if (body.scan !== undefined) {
      throw new HttpError(422, "use_scan_flow", "Scanned food is logged by confirming a scan (POST /nutrition/scans, then confirm).");
    }
    const clock = userClock(ctx, req.user.sub);
    const { scan: _scan, ...input } = body;
    const result = createLog(ctx, req.user.sub, input, clock);
    return reply.status(result.created ? 201 : 200).send({ duplicate: !result.created, log: result.log });
  });

  app.post("/nutrition/meals", async (req, reply) => {
    const body = mealSchema.parse(req.body);
    const result = createMeal(ctx, req.user.sub, body, userClock(ctx, req.user.sub));
    const { created, ...meal } = result;
    return reply.status(created ? 201 : 200).send({ duplicate: !created, meal });
  });

  app.patch("/nutrition/logs/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const patch = patchSchema.parse(req.body);
    return { log: updateLog(ctx, req.user.sub, id, patch, userClock(ctx, req.user.sub)) };
  });

  app.delete("/nutrition/logs/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    deleteLog(ctx, req.user.sub, id);
    return reply.status(204).send();
  });

  // ---- Days --------------------------------------------------------------------------

  app.get("/nutrition/days/:date", async (req) => {
    const { date } = z.object({ date: dateKey }).parse(req.params);
    const { today } = z.object({ today: dateKey.optional() }).parse(req.query);
    const clock = userClock(ctx, req.user.sub, today);
    if (date > addDays(clock.today, 1)) throw new HttpError(422, "date_out_of_range", "That day hasn't happened yet");
    return nutritionDay(ctx, req.user.sub, date, clock.today);
  });
}
