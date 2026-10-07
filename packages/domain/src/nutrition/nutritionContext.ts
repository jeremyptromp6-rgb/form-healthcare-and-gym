import { addDays, type DateKey } from "../shared/dates";
import type { DayTotals, MacroTargets } from "./foodLog";

/**
 * Nutrition context for the AI coach (and any later recommender). Aggregates only: no food
 * names, no raw logs, no body measurements. Carries the safety facts the coach must respect.
 */

export interface NutritionCoachContext {
  hasTargets: boolean;
  targets: { kcal: number; proteinG: number; carbsG: number; fatG: number; safeFloorKcal: number } | null;
  today: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    waterMl: number;
    waterTargetMl: number;
    entries: number;
    remainingKcal: number | null;
    /** Share of today's calories that are estimates (coach should treat totals as approximate). */
    estimatedShare: number;
  };
  last7Days: {
    daysLogged: number;
    averageKcal: number | null;
    averageProteinG: number | null;
    daysMeetingProtein: number;
    /** Completed days logged below the safe minimum. */
    daysBelowSafeFloor: number;
  };
  safetyNotes: string[];
}

export interface NutritionContextInput {
  today: DateKey;
  /** Totals per logged day, any order; days outside the last 7 are ignored. */
  days: { date: DateKey; totals: DayTotals }[];
  targets: MacroTargets | null;
  water: { totalMl: number; targetMl: number };
}

const PROTEIN_MET = 0.9;

export function buildNutritionContext(input: NutritionContextInput): NutritionCoachContext {
  const from = addDays(input.today, -6);
  const week = input.days.filter((d) => d.date >= from && d.date <= input.today && d.totals.entries > 0);
  const completed = week.filter((d) => d.date < input.today);
  const today = input.days.find((d) => d.date === input.today)?.totals;
  const t = input.targets;
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const belowFloor = t ? completed.filter((d) => d.totals.kcal < t.safeFloorKcal).length : 0;

  const safetyNotes: string[] = [];
  if (t) safetyNotes.push(`Never suggest eating below ${t.safeFloorKcal} kcal a day (the user's safe minimum).`);
  if (belowFloor > 0) {
    safetyNotes.push(`The user logged below their safe minimum on ${belowFloor} of the last 7 days. Encourage eating enough; never suggest eating less.`);
  }
  if ((today?.estimatedKcalShare ?? 0) > 0) safetyNotes.push("Some of today's intake is estimated: treat totals as approximate.");

  return {
    hasTargets: t !== null,
    targets: t ? { kcal: t.targetKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, safeFloorKcal: t.safeFloorKcal } : null,
    today: {
      kcal: today?.kcal ?? 0,
      proteinG: today?.proteinG ?? 0,
      carbsG: today?.carbsG ?? 0,
      fatG: today?.fatG ?? 0,
      waterMl: input.water.totalMl,
      waterTargetMl: input.water.targetMl,
      entries: today?.entries ?? 0,
      remainingKcal: t ? Math.max(0, t.targetKcal - (today?.kcal ?? 0)) : null,
      estimatedShare: today?.estimatedKcalShare ?? 0,
    },
    last7Days: {
      daysLogged: week.length,
      averageKcal: avg(completed.map((d) => d.totals.kcal)),
      averageProteinG: avg(completed.map((d) => d.totals.proteinG)),
      daysMeetingProtein: t ? completed.filter((d) => d.totals.proteinG >= t.proteinG * PROTEIN_MET).length : 0,
      daysBelowSafeFloor: belowFloor,
    },
    safetyNotes,
  };
}
