import { randomUUID } from "node:crypto";
import {
  addDays,
  buildNutritionContext,
  buildUserFood,
  CALCULATION_VERSION,
  calculatePortion,
  canSupersede,
  defaultMealType,
  isEstimate,
  isMassUnit,
  manualMacros,
  NUTRITION_LIMITS,
  presentAmount,
  presentMacros,
  resolveAmountMethod,
  summarizeNutritionDay,
  sumDay,
  toBaseAmount,
  USER_FOOD_LIMITS,
  VERIFIED_FOOD_PREFIX,
  verifiedFood,
  type AmountBasis,
  type AmountMethod,
  type AmountVia,
  type FoodItem,
  type FoodSource,
  type FoodUnit,
  type Macros,
  type MealType,
  type MeasureUnit,
  type PortionFood,
  type ScanLogEntry,
  type UserFoodInput,
} from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { nutritionDayPreview, resettleIfSettled } from "../progression/service";
import { waterDay } from "../water/routes";
import { targetOn } from "./targets";

/**
 * Nutrition service — the one place food logs are created, edited, deleted and summarised.
 * Eat, Home and the coach context all read days through `nutritionDay`, so they can never
 * disagree. Macros for catalog foods are always computed here from the food and the portion,
 * with the domain NutritionCalculator, and stored at full precision; views round for display.
 */

// ---- Rows & views --------------------------------------------------------------------

interface LogRow {
  id: string;
  user_id: string;
  client_log_id: string | null;
  local_date: string;
  meal_type: MealType;
  logged_at: string;
  name: string;
  brand: string | null;
  food_id: string | null;
  source: FoodSource;
  amount_method: AmountMethod;
  quantity: number | null;
  unit: FoodUnit | null;
  serving_id: string | null;
  serving_label: string | null;
  amount: number | null;
  amount_unit: AmountBasis | null;
  amount_via: AmountVia | null;
  grams: number | null;
  density_g_per_ml: number | null;
  per100_kcal: number | null;
  per100_protein_g: number | null;
  per100_carbs_g: number | null;
  per100_fat_g: number | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calc_version: number | null;
  weight_source: WeightSource | null;
  scan_id: string | null;
  meal_id: string | null;
  meal_name: string | null;
  replaced_log_id: string | null;
  replaced_estimate: string | null;
  created_at: string;
  updated_at: string;
}

/** Where a measured weight came from: typed in by the user, or a stable reading from a connected scale. */
export type WeightSource = "typed" | "scale";

const per100Of = (r: LogRow): Macros | null =>
  r.per100_kcal === null ? null : { kcal: r.per100_kcal, proteinG: r.per100_protein_g!, carbsG: r.per100_carbs_g!, fatG: r.per100_fat_g! };

