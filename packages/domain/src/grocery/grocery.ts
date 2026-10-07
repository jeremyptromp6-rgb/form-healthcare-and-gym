import { DomainValidationError } from "../shared/errors";
import { verifiedFood } from "../food/catalog";
import { libraryRecipe, scaledIngredients, type Aisle } from "../recipes/library";

/**
 * Grocery lists. Planned recipes turn into a shopping list: ingredients scaled to the planned
 * portions, aggregated only where it is safe (the same food in the same unit — never "chicken
 * breast" with "chicken thigh", never grams with millilitres), grouped by aisle.
 *
 * Amounts are the weights the recipes use, which for some foods are cooked weights (rice, pasta,
 * chicken) — the list says so rather than guessing raw equivalents.
 */

export const AISLE_ORDER: readonly Aisle[] = ["protein", "carbohydrates", "produce", "other"];
export const AISLE_LABEL: Readonly<Record<Aisle, string>> = { protein: "Protein", carbohydrates: "Carbohydrates", produce: "Produce", other: "Other" };

export interface GroceryNeed {
  foodId: string;
  name: string;
  amount: number;
  unit: "g" | "ml";
  aisle: Aisle;
}

/** Sums the same food in the same unit; keeps everything else separate. Sorted by aisle, then name. */
export function aggregateGroceries(needs: readonly GroceryNeed[]): GroceryNeed[] {
  const byKey = new Map<string, GroceryNeed>();
  for (const n of needs) {
    if (!(n.amount > 0)) continue;
    const key = `${n.foodId}|${n.unit}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...prev, amount: prev.amount + n.amount } : { ...n });
  }
  return [...byKey.values()].sort((a, b) => AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.name.localeCompare(b.name));
}

/** What to buy for these planned meals (servings = portions of one recipe serving). */
export function groceryNeedsFor(meals: readonly { recipeId: string; servings: number }[]): GroceryNeed[] {
  const needs: GroceryNeed[] = [];
  for (const m of meals) {
    const r = libraryRecipe(m.recipeId);
    if (!r) continue;
    needs.push(...scaledIngredients(r, m.servings));
  }
  return aggregateGroceries(needs);
}

/** A shopping amount: rounded up to a practical step, kg/L above 1000. */
export function formatGroceryAmount(amount: number, unit: "g" | "ml"): string {
  const big = unit === "g" ? "kg" : "L";
  if (amount >= 1000) return `${Math.ceil(amount / 100) / 10} ${big}`;
  const step = amount < 100 ? 5 : 10;
  return `${Math.max(step, Math.ceil(amount / step) * step)} ${unit}`;
}

/**
 * The amount as a shopper thinks of it: foods bought by the piece (eggs, bananas, apples) also get
 * an approximate count from their catalog piece size — "about 22 (1.1 kg)".
 */
export function groceryAmountText(amount: number, unit: "g" | "ml", foodId?: string | null): string {
  const weight = formatGroceryAmount(amount, unit);
  const piece = foodId ? verifiedFood(foodId)?.servings.find((s) => s.kind === "piece") : undefined;
  if (!piece || unit !== "g") return weight;
  const n = Math.max(1, Math.ceil(amount / piece.amount - 0.15));
  return `about ${n} (${weight})`;
}

export const GROCERY_LIMITS = { nameLength: 80, quantityLength: 30, maxItems: 300 } as const;

/** A custom item as typed by the user: trimmed and length-checked. */
export function customGroceryItem(input: { name: string; quantity?: string | null; aisle?: Aisle | null }): { name: string; quantity: string | null; aisle: Aisle } {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > GROCERY_LIMITS.nameLength) throw new DomainValidationError(`name is required (max ${GROCERY_LIMITS.nameLength} characters)`, "name");
  const quantity = input.quantity?.trim() || null;
  if (quantity && quantity.length > GROCERY_LIMITS.quantityLength) throw new DomainValidationError("quantity is too long", "quantity");
  return { name, quantity, aisle: input.aisle ?? "other" };
}
