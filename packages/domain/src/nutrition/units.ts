import { G_PER_OZ, KG_PER_LB, ML_PER_FL_OZ } from "../shared/measurement";
/**
 * Measurement units for food portions. Conversion factors are exact definitions (international
 * avoirdupois pound and ounce; US customary volumes), so every conversion is deterministic.
 *
 * - mass units convert to grams;
 * - volume units convert to millilitres;
 * - count units (serving, piece, item) mean one of the food's own servings, whose size is given in
 *   the food's basis unit.
 */

export const MASS_UNITS = ["g", "kg", "oz", "lb"] as const;
export const VOLUME_UNITS = ["ml", "l", "fl_oz", "cup", "tbsp", "tsp"] as const;
export const COUNT_UNITS = ["serving", "piece", "item"] as const;
export const FOOD_UNITS = [...MASS_UNITS, ...VOLUME_UNITS, ...COUNT_UNITS] as const;
/** Units that are a weight or a volume (as opposed to a count). */
export const MEASURE_UNITS = [...MASS_UNITS, ...VOLUME_UNITS] as const;

export type MassUnit = (typeof MASS_UNITS)[number];
export type VolumeUnit = (typeof VOLUME_UNITS)[number];
export type CountUnit = (typeof COUNT_UNITS)[number];
export type FoodUnit = (typeof FOOD_UNITS)[number];
export type MeasureUnit = MassUnit | VolumeUnit;

/** Nutrition is stored per 100 g (solids) or per 100 ml (drinks). */
export type AmountBasis = "g" | "ml";

export interface Serving {
  id: string;
  label: string;
  /** Amount of one serving in the food's basis unit (g or ml). */
  amount: number;
  /**
   * What one of these is: a natural piece (a banana, an egg, a slice), a packaged item (a can, a
   * container) or a plain serving. "serving" may be used for any of them.
   */
  kind?: CountUnit;
}

export const NUTRITION_LIMITS = {
  /** Largest single entry, in g or ml. */
  maxAmount: 5000,
  maxQuantity: 1000,
  /** Days back a food can be logged or moved to. */
  maxBackdateDays: 7,
} as const;

export const GRAMS_PER: Readonly<Record<MassUnit, number>> = { g: 1, kg: 1000, oz: G_PER_OZ, lb: KG_PER_LB * 1000 };
export const ML_PER: Readonly<Record<VolumeUnit, number>> = {
  ml: 1,
  l: 1000,
  fl_oz: ML_PER_FL_OZ,
  cup: 236.5882365,
  tbsp: 14.78676478125,
  tsp: 4.92892159375,
};

const has = <T extends string>(list: readonly T[], u: string): u is T => (list as readonly string[]).includes(u);
export const isMassUnit = (u: string): u is MassUnit => has(MASS_UNITS, u);
export const isVolumeUnit = (u: string): u is VolumeUnit => has(VOLUME_UNITS, u);
export const isCountUnit = (u: string): u is CountUnit => has(COUNT_UNITS, u);
export const isMeasureUnit = (u: string): u is MeasureUnit => isMassUnit(u) || isVolumeUnit(u);

/** A weight in grams or a volume in millilitres, at full precision. */
export function toBaseAmount(quantity: number, unit: MeasureUnit): { value: number; dimension: "mass" | "volume" } {
  return isMassUnit(unit) ? { value: quantity * GRAMS_PER[unit], dimension: "mass" } : { value: quantity * ML_PER[unit], dimension: "volume" };
}

const SYMBOL: Record<FoodUnit, [string, string]> = {
  g: ["g", "g"],
  kg: ["kg", "kg"],
  oz: ["oz", "oz"],
  lb: ["lb", "lb"],
  ml: ["ml", "ml"],
  l: ["L", "L"],
  fl_oz: ["fl oz", "fl oz"],
  cup: ["cup", "cups"],
  tbsp: ["tbsp", "tbsp"],
  tsp: ["tsp", "tsp"],
  serving: ["serving", "servings"],
  piece: ["piece", "pieces"],
  item: ["item", "items"],
};

export function unitSymbol(unit: FoodUnit, quantity = 2): string {
  return SYMBOL[unit][quantity === 1 ? 0 : 1];
}

export function formatQuantity(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
}

/** "150 g", "1.5 cups", "2 × 1 medium (118 g)". */
export function portionLabel(quantity: number, unit: FoodUnit, servingLabel?: string | null): string {
  if (isCountUnit(unit)) return `${formatQuantity(quantity)} × ${servingLabel ?? unitSymbol(unit, 1)}`;
  return `${formatQuantity(quantity)} ${unitSymbol(unit, quantity)}`;
}
