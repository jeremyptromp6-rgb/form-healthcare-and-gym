import { assertFiniteInRange, DomainValidationError } from "../shared/errors";
import { validateMacros, type Macros } from "./nutritionCalculator";
import {
  isCountUnit,
  isMassUnit,
  NUTRITION_LIMITS,
  portionLabel,
  toBaseAmount,
  type AmountBasis,
  type FoodUnit,
  type Serving,
} from "./units";

/**
 * NutritionCalculator — the one engine that turns a portion of a food into nutrition. The server
 * logs with it, the app previews with it, recipes, scans and user foods use it; nothing else
 * multiplies nutrition by an amount.
 *
 * 1. Normalise the portion: the amount in the food's basis unit (g or ml), gram-first — the weight
 *    in grams is recorded whenever it is known (mass input, a gram-based food, or a known density).
 * 2. Scale the per-100 nutrition by that amount at full precision.
 * 3. Round only for presentation (`present`). Stored values and sums keep full precision, so a day
 *    total is the rounded sum of exact values, not a sum of rounded values.
 */

/** Bumped whenever a change to this file could change a calculated result; stored with each log. */
export const CALCULATION_VERSION = 1;

export interface PortionFood {
  basis: AmountBasis;
  servings: readonly Serving[];
  /** Density, when known: lets a gram-based food take cups/spoons and a drink be weighed. */
  gramsPerMl?: number | null;
}

export interface Portion {
  quantity: number;
  unit: FoodUnit;
  /** Required for count units (serving, piece, item). */
  servingId?: string | null;
}

/**
 * How the amount was reached: read directly by weight ("mass") or volume ("volume"), a household
 * volume of a solid converted to weight through its density ("density" — an approximation, never a
 * measurement), or a count of servings ("count"). A weighed drink is "mass": the weight is measured;
 * only the conversion to its per-100 ml basis uses the density.
 */
export type AmountVia = "mass" | "volume" | "density" | "count";

export interface NormalizedPortion {
  quantity: number;
  unit: FoodUnit;
  servingId: string | null;
  servingLabel: string | null;
  /** The amount in the food's basis unit, full precision. */
  amount: number;
  amountUnit: AmountBasis;
  /** The weight in grams when it is known; null for a drink without a known density. */
  grams: number | null;
  via: AmountVia;
  /** The density used for a conversion (or to find the grams), if any. */
  densityGPerMl: number | null;
  label: string;
}

function density(food: PortionFood): number | null {
  const d = food.gramsPerMl;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? d : null;
}

/** Converts a portion to an amount of the food. Throws with the reason for units that don't fit. */
export function normalizePortion(food: PortionFood, portion: Portion): NormalizedPortion {
  assertFiniteInRange(portion.quantity, 0.01, NUTRITION_LIMITS.maxQuantity, "quantity");
  const d = density(food);
  let amount: number;
  let grams: number | null;
  let via: AmountVia;
  let serving: Serving | null = null;

  if (isCountUnit(portion.unit)) {
    serving = food.servings.find((s) => s.id === portion.servingId) ?? null;
    if (!serving) throw new DomainValidationError("unknown serving for this food", "servingId");
    if (portion.unit !== "serving" && (serving.kind ?? "serving") !== portion.unit) {
      throw new DomainValidationError(`that serving isn't counted in ${portion.unit}s`, "unit");
    }
    amount = portion.quantity * serving.amount;
    grams = food.basis === "g" ? amount : d ? amount * d : null;
    via = "count";
  } else {
    const base = toBaseAmount(portion.quantity, portion.unit);
    const dimension = food.basis === "g" ? "mass" : "volume";
    if (base.dimension === dimension) {
      amount = base.value;
      via = base.dimension;
      grams = base.dimension === "mass" ? base.value : d ? base.value * d : null;
    } else if (d) {
      // Different dimension: only with a known density. Weighing a drink is still a measurement;
      // a cup of a solid converted to grams is not.
      amount = base.dimension === "mass" ? base.value / d : base.value * d;
      grams = base.dimension === "mass" ? base.value : amount;
      via = base.dimension === "mass" ? "mass" : "density";
    } else {
      throw new DomainValidationError(
        food.basis === "g" ? "this food is measured by weight — use grams, kilograms, ounces or pounds" : "this drink is measured by volume — use ml, litres, fl oz, cups or spoons",
        "unit",
      );
    }
  }
  assertFiniteInRange(amount, 0.1, NUTRITION_LIMITS.maxAmount, "amount");
  return {
    quantity: portion.quantity,
    unit: portion.unit,
    servingId: serving?.id ?? null,
    servingLabel: serving?.label ?? null,
    amount,
    amountUnit: food.basis,
    grams,
    via,
    densityGPerMl: via === "density" || (grams !== null && food.basis === "ml") ? d : null,
    label: portionLabel(portion.quantity, portion.unit, serving?.label),
  };
}

/** Nutrition for an amount of a food given per 100 g / 100 ml. Full precision — not rounded. */
export function nutrientsFor(per100: Macros, amount: number): Macros {
  validateMacros(per100);
  assertFiniteInRange(amount, 0, NUTRITION_LIMITS.maxAmount, "amount");
  const f = amount / 100;
  return { kcal: per100.kcal * f, proteinG: per100.proteinG * f, carbsG: per100.carbsG * f, fatG: per100.fatG * f };
}

export function sumNutrients(list: readonly Macros[]): Macros {
  const t = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const m of list) {
    t.kcal += m.kcal;
    t.proteinG += m.proteinG;
    t.carbsG += m.carbsG;
    t.fatG += m.fatG;
  }
  return t;
}

const roundTo = (n: number, places: number) => {
  const f = 10 ** places;
  const r = Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
  return r === 0 ? 0 : r; // no "-0"
};

/** Presentation rounding: whole kcal, grams to 0.1. The only place nutrition is rounded. */
export function presentMacros(m: Macros): Macros {
  return { kcal: roundTo(m.kcal, 0), proteinG: roundTo(m.proteinG, 1), carbsG: roundTo(m.carbsG, 1), fatG: roundTo(m.fatG, 1) };
}

/** Presentation rounding for an amount (g/ml): 0.1. */
export function presentAmount(amount: number): number {
  return roundTo(amount, 1);
}

export interface PortionCalculation {
  portion: NormalizedPortion;
  /** Full precision — what is stored and summed. */
  nutrients: Macros;
  /** Rounded for display. */
  display: Macros;
}

export function calculatePortion(food: PortionFood & { per100: Macros }, portion: Portion): PortionCalculation {
  const p = normalizePortion(food, portion);
  const nutrients = nutrientsFor(food.per100, p.amount);
  return { portion: p, nutrients, display: presentMacros(nutrients) };
}

/** Per-100 nutrition from the nutrition of a known amount (e.g. a label serving). Full precision. */
export function per100FromAmount(perServing: Macros, servingAmount: number): Macros {
  validateMacros(perServing);
  assertFiniteInRange(servingAmount, 0.1, NUTRITION_LIMITS.maxAmount, "servingAmount");
  const f = 100 / servingAmount;
  return { kcal: perServing.kcal * f, proteinG: perServing.proteinG * f, carbsG: perServing.carbsG * f, fatG: perServing.fatG * f };
}

/** The single entry point, for callers that prefer one name. */
export const NutritionCalculator = {
  version: CALCULATION_VERSION,
  normalize: normalizePortion,
  nutrients: nutrientsFor,
  calculate: calculatePortion,
  sum: sumNutrients,
  present: presentMacros,
  presentAmount,
  per100FromAmount,
} as const;
