import {
  addDays,
  calculatePortion,
  MASS_UNITS,
  NUTRITION_LIMITS,
  portionLabel as domainPortionLabel,
  presentMacros,
  sumNutrients,
  unitSymbol,
  VOLUME_UNITS,
  type AmountMethod,
  type AmountVia,
  type FoodItem,
  type FoodSource,
  type FoodUnit,
  type Macros,
  type MealType,
  type NormalizedPortion,
} from '@form/domain';

/**
 * Eat helpers — display logic only. Previews use the domain NutritionCalculator, the same engine
 * the server logs with, but the server recomputes every logged number itself; the app never sends
 * macros for a catalog food.
 */

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};
export const MEALS: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export type UnitGroup = 'serving' | 'weight' | 'volume';

export interface UnitOption {
  key: string;
  label: string;
  unit: FoodUnit;
  servingId: string | null;
  group: UnitGroup;
  /** Reached through the food's density (a cup of rice): never a measurement. */
  converted: boolean;
}

const WEIGHT_LABEL: Record<(typeof MASS_UNITS)[number], string> = {
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lb',
};
const VOLUME_LABEL: Record<(typeof VOLUME_UNITS)[number], string> = {
  ml: 'ml',
  l: 'L',
  fl_oz: 'fl oz',
  cup: 'cup',
  tbsp: 'tbsp',
  tsp: 'tsp',
};
const SOLID_VOLUMES = ['cup', 'tbsp', 'tsp'] as const;

/**
 * The units that fit a food: its own servings (counted as pieces/items where they are), weights for
 * solids — and for drinks with a known density, so they can be weighed — and volumes for drinks, or
 * cups/spoons for solids with a known density (converted, never measured).
 */
export function unitOptions(food: Pick<FoodItem, 'basis' | 'servings' | 'gramsPerMl'>): UnitOption[] {
  const servings: UnitOption[] = food.servings.map((s) => ({
    key: `serving:${s.id}`,
    label: s.label,
    unit: s.kind ?? 'serving',
    servingId: s.id,
    group: 'serving',
    converted: false,
  }));
  const dense = !!food.gramsPerMl;
  const weight = (u: (typeof MASS_UNITS)[number]): UnitOption => ({
    key: u,
    label: WEIGHT_LABEL[u],
    unit: u,
    servingId: null,
    group: 'weight',
    converted: false,
  });
  const volume = (u: (typeof VOLUME_UNITS)[number], converted: boolean): UnitOption => ({
    key: u,
    label: VOLUME_LABEL[u],
    unit: u,
    servingId: null,
    group: 'volume',
    converted,
  });
  if (food.basis === 'g') return [...MASS_UNITS.map(weight), ...servings, ...(dense ? SOLID_VOLUMES.map((u) => volume(u, true)) : [])];
  return [...VOLUME_UNITS.map((u) => volume(u, false)), ...servings, ...(dense ? MASS_UNITS.map(weight) : [])];
}

export type PortionPreview =
  | {
      ok: true;
      amount: number;
      amountUnit: 'g' | 'ml';
      macros: Macros;
      portion: NormalizedPortion;
    }
  | { ok: false; error: string };

export type AmountInput = { ok: true; value: number } | { ok: false; error: string | null };

/** Validates what the user typed: decimals with "." or ",", at most 2 decimal places, above zero. */
export function readAmount(text: string): AmountInput {
  const t = text.trim().replace(',', '.');
  if (t === '') return { ok: false, error: null };
  if (!/^\d*\.?\d*$/.test(t) || t === '.') return { ok: false, error: 'Numbers only, like 150 or 1.5.' };
  if ((t.split('.')[1] ?? '').length > 2) return { ok: false, error: 'Use at most 2 decimal places.' };
  const value = Number(t);
  if (!(value > 0)) return { ok: false, error: 'Enter an amount above zero.' };
  return { ok: true, value };
}

/** Nutrition for a portion via the domain NutritionCalculator (display-rounded), or why it can't be. */
export function previewPortion(food: FoodItem, quantity: number, option: Pick<UnitOption, 'unit' | 'servingId'>): PortionPreview {
  if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'Enter an amount above zero.' };
  try {
    const c = calculatePortion(food, {
      quantity,
      unit: option.unit,
      servingId: option.servingId,
    });
    return {
      ok: true,
      amount: c.portion.amount,
      amountUnit: c.portion.amountUnit,
      macros: c.display,
      portion: c.portion,
    };
  } catch {
    return {
      ok: false,
      error: `That's more than ${NUTRITION_LIMITS.maxAmount / 1000} kg (or litres) — check the amount.`,
    };
  }
}

