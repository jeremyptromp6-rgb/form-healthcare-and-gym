import { assertFiniteInRange } from "../shared/errors";

/**
 * Hydration. The target is a sensible everyday guide (≈35 ml per kg, bounded), not a
 * medical prescription. More is not better: intake is capped per entry and per day, and
 * the target never rewards drinking far beyond need (overhydration is dangerous too).
 */

export const WATER_LIMITS = {
  perEntryMl: { min: 50, max: 2000 },
  /** Beyond this in one day, logging is refused with a safety message. */
  dailyMaxMl: 8000,
  targetMl: { min: 1500, max: 4000 },
  defaultTargetMl: 2000,
  mlPerKg: 35,
} as const;

export function waterTargetMl(weightKg: number | null): { targetMl: number; basis: "body_weight" | "default" } {
  if (weightKg === null) return { targetMl: WATER_LIMITS.defaultTargetMl, basis: "default" };
  assertFiniteInRange(weightKg, 30, 300, "weightKg");
  const raw = Math.round((weightKg * WATER_LIMITS.mlPerKg) / 50) * 50;
  return { targetMl: Math.min(WATER_LIMITS.targetMl.max, Math.max(WATER_LIMITS.targetMl.min, raw)), basis: "body_weight" };
}