/** A log as the API shows it: full provenance, with numbers rounded for display (stored exact). */
export function logView(r: LogRow) {
  const shown = presentMacros({ kcal: r.kcal, proteinG: r.protein_g, carbsG: r.carbs_g, fatG: r.fat_g });
  const per100 = per100Of(r);
  return {
    id: r.id,
    clientLogId: r.client_log_id,
    localDate: r.local_date,
    mealType: r.meal_type,
    loggedAt: r.logged_at,
    name: r.name,
    brand: r.brand,
    foodId: r.food_id,
    source: r.source,
    amountMethod: r.amount_method,
    isEstimate: isEstimate({ source: r.source, amountMethod: r.amount_method }),
    quantity: r.quantity,
    unit: r.unit,
    servingId: r.serving_id,
    servingLabel: r.serving_label,
    amount: r.amount === null ? null : presentAmount(r.amount),
    amountUnit: r.amount_unit,
    ...shown,
    measurement: {
      /** How the amount was normalised: by weight, by volume, through a density, or by count. */
      via: r.amount_via,
      /** Gram-first weight, when known. */
      grams: r.grams === null ? null : presentAmount(r.grams),
      densityGPerMl: r.density_g_per_ml,
      /** For measured entries: typed from a scale's display, or read from a connected scale. */
      weightSource: r.weight_source,
    },
    /** What the numbers were calculated from: per 100 g/ml of the food as logged, and the engine version. */
    basis: per100 ? { per100, unit: r.amount_unit, calcVersion: r.calc_version } : null,
    scanId: r.scan_id,
    mealId: r.meal_id,
    mealName: r.meal_name,
    replacedLogId: r.replaced_log_id,
    replacedEstimate: r.replaced_estimate ? (JSON.parse(r.replaced_estimate) as ReplacedEstimate) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function ownLog(db: Db, userId: string, id: string): LogRow {
  const row = db.prepare("SELECT * FROM food_logs WHERE id = ? AND user_id = ?").get(id, userId) as LogRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "Log not found");
  return row;
}

function assertLoggableDate(date: string, today: string): void {
  if (date > today || date < addDays(today, -NUTRITION_LIMITS.maxBackdateDays)) {
    throw new HttpError(422, "date_out_of_range", `Food can be logged for today or up to ${NUTRITION_LIMITS.maxBackdateDays} days back`, { localDate: date });
  }
}

// ---- Foods ---------------------------------------------------------------------------

interface UserFoodRow {
  id: string;
  name: string;
  brand: string | null;
  basis: AmountBasis;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_label: string;
  serving_amount: number;
}

const userFoodItem = (r: UserFoodRow): FoodItem => ({
  id: r.id,
  name: r.name,
  brand: r.brand,
  basis: r.basis,
  per100: { kcal: r.kcal, proteinG: r.protein_g, carbsG: r.carbs_g, fatG: r.fat_g },
  servings: [{ id: "s1", label: r.serving_label, amount: r.serving_amount }],
  origin: "user_food",
});

/** A verified food, or one of the user's own (not deleted). Another user's food is "not found". */
export function findFood(db: Db, userId: string, id: string): FoodItem | null {
  if (id.startsWith(VERIFIED_FOOD_PREFIX)) return verifiedFood(id);
  const row = db.prepare("SELECT * FROM user_foods WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(id, userId) as UserFoodRow | undefined;
  return row ? userFoodItem(row) : null;
}

export function listUserFoods(db: Db, userId: string): FoodItem[] {
  return (db.prepare("SELECT * FROM user_foods WHERE user_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE").all(userId) as unknown as UserFoodRow[]).map(userFoodItem);
}

export function createUserFood(ctx: AppContext, userId: string, clientFoodId: string, input: UserFoodInput): { created: boolean; food: FoodItem } {
  const { db } = ctx;
  return transaction(db, () => {
    const existing = db.prepare("SELECT * FROM user_foods WHERE user_id = ? AND client_food_id = ?").get(userId, clientFoodId) as UserFoodRow | undefined;
    if (existing) return { created: false, food: userFoodItem(existing) };
    const count = (db.prepare("SELECT COUNT(*) AS n FROM user_foods WHERE user_id = ? AND deleted_at IS NULL").get(userId) as { n: number }).n;
    if (count >= USER_FOOD_LIMITS.maxFoods) throw new HttpError(422, "too_many_foods", `You can keep up to ${USER_FOOD_LIMITS.maxFoods} foods`);
    const food = buildUserFood(randomUUID(), input);
    const s = food.servings[0]!;
    db.prepare(
      `INSERT INTO user_foods (id, user_id, client_food_id, name, brand, basis, kcal, protein_g, carbs_g, fat_g, serving_label, serving_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(food.id, userId, clientFoodId, food.name, food.brand, food.basis, food.per100.kcal, food.per100.proteinG, food.per100.carbsG, food.per100.fatG, s.label, s.amount, ctx.now().toISOString());
    return { created: true, food };
  });
}

/** Soft delete: past logs keep their own nutrition snapshot, so history is unchanged. */
export function deleteUserFood(ctx: AppContext, userId: string, id: string): void {
  const r = ctx.db.prepare("UPDATE user_foods SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").run(ctx.now().toISOString(), id, userId);
  if (r.changes === 0) throw new HttpError(404, "not_found", "Food not found");
}

/** Foods the user logged recently (most recent first), with the portion they used last time. */
export function recentFoods(db: Db, userId: string, limit = 15) {
  const rows = db
    .prepare(
      `SELECT food_id, quantity, unit, serving_id, amount_method, meal_type, logged_at AS last, MAX(rowid) AS seq FROM food_logs
       WHERE user_id = ? AND food_id IS NOT NULL GROUP BY food_id ORDER BY MAX(rowid) DESC LIMIT ?`,
    )
    .all(userId, limit * 2) as { food_id: string; quantity: number; unit: FoodUnit; serving_id: string | null; amount_method: AmountMethod; meal_type: MealType; last: string }[];
  const out = [];
  for (const r of rows) {
    const food = findFood(db, userId, r.food_id);
    if (!food) continue; // deleted user food
    out.push({ food, last: { quantity: r.quantity, unit: r.unit, servingId: r.serving_id, amountMethod: r.amount_method, mealType: r.meal_type, loggedAt: r.last } });
    if (out.length === limit) break;
  }
  return out;
}

// ---- Day ------------------------------------------------------------------------------

export function dayLogs(db: Db, userId: string, date: string): LogRow[] {
  return db.prepare("SELECT * FROM food_logs WHERE user_id = ? AND local_date = ? ORDER BY logged_at, rowid").all(userId, date) as unknown as LogRow[];
}

const entryOf = (r: LogRow) => ({ kcal: r.kcal, proteinG: r.protein_g, carbsG: r.carbs_g, fatG: r.fat_g, mealType: r.meal_type, source: r.source, amountMethod: r.amount_method });

/** Totals per day for [from, to] — for the coach context and history. */
/** Totals per logged day (same math as the Eat tab), including the estimated/measured shares. */
export function nutritionDayTotals(db: Db, userId: string, from: string, to: string) {
  return dayTotalsBetween(db, userId, from, to).map((d) => ({ date: d.date, totals: sumDay(d.logs.map(entryOf)) }));
}

export function dayTotalsBetween(db: Db, userId: string, from: string, to: string) {
  const rows = db.prepare("SELECT * FROM food_logs WHERE user_id = ? AND local_date BETWEEN ? AND ?").all(userId, from, to) as unknown as LogRow[];
  const byDate = new Map<string, LogRow[]>();
  for (const r of rows) byDate.set(r.local_date, [...(byDate.get(r.local_date) ?? []), r]);
  return [...byDate.entries()].map(([date, logs]) => ({ date, logs }));
}

/**
 * Food-only totals for a day (no water) — Home's nutrition section uses this so a water failure
 * can't take nutrition down with it. Same summary code as the full day view.
 */
export function foodDaySummary(ctx: AppContext, userId: string, date: string) {
  const logs = dayLogs(ctx.db, userId, date);
  const target = targetOn(ctx.db, userId, date);
  const { water: _water, ...summary } = summarizeNutritionDay(logs.map(entryOf), target, { totalMl: 0, targetMl: 0 });
  return { logs, target, ...summary };
}

/** The authoritative view of one day: logs, totals by meal, targets, remaining, water, XP preview. */
export function nutritionDay(ctx: AppContext, userId: string, date: string, today: string) {
  const logs = dayLogs(ctx.db, userId, date);
  const target = targetOn(ctx.db, userId, date);
  const water = waterDay(ctx, userId, date);
  const summary = summarizeNutritionDay(logs.map(entryOf), target, { totalMl: water.totalMl, targetMl: water.targetMl });
  return {
    date,
    isToday: date === today,
    logs: logs.map(logView),
    totals: summary.totals,
    byMeal: summary.byMeal,
    progress: summary.progress,
    targets: target,
    water: { totalMl: water.totalMl, targetMl: water.targetMl, targetBasis: water.targetBasis, progress: summary.water, lastEntryId: water.entries.at(-1)?.id ?? null },
    xp: target ? nutritionDayPreview(ctx.db, userId, date, today) : null,
  };
}

/**
 * The nutrition context for the AI coach: aggregates for today and the last 7 days, targets and
 * water — no food names or raw logs (see domain buildNutritionContext).
 */
export function coachNutritionContext(ctx: AppContext, userId: string, today: string) {
  const days = dayTotalsBetween(ctx.db, userId, addDays(today, -6), today).map((d) => ({ date: d.date, totals: sumDay(d.logs.map(entryOf)) }));
  const water = waterDay(ctx, userId, today);
  return buildNutritionContext({ today, days, targets: targetOn(ctx.db, userId, today), water: { totalMl: water.totalMl, targetMl: water.targetMl } });
}

// ---- Log / edit / delete ---------------------------------------------------------------

/** What a superseded scan estimate said, kept on the entry that replaced it. */
export interface ReplacedEstimate {
  id: string;
  name: string;
  amount: number | null;
  amountUnit: AmountBasis | null;
  kcal: number;
  scanId: string | null;
  loggedAt: string;
}

export interface FoodPortionInput {
  foodId: string;
  quantity: number;
  unit: FoodUnit;
  servingId?: string | null;
}

export interface CreateLogInput {
  clientLogId: string;
  /** A scan estimate this entry supersedes (e.g. the same food, now weighed). Removed in the same transaction. */
  replacesLogId?: string;
  localDate?: string;
  mealType?: MealType;
  amountMethod: AmountMethod;
  /** Measured entries only: the weight was typed in, or read from a connected scale. Defaults to typed. */
  weightSource?: WeightSource;
  food?: FoodPortionInput;
  manual?: { name: string; brand?: string | null; kcal: number; proteinG: number; carbsG: number; fatG: number; quantity?: number | null; unit?: MeasureUnit | null };
}

type EntryFields = Pick<
  LogRow,
  | "name"
  | "brand"
  | "food_id"
  | "source"
  | "amount_method"
  | "quantity"
  | "unit"
  | "serving_id"
  | "serving_label"
  | "amount"
  | "amount_unit"
  | "amount_via"
  | "grams"
  | "density_g_per_ml"
  | "per100_kcal"
  | "per100_protein_g"
  | "per100_carbs_g"
  | "per100_fat_g"
  | "kcal"
  | "protein_g"
  | "carbs_g"
  | "fat_g"
  | "calc_version"
  | "weight_source"
>;

function weightSourceFor(method: AmountMethod, requested: WeightSource | undefined): WeightSource | null {
  if (method !== "measured") {
    if (requested) throw new HttpError(422, "weight_source_needs_measurement", "Only a measured entry records where its weight came from");
    return null;
  }
  return requested ?? "typed";
}

/** A food portion through NutritionCalculator: normalised amount, exact nutrition, provenance. */
function portionFields(
  food: PortionFood & { per100: Macros },
  identity: Pick<LogRow, "name" | "brand" | "food_id" | "source">,
  portion: { quantity: number; unit: FoodUnit; servingId?: string | null },
  requested: AmountMethod,
  weightSource: WeightSource | undefined,
): EntryFields {
  const calc = calculatePortion(food, portion);
  const p = calc.portion;
  const method = resolveAmountMethod(identity.source, requested, p.unit, p.via);
  return {
    ...identity,
    amount_method: method,
    quantity: p.quantity,
    unit: p.unit,
    serving_id: p.servingId,
    serving_label: p.servingLabel,
    amount: p.amount,
    amount_unit: p.amountUnit,
    amount_via: p.via,
    grams: p.grams,
    density_g_per_ml: p.densityGPerMl,
    per100_kcal: food.per100.kcal,
    per100_protein_g: food.per100.proteinG,
    per100_carbs_g: food.per100.carbsG,
    per100_fat_g: food.per100.fatG,
    kcal: calc.nutrients.kcal,
    protein_g: calc.nutrients.proteinG,
    carbs_g: calc.nutrients.carbsG,
    fat_g: calc.nutrients.fatG,
    calc_version: CALCULATION_VERSION,
    weight_source: weightSourceFor(method, weightSource),
  };
}

/** A manual entry's optional amount, normalised gram-first like any other. */
function manualAmount(quantity: number | null, unit: MeasureUnit | null) {
  if ((quantity === null) !== (unit === null)) throw new HttpError(422, "incomplete_amount", "Give both an amount and its unit, or neither");
  if (quantity === null || unit === null) return { amount: null, amount_unit: null, amount_via: null, grams: null } as const;
  const base = toBaseAmount(quantity, unit);
  if (!(base.value > 0) || base.value > NUTRITION_LIMITS.maxAmount) throw new HttpError(422, "implausible_amount", "That amount isn't plausible");
  return {
    amount: base.value,
    amount_unit: (base.dimension === "mass" ? "g" : "ml") as AmountBasis,
    amount_via: base.dimension as AmountVia,
    grams: isMassUnit(unit) ? base.value : null,
  };
}

/** Portion + exact nutrition for a food-based entry; for manual entries, the typed-in numbers. */
function resolveEntry(db: Db, userId: string, input: Pick<CreateLogInput, "amountMethod" | "food" | "manual" | "weightSource">): EntryFields {
  if (input.food) {
    const food = findFood(db, userId, input.food.foodId);
    if (!food) throw new HttpError(404, "food_not_found", "That food isn't available");
    return portionFields(food, { name: food.name, brand: food.brand, food_id: food.id, source: food.origin }, input.food, input.amountMethod, input.weightSource);
  }
  const manual = input.manual!;
  const m = manualMacros(manual);
  const unit = manual.unit ?? null;
  const amount = manualAmount(manual.quantity ?? null, unit);
  const method = resolveAmountMethod("manual", input.amountMethod, unit, amount.amount_via);
  return {
    name: manual.name.trim(),
    brand: manual.brand?.trim() || null,
    food_id: null,
    source: "manual",
    amount_method: method,
    quantity: manual.quantity ?? null,
    unit,
    serving_id: null,
    serving_label: null,
    ...amount,
    density_g_per_ml: null,
    per100_kcal: null,
    per100_protein_g: null,
    per100_carbs_g: null,
    per100_fat_g: null,
    kcal: m.kcal,
    protein_g: m.proteinG,
    carbs_g: m.carbsG,
    fat_g: m.fatG,
    calc_version: CALCULATION_VERSION,
    weight_source: weightSourceFor(method, input.weightSource),
  };
}

const INSERT_COLUMNS = [
  "id", "user_id", "client_log_id", "local_date", "meal_type", "logged_at", "name", "brand", "food_id", "source", "amount_method", "quantity", "unit",
  "serving_id", "serving_label", "amount", "amount_unit", "amount_via", "grams", "density_g_per_ml", "per100_kcal", "per100_protein_g", "per100_carbs_g", "per100_fat_g",
  "kcal", "protein_g", "carbs_g", "fat_g", "calc_version", "weight_source", "scan_id", "meal_id", "meal_name", "replaced_log_id", "replaced_estimate", "created_at", "updated_at",
] as const;

function insertRow(db: Db, row: LogRow) {
  db.prepare(`INSERT INTO food_logs (${INSERT_COLUMNS.join(", ")}) VALUES (${INSERT_COLUMNS.map(() => "?").join(", ")})`).run(...INSERT_COLUMNS.map((c) => row[c]));
}

const DAY_MAX_LOGS = 100;

function assertDayRoom(db: Db, userId: string, date: string, adding: number, removingSameDay = 0) {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ? AND local_date = ?").get(userId, date) as { n: number }).n;
  if (count - removingSameDay + adding > DAY_MAX_LOGS) throw new HttpError(422, "too_many_logs", `A day can have at most ${DAY_MAX_LOGS} entries`);
}

/**
 * The scan estimate `replacesLogId`, if an entry with `method` may supersede it: it must be the
 * caller's own scan estimate, not already replaced, and the new amount must be more reliable
 * (measured or label — an estimate never replaces an estimate this way).
 */
function supersedable(db: Db, userId: string, replacesLogId: string, method: AmountMethod): LogRow {
  const already = db.prepare("SELECT id FROM food_logs WHERE user_id = ? AND replaced_log_id = ?").get(userId, replacesLogId) as { id: string } | undefined;
  if (already) throw new HttpError(409, "already_replaced", "That estimate has already been replaced", { logId: already.id });
  const prev = ownLog(db, userId, replacesLogId);
  if (prev.source !== "scan_estimate") throw new HttpError(422, "not_replaceable", "Only a scan estimate can be replaced this way");
  if (!canSupersede({ amountMethod: method }, { source: prev.source, amountMethod: prev.amount_method })) {
    throw new HttpError(422, "replacement_not_better", "Replace an estimate with a weighed or label amount — or edit the estimate instead");
  }
  return prev;
}

const estimateSnapshot = (r: LogRow): string =>
  JSON.stringify({ id: r.id, name: r.name, amount: r.amount, amountUnit: r.amount_unit, kcal: r.kcal, scanId: r.scan_id, loggedAt: r.logged_at } satisfies ReplacedEstimate);

function newRow(
  userId: string,
  clientLogId: string,
  localDate: string,
  mealType: MealType,
  entry: EntryFields,
  group: { scanId?: string | null; mealId: string | null; mealName: string | null; replaced: LogRow | null },
  now: string,
): LogRow {
  return {
    id: randomUUID(),
    user_id: userId,
    client_log_id: clientLogId,
    local_date: localDate,
    meal_type: mealType,
    logged_at: now,
    ...entry,
    scan_id: group.scanId ?? null,
    meal_id: group.mealId,
    meal_name: group.mealName,
    replaced_log_id: group.replaced?.id ?? null,
    replaced_estimate: group.replaced ? estimateSnapshot(group.replaced) : null,
    created_at: now,
    updated_at: now,
  };
}

export interface ScanLogInput {
  scanId: string;
  confirmKey: string;
  localDate: string;
  mealType: MealType;
  mealName: string | null;
  entries: ScanLogEntry[];
}

/**
 * Logs a confirmed scan: one `scan_estimate` entry per kept item, always `estimated`, with the
 * nutrition snapshot resolved server-side. Must run inside the confirming transaction.
 */
export function insertScanLogs(ctx: AppContext, userId: string, input: ScanLogInput, clock: UserClock) {
  const { db } = ctx;
  assertLoggableDate(input.localDate, clock.today);
  assertDayRoom(db, userId, input.localDate, input.entries.length);
  const now = ctx.now().toISOString();
  const rows = input.entries.map((e) =>
    newRow(
      userId,
      `scan:${input.confirmKey}:${e.itemId}`,
      input.localDate,
      input.mealType,
      {
        name: e.name,
        brand: null,
        food_id: e.foodId,
        source: "scan_estimate",
        amount_method: resolveAmountMethod("scan_estimate", "estimated", e.basis),
        quantity: e.amount,
        unit: e.basis,
        serving_id: null,
        serving_label: null,
        amount: e.amount,
        amount_unit: e.basis,
        amount_via: e.basis === "g" ? "mass" : "volume",
        grams: e.basis === "g" ? e.amount : null,
        density_g_per_ml: null,
        per100_kcal: e.per100.kcal,
        per100_protein_g: e.per100.proteinG,
        per100_carbs_g: e.per100.carbsG,
        per100_fat_g: e.per100.fatG,
        kcal: e.macros.kcal,
        protein_g: e.macros.proteinG,
        carbs_g: e.macros.carbsG,
        fat_g: e.macros.fatG,
        calc_version: CALCULATION_VERSION,
        weight_source: null,
      },
      { scanId: input.scanId, mealId: input.scanId, mealName: input.mealName, replaced: null },
      now,
    ),
  );
  for (const row of rows) insertRow(db, row);
  resettleIfSettled(db, userId, input.localDate, ctx.now());
  return rows.map(logView);
}

export function scanLogs(db: Db, userId: string, scanId: string) {
  return (db.prepare("SELECT * FROM food_logs WHERE user_id = ? AND scan_id = ? ORDER BY rowid").all(userId, scanId) as unknown as LogRow[]).map(logView);
}

/** Logs food exactly once per `clientLogId`: a retried request returns the original entry. */
export function createLog(ctx: AppContext, userId: string, input: CreateLogInput, clock: UserClock) {
  const { db } = ctx;
  return transaction(db, () => {
    const existing = db.prepare("SELECT * FROM food_logs WHERE user_id = ? AND client_log_id = ?").get(userId, input.clientLogId) as LogRow | undefined;
    if (existing) return { created: false, log: logView(existing) };

    const entry = resolveEntry(db, userId, input);
    const replaced = input.replacesLogId ? supersedable(db, userId, input.replacesLogId, entry.amount_method) : null;
    // A replacement lands on the estimate's day and meal unless the client moves it.
    const localDate = input.localDate ?? replaced?.local_date ?? clock.today;
    assertLoggableDate(localDate, clock.today);
    assertDayRoom(db, userId, localDate, 1, replaced?.local_date === localDate ? 1 : 0);

    const now = ctx.now().toISOString();
    const mealType = input.mealType ?? replaced?.meal_type ?? defaultMealType(clock.hour);
    const row = newRow(userId, input.clientLogId, localDate, mealType, entry, { mealId: replaced?.meal_id ?? null, mealName: replaced?.meal_name ?? null, replaced }, now);
    if (replaced) db.prepare("DELETE FROM food_logs WHERE id = ? AND user_id = ?").run(replaced.id, userId);
    insertRow(db, row);
    for (const d of new Set([localDate, replaced?.local_date].filter((x): x is string => !!x))) resettleIfSettled(db, userId, d, ctx.now());
    return { created: true, log: logView(row) };
  });
}

/**
 * Logs one planned recipe portion as eaten: a `recipe` entry, amount by count (servings), marked
 * estimated (a recipe portion isn't weighed), with a per-100 snapshot so it can be edited like any
 * other entry. Must run inside the caller's transaction.
 */
export function insertRecipeLog(
  ctx: AppContext,
  userId: string,
  input: { clientLogId: string; localDate: string; mealType: MealType; title: string; servings: number; servingGrams: number; perServing: Macros },
  clock: UserClock,
) {
  const { db } = ctx;
  const existing = db.prepare("SELECT * FROM food_logs WHERE user_id = ? AND client_log_id = ?").get(userId, input.clientLogId) as LogRow | undefined;
  if (existing) return logView(existing);
  assertLoggableDate(input.localDate, clock.today);
  assertDayRoom(db, userId, input.localDate, 1);
  const g = input.servingGrams;
  const per100: Macros = { kcal: (input.perServing.kcal / g) * 100, proteinG: (input.perServing.proteinG / g) * 100, carbsG: (input.perServing.carbsG / g) * 100, fatG: (input.perServing.fatG / g) * 100 };
  const food: PortionFood & { per100: Macros } = { basis: "g", servings: [{ id: "s1", label: `1 serving (${Math.round(g)} g)`, amount: g, kind: "serving" }], per100 };
  const entry = portionFields(food, { name: input.title, brand: null, food_id: null, source: "recipe" }, { quantity: input.servings, unit: "serving", servingId: "s1" }, "estimated", undefined);
  const row = newRow(userId, input.clientLogId, input.localDate, input.mealType, entry, { mealId: null, mealName: null, replaced: null }, ctx.now().toISOString());
  insertRow(db, row);
  resettleIfSettled(db, userId, input.localDate, ctx.now());
  return logView(row);
}

/** Whether a log still exists (the user may have deleted it from Eat). */
export function logExists(db: Db, userId: string, id: string): boolean {
  return !!db.prepare("SELECT 1 FROM food_logs WHERE id = ? AND user_id = ?").get(id, userId);
}

// ---- Meals: several weighed ingredients, logged together ---------------------------------

export const MEAL_LIMITS = { maxItems: 20, nameLength: 60 } as const;

export interface MealItemInput {
  food: FoodPortionInput;
  amountMethod: AmountMethod;
  weightSource?: WeightSource;
  /** A scan estimate this ingredient supersedes. */
  replacesLogId?: string;
}

export interface CreateMealInput {
  clientMealId: string;
  localDate?: string;
  mealType?: MealType;
  mealName?: string | null;
  items: MealItemInput[];
}

function mealResult(rows: LogRow[]) {
  return { mealId: rows[0]!.meal_id!, mealName: rows[0]!.meal_name, logs: rows.map(logView), totals: sumDay(rows.map(entryOf)) };
}

/**
 * Logs a meal of several ingredients atomically: all of them or none, exactly once per
 * `clientMealId`. Each ingredient is calculated like a single entry; the meal total is the rounded
 * sum of their exact values. Ingredients may supersede scan estimates (weigh the scanned plate).
 */
export function createMeal(ctx: AppContext, userId: string, input: CreateMealInput, clock: UserClock) {
  const { db } = ctx;
  return transaction(db, () => {
    const prefix = `meal:${input.clientMealId}:`;
    const existing = db
      .prepare("SELECT * FROM food_logs WHERE user_id = ? AND client_log_id >= ? AND client_log_id < ? ORDER BY rowid")
      .all(userId, prefix, `${prefix}￿`) as unknown as LogRow[];
    if (existing.length > 0) return { created: false, ...mealResult(existing) };

    const replaceIds = input.items.flatMap((i) => (i.replacesLogId ? [i.replacesLogId] : []));
    if (new Set(replaceIds).size !== replaceIds.length) throw new HttpError(422, "duplicate_replacement", "Each estimate can be replaced once");
    const entries = input.items.map((it) => resolveEntry(db, userId, { amountMethod: it.amountMethod, weightSource: it.weightSource, food: it.food }));
    const replaced = input.items.map((it, i) => (it.replacesLogId ? supersedable(db, userId, it.replacesLogId, entries[i]!.amount_method) : null));
    const first = replaced.find((r): r is LogRow => r !== null) ?? null;

    const localDate = input.localDate ?? first?.local_date ?? clock.today;
    assertLoggableDate(localDate, clock.today);
    assertDayRoom(db, userId, localDate, entries.length, replaced.filter((r) => r?.local_date === localDate).length);

    const now = ctx.now().toISOString();
    const mealId = randomUUID();
    const mealType = input.mealType ?? first?.meal_type ?? defaultMealType(clock.hour);
    const mealName = input.mealName?.trim().slice(0, MEAL_LIMITS.nameLength) || first?.meal_name || null;
    for (const r of replaced) if (r) db.prepare("DELETE FROM food_logs WHERE id = ? AND user_id = ?").run(r.id, userId);
    const rows = entries.map((e, i) => newRow(userId, `${prefix}${i}`, localDate, mealType, e, { mealId, mealName, replaced: replaced[i] ?? null }, now));
    for (const row of rows) insertRow(db, row);
    const dates = new Set([localDate, ...replaced.flatMap((r) => (r ? [r.local_date] : []))]);
    for (const d of dates) resettleIfSettled(db, userId, d, ctx.now());
    return { created: true, ...mealResult(rows) };
  });
}

export interface UpdateLogInput {
  mealType?: MealType;
  localDate?: string;
  amountMethod?: AmountMethod;
  weightSource?: WeightSource;
  quantity?: number;
  unit?: FoodUnit;
  servingId?: string | null;
  /** Manual entries only. */
  name?: string;
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}

/**
 * Edits an entry. Food-based entries recompute from the nutrition snapshot taken when they were
 * logged (catalog changes never rewrite history); only manual entries take typed-in macros. The
 * estimated/measured rules apply to the edited entry exactly as to a new one. A new amount on a
 * scale-read entry counts as typed unless the client says it came from the scale again.
 */
export function updateLog(ctx: AppContext, userId: string, id: string, patch: UpdateLogInput, clock: UserClock) {
  const { db } = ctx;
  return transaction(db, () => {
    const row = ownLog(db, userId, id);
    const per100 = per100Of(row);
    const next: LogRow = { ...row };
    if (patch.localDate !== undefined) {
      assertLoggableDate(patch.localDate, clock.today);
      next.local_date = patch.localDate;
    }
    if (patch.mealType !== undefined) next.meal_type = patch.mealType;
    const method = patch.amountMethod ?? row.amount_method;
    const amountChanged = patch.quantity !== undefined || patch.unit !== undefined || patch.servingId !== undefined;
    const weightSource = patch.weightSource ?? (method === "measured" && !amountChanged ? (row.weight_source ?? undefined) : undefined);

    if (per100) {
      if (patch.name !== undefined || patch.kcal !== undefined || patch.proteinG !== undefined || patch.carbsG !== undefined || patch.fatG !== undefined) {
        throw new HttpError(422, "macros_computed", "This food's nutrition comes from its database entry; change the amount instead");
      }
      const unit = patch.unit ?? row.unit!;
      const quantity = patch.quantity ?? row.quantity!;
      const servingId = unit === "serving" || unit === "piece" || unit === "item" ? (patch.servingId !== undefined ? patch.servingId : row.serving_id) : null;
      const live = row.food_id ? findFood(db, userId, row.food_id) : null;
      const snapshotServing =
        row.serving_id && row.quantity && row.amount
          ? [{ id: row.serving_id, label: row.serving_label ?? "serving", amount: row.amount / row.quantity, kind: row.unit === "piece" || row.unit === "item" ? row.unit : ("serving" as const) }]
          : [];
      const food: PortionFood & { per100: Macros } = {
        basis: row.amount_unit!,
        servings: live?.servings ?? snapshotServing,
        gramsPerMl: live?.gramsPerMl ?? row.density_g_per_ml,
        per100,
      };
      const fields = portionFields(food, { name: row.name, brand: row.brand, food_id: row.food_id, source: row.source }, { quantity, unit, servingId }, method, weightSource);
      Object.assign(next, fields);
    } else {
      if (patch.unit === "serving" || patch.unit === "piece" || patch.unit === "item" || patch.servingId) throw new HttpError(422, "no_servings", "A manual entry has no servings");
      const m = manualMacros({ kcal: patch.kcal ?? row.kcal, proteinG: patch.proteinG ?? row.protein_g, carbsG: patch.carbsG ?? row.carbs_g, fatG: patch.fatG ?? row.fat_g });
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new HttpError(422, "name_required", "Give this food a name");
        next.name = name;
      }
      const unit = (patch.unit ?? row.unit) as MeasureUnit | null;
      const quantity = patch.quantity ?? row.quantity;
      const amount = manualAmount(quantity, unit);
      Object.assign(next, { kcal: m.kcal, protein_g: m.proteinG, carbs_g: m.carbsG, fat_g: m.fatG, quantity, unit, ...amount, calc_version: CALCULATION_VERSION });
      next.amount_method = resolveAmountMethod(row.source, method, unit, amount.amount_via);
      next.weight_source = weightSourceFor(next.amount_method, weightSource);
    }

    next.updated_at = ctx.now().toISOString();
    db.prepare(
      `UPDATE food_logs SET local_date = ?, meal_type = ?, name = ?, amount_method = ?, quantity = ?, unit = ?, serving_id = ?, serving_label = ?,
         amount = ?, amount_unit = ?, amount_via = ?, grams = ?, density_g_per_ml = ?, kcal = ?, protein_g = ?, carbs_g = ?, fat_g = ?,
         calc_version = ?, weight_source = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(
      next.local_date,
      next.meal_type,
      next.name,
      next.amount_method,
      next.quantity,
      next.unit,
      next.serving_id,
      next.serving_label,
      next.amount,
      next.amount_unit,
      next.amount_via,
      next.grams,
      next.density_g_per_ml,
      next.kcal,
      next.protein_g,
      next.carbs_g,
      next.fat_g,
      next.calc_version,
      next.weight_source,
      next.updated_at,
      id,
      userId,
    );
    for (const d of new Set([row.local_date, next.local_date])) resettleIfSettled(db, userId, d, ctx.now());
    return logView(next);
  });
}

export function deleteLog(ctx: AppContext, userId: string, id: string): void {
  transaction(ctx.db, () => {
    const row = ownLog(ctx.db, userId, id);
    ctx.db.prepare("DELETE FROM food_logs WHERE id = ? AND user_id = ?").run(id, userId);
    resettleIfSettled(ctx.db, userId, row.local_date, ctx.now());
  });
}
