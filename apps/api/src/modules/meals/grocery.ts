import { randomUUID } from "node:crypto";
import {
  AISLE_LABEL,
  AISLE_ORDER,
  customGroceryItem,
  groceryAmountText,
  GROCERY_LIMITS,
  groceryNeedsFor,
  libraryRecipe,
  scaledIngredients,
  type Aisle,
} from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { logExists } from "../nutrition/service";

/**
 * The grocery list. Items from the plan are regenerated whenever the plan changes (a ticked item
 * stays ticked unless it now needs more than before); items added from a recipe accumulate; custom
 * items are the user's own and are never touched by plan changes.
 */

interface ItemRow {
  id: string;
  user_id: string;
  client_item_id: string | null;
  source: "plan" | "recipe" | "custom";
  plan_id: string | null;
  food_id: string | null;
  name: string;
  amount: number | null;
  amount_unit: "g" | "ml" | null;
  quantity_text: string | null;
  aisle: Aisle;
  checked: number;
  created_at: string;
  updated_at: string;
}

/** Planned meals not yet eaten, from today on, across active plans. */
function upcomingPlannedMeals(db: Db, userId: string, today: string): { recipeId: string; servings: number }[] {
  const rows = db
    .prepare(
      `SELECT m.recipe_id, m.servings, m.food_log_id FROM planned_meals m JOIN meal_plans p ON p.id = m.plan_id
       WHERE m.user_id = ? AND p.status = 'active' AND m.local_date >= ?`,
    )
    .all(userId, today) as { recipe_id: string; servings: number; food_log_id: string | null }[];
  return rows.filter((m) => !(m.food_log_id && logExists(db, userId, m.food_log_id))).map((m) => ({ recipeId: m.recipe_id, servings: m.servings }));
}

