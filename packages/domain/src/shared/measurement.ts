/**
 * Measurement — the one place unit conversion lives.
 *
 * Storage is canonical and metric everywhere: body weight and loads in kg, height in cm, food mass
 * in g, volume in ml. Imperial is a display/input concern only: values are converted at the edges
 * (what the user types, what they see) and never stored in another unit, so every stored number
 * has one meaning.
 */

export type UnitSystem = "metric" | "imperial";

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const G_PER_OZ = 28.349523125;
export const ML_PER_FL_OZ = 29.5735295625;

/** What is being measured decides the display unit. */
export type Quantity = "body_weight" | "load" | "height" | "food_mass" | "volume";

const CANONICAL: Record<Quantity, string> = { body_weight: "kg", load: "kg", height: "cm", food_mass: "g", volume: "ml" };
const IMPERIAL: Record<Quantity, { unit: string; perUnit: number }> = {
  body_weight: { unit: "lb", perUnit: KG_PER_LB },
  load: { unit: "lb", perUnit: KG_PER_LB },
  height: { unit: "in", perUnit: CM_PER_IN },
  food_mass: { unit: "oz", perUnit: G_PER_OZ },
  volume: { unit: "fl oz", perUnit: ML_PER_FL_OZ },
};

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export function canonicalUnit(q: Quantity): string {
  return CANONICAL[q];
}

/** A canonical (metric) value in the user's units, rounded for display (1 decimal). */
export function toDisplay(value: number, q: Quantity, system: UnitSystem): { value: number; unit: string } {
  if (system === "metric") return { value: round(value, 1), unit: CANONICAL[q] };
  const i = IMPERIAL[q];
  return { value: round(value / i.perUnit, 1), unit: i.unit };
}

/**
 * A value the user typed, in their units, to canonical storage. Kept to 2 decimals so imperial
 * entries round-trip exactly (150 lb → 68.04 kg → 150 lb).
 */
export function fromDisplay(value: number, q: Quantity, system: UnitSystem): number {
  return round(system === "metric" ? value : value * IMPERIAL[q].perUnit, 2);
}

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;

export function cmToFtIn(cm: number): { ft: number; inches: number } {
  let ft = Math.floor(cm / CM_PER_IN / 12);
  let inches = Math.round(cm / CM_PER_IN - ft * 12);
  if (inches === 12) {
    ft += 1;
    inches = 0;
  }
  return { ft, inches };
}

export const ftInToCm = (ft: number, inches: number) => (ft * 12 + inches) * CM_PER_IN;

export function formatMeasure(value: number, q: Quantity, system: UnitSystem): string {
  if (q === "height" && system === "imperial") {
    const { ft, inches } = cmToFtIn(value);
    return `${ft}′ ${inches}″`;
  }
  const d = toDisplay(value, q, system);
  return `${q === "height" ? Math.round(d.value) : d.value} ${d.unit}`;
}