/** Methods an amount allows: "measured" needs a weight or volume read directly — never a count or a converted cup. */
export function allowedMethods(unit: FoodUnit, converted = false): AmountMethod[] {
  return unit === 'serving' || unit === 'piece' || unit === 'item' || converted ? ['label', 'estimated'] : ['measured', 'label', 'estimated'];
}

/**
 * A sensible starting method: counts and cups come from labels; a typed weight stays an estimate
 * until the user says it came off a scale (the weighing flows start on "Measured").
 */
export function defaultMethod(unit: FoodUnit, converted = false): AmountMethod {
  return allowedMethods(unit, converted).includes('measured') ? 'estimated' : 'label';
}

export const METHOD_LABEL: Record<AmountMethod, string> = {
  measured: 'Measured',
  label: 'Label',
  estimated: 'Estimate',
};

export const VIA_LABEL: Record<AmountVia, string> = {
  mass: 'weighed',
  volume: 'measured by volume',
  density: 'converted from volume',
  count: 'counted',
};

export function entryBadge(e: { source: FoodSource; amountMethod: AmountMethod }): { label: string; tone: 'primary' | 'purple' | 'warning' | 'neutral' } {
  if (e.source === 'scan_estimate') return { label: 'Scan estimate', tone: 'warning' };
  if (e.amountMethod === 'measured') return { label: 'Measured', tone: 'primary' };
  if (e.amountMethod === 'label') return { label: 'Label', tone: 'purple' };
  return { label: 'Estimate', tone: 'neutral' };
}

export function formatQuantity(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
}

/** "1 × 1 cup (158 g)", "150 g", "1.5 cups", "8 fl oz", or null for manual entries without an amount. */
export function portionLabel(e: { quantity: number | null; unit: FoodUnit | null; servingLabel: string | null }): string | null {
  if (e.quantity === null || e.unit === null) return null;
  return domainPortionLabel(e.quantity, e.unit, e.servingLabel);
}

export { unitSymbol };

/**
 * How today is going, in words, from the day's own numbers. Never shaming: being over is stated
 * plainly, and an empty day is an invitation.
 */
export function dayHeadline(day: { isToday: boolean; logs: unknown[]; progress: { kcal: { over: number } } | null }): string {
  const when = day.isToday ? 'today' : 'that day';
  if (day.logs.length === 0) return day.isToday ? 'Nothing logged yet' : 'Nothing logged that day';
  if (day.progress && day.progress.kcal.over > 0) return `A little over ${when}`;
  if (!day.progress) return day.isToday ? 'Today so far' : 'That day';
  return day.isToday ? 'You’re on track today' : 'On track that day';
}

/** A practical nudge when protein is clearly short (≥ 10 g to go), or null. */
export function proteinNudge(day: { logs: unknown[]; progress: { proteinG: { remaining: number } } | null }): string | null {
  if (!day.progress || day.logs.length === 0) return null;
  const left = Math.round(day.progress.proteinG.remaining);
  return left >= 10 ? `You’re ${left} g short on protein today.` : null;
}

/** A meal's total: exact nutrition per ingredient (NutritionCalculator), summed, rounded once for display. */
export function mealTotals(
  items: readonly {
    food: FoodItem;
    choice: { quantity: number; unit: FoodUnit; servingId: string | null };
  }[],
): Macros {
  const exact = items.map(
    (i) =>
      calculatePortion(i.food, {
        quantity: i.choice.quantity,
        unit: i.choice.unit,
        servingId: i.choice.servingId,
      }).nutrients,
  );
  return presentMacros(sumNutrients(exact));
}

export function formatLiters(ml: number): string {
  return `${(Math.round(ml / 100) / 10).toFixed(1)} L`;
}

/** Days the Eat tab can show and log to: today and up to 7 days back. */
export function dayNavigation(date: string, today: string) {
  const earliest = addDays(today, -NUTRITION_LIMITS.maxBackdateDays);
  return {
    prev: date > earliest ? addDays(date, -1) : null,
    next: date < today ? addDays(date, 1) : null,
    isToday: date === today,
  };
}

export function dayTitle(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** A number typed by the user ("1,5" works too), or NaN. */
export function parseAmount(s: string): number {
  const t = s.trim().replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
}