function insertItem(ctx: AppContext, userId: string, item: Omit<ItemRow, "id" | "user_id" | "created_at" | "updated_at">) {
  const now = ctx.now().toISOString();
  ctx.db
    .prepare(
      `INSERT INTO grocery_items (id, user_id, client_item_id, source, plan_id, food_id, name, amount, amount_unit, quantity_text, aisle, checked, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), userId, item.client_item_id, item.source, item.plan_id, item.food_id, item.name, item.amount, item.amount_unit, item.quantity_text, item.aisle, item.checked, now, now);
}

/** Rebuilds the plan-sourced items from the upcoming planned meals. Runs in the caller's transaction. */
export function syncPlanGroceries(ctx: AppContext, userId: string, clock: UserClock): void {
  const { db } = ctx;
  const previous = new Map(
    (db.prepare("SELECT * FROM grocery_items WHERE user_id = ? AND source = 'plan'").all(userId) as unknown as ItemRow[]).map((r) => [`${r.food_id}|${r.amount_unit}`, r]),
  );
  db.prepare("DELETE FROM grocery_items WHERE user_id = ? AND source = 'plan'").run(userId);
  for (const need of groceryNeedsFor(upcomingPlannedMeals(db, userId, clock.today))) {
    const prev = previous.get(`${need.foodId}|${need.unit}`);
    // Keep a tick only if the plan doesn't now need more than was ticked.
    const checked = prev && prev.checked === 1 && need.amount <= (prev.amount ?? 0) + 1e-6 ? 1 : 0;
    insertItem(ctx, userId, { client_item_id: null, source: "plan", plan_id: null, food_id: need.foodId, name: need.name, amount: need.amount, amount_unit: need.unit, quantity_text: null, aisle: need.aisle, checked });
  }
}

function itemView(r: ItemRow) {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    foodId: r.food_id,
    amount: r.amount,
    unit: r.amount_unit,
    amountText: r.amount !== null && r.amount_unit ? groceryAmountText(r.amount, r.amount_unit, r.food_id) : r.quantity_text,
    aisle: r.aisle,
    checked: r.checked === 1,
  };
}

export function groceryList(db: Db, userId: string) {
  const rows = db.prepare("SELECT * FROM grocery_items WHERE user_id = ? ORDER BY name COLLATE NOCASE, created_at").all(userId) as unknown as ItemRow[];
  const items = rows.map(itemView);
  return {
    sections: AISLE_ORDER.map((aisle) => ({ aisle, label: AISLE_LABEL[aisle], items: items.filter((i) => i.aisle === aisle) })).filter((s) => s.items.length > 0),
    total: items.length,
    remaining: items.filter((i) => !i.checked).length,
    note: "Amounts are the weights the recipes use — cooked weights for rice, pasta and meat.",
  };
}

function assertRoom(db: Db, userId: string, adding: number) {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM grocery_items WHERE user_id = ?").get(userId) as { n: number }).n;
  if (n + adding > GROCERY_LIMITS.maxItems) throw new HttpError(422, "list_full", `The list can hold ${GROCERY_LIMITS.maxItems} items — clear some first`);
}

export function addCustomItem(ctx: AppContext, userId: string, input: { clientItemId: string; name: string; quantity?: string | null; aisle?: Aisle | null }) {
  const { db } = ctx;
  return transaction(db, () => {
    const existing = db.prepare("SELECT id FROM grocery_items WHERE user_id = ? AND client_item_id = ?").get(userId, input.clientItemId);
    if (existing) return { created: false, list: groceryList(db, userId) };
    const item = customGroceryItem(input);
    assertRoom(db, userId, 1);
    insertItem(ctx, userId, { client_item_id: input.clientItemId, source: "custom", plan_id: null, food_id: null, name: item.name, amount: null, amount_unit: null, quantity_text: item.quantity, aisle: item.aisle, checked: 0 });
    return { created: true, list: groceryList(db, userId) };
  });
}

/** Adds a recipe's ingredients (scaled to `servings`), merging with items already added from recipes. */
export function addRecipeToGroceries(ctx: AppContext, userId: string, recipeId: string, servings: number) {
  const { db } = ctx;
  const r = libraryRecipe(recipeId);
  if (!r) throw new HttpError(404, "not_found", "Recipe not found");
  return transaction(db, () => {
    const lines = scaledIngredients(r, servings);
    assertRoom(db, userId, lines.length);
    for (const l of lines) {
      const row = db.prepare("SELECT * FROM grocery_items WHERE user_id = ? AND source = 'recipe' AND food_id = ? AND amount_unit = ?").get(userId, l.foodId, l.unit) as ItemRow | undefined;
      if (row) db.prepare("UPDATE grocery_items SET amount = ?, checked = 0, updated_at = ? WHERE id = ?").run((row.amount ?? 0) + l.amount, ctx.now().toISOString(), row.id);
      else insertItem(ctx, userId, { client_item_id: null, source: "recipe", plan_id: null, food_id: l.foodId, name: l.name, amount: l.amount, amount_unit: l.unit, quantity_text: null, aisle: l.aisle, checked: 0 });
    }
    return groceryList(db, userId);
  });
}

export function setChecked(ctx: AppContext, userId: string, id: string, checked: boolean) {
  const r = ctx.db.prepare("UPDATE grocery_items SET checked = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(checked ? 1 : 0, ctx.now().toISOString(), id, userId);
  if (r.changes === 0) throw new HttpError(404, "not_found", "Item not found");
  return groceryList(ctx.db, userId);
}

export function deleteItem(ctx: AppContext, userId: string, id: string) {
  const r = ctx.db.prepare("DELETE FROM grocery_items WHERE id = ? AND user_id = ?").run(id, userId);
  if (r.changes === 0) throw new HttpError(404, "not_found", "Item not found");
  return groceryList(ctx.db, userId);
}

/** Removes ticked custom and recipe items. Plan items stay (ticked): they mirror the plan and update with it. */
export function clearChecked(ctx: AppContext, userId: string) {
  ctx.db.prepare("DELETE FROM grocery_items WHERE user_id = ? AND checked = 1 AND source <> 'plan'").run(userId);
  return groceryList(ctx.db, userId);
}
