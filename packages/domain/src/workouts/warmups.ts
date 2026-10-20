/**
 * Automatic warm-up sets. Given today's first working weight and reps, suggests a short ladder of
 * lighter sets. Pure, in kg: the app rounds to the exercise's load step (and shows the user's units).
 * Warm-ups are logged as warm-up sets, which never count towards XP, records or totals.
 */

/** Empty Olympic barbell, kg. */
export const DEFAULT_BAR_KG = 20;

export interface WarmupInput {
  /** Non-loadable moves (bodyweight, holds) get no warm-ups. */
  loadable: boolean;
  /** Today's first working weight, kg. */
  workingKg: number;
  /** Reps planned for that working set. */
  workingReps: number;
  /** The exercise's load step, kg: every suggested load is a multiple of it. */
  stepKg: number;
  /** A barbell lift: the ladder starts with the empty bar and never goes below it. */
  barbell?: boolean;
  /** Weight of the bar, kg (default 20). */
  barKg?: number;
}

export interface WarmupSet {
  reps: number;
  loadKg: number;
}

/** One rung: a share of the working weight (0 = the empty bar) for some reps. */
type Rung = { pct: number; reps: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Warm-up sets, lightest first; empty when there is nothing worth warming up. Barbell lifts:
 * from 3 bars up bar x10, 40% x8, 60% x5, 80% x3; from 1.5 bars three steps (bar, 60%, 80%);
 * lighter than that bar x10 then 75%; nothing at or below the bar plus 10%. Other loaded moves get
 * 50% x8 and 75% x5 once the weight is at least four load steps. Loads that round onto or below the
 * previous rung, below the bar, or up to the working weight are dropped, so rungs never repeat.
 */
export function suggestWarmups(input: WarmupInput): WarmupSet[] {
  const { loadable, workingKg, workingReps } = input;
  if (!loadable || !(workingKg > 0)) return [];
  const step = input.stepKg > 0 ? input.stepKg : 2.5;
  const barbell = !!input.barbell;
  const bar = barbell ? (input.barKg && input.barKg > 0 ? input.barKg : DEFAULT_BAR_KG) : 0;

  let ladder: Rung[];
  if (barbell) {
    if (workingKg <= bar * 1.1) return [];
    ladder =
      workingKg >= bar * 3
        ? [{ pct: 0, reps: 10 }, { pct: 0.4, reps: 8 }, { pct: 0.6, reps: 5 }, { pct: 0.8, reps: 3 }]
        : workingKg >= bar * 1.5
          ? [{ pct: 0, reps: 10 }, { pct: 0.6, reps: 5 }, { pct: 0.8, reps: 3 }]
          : [{ pct: 0, reps: 10 }, { pct: 0.75, reps: 5 }];
  } else {
    if (workingKg < step * 4) return [];
    ladder = [{ pct: 0.5, reps: 8 }, { pct: 0.75, reps: 5 }];
  }

  const floor = barbell ? bar : step;
  // Heavy low-rep work (a triple or less) warms up with triples at most, never tiring sets of 8.
  const repCap = workingReps > 0 && workingReps <= 3 ? 3 : Infinity;
  const out: WarmupSet[] = [];
  for (const rung of ladder) {
    const loadKg = rung.pct === 0 ? bar : round2(Math.round((workingKg * rung.pct) / step) * step);
    const last = out[out.length - 1];
    if (loadKg < floor || loadKg >= workingKg || (last && loadKg <= last.loadKg)) continue;
    out.push({ loadKg, reps: rung.pct === 0 ? rung.reps : Math.min(rung.reps, repCap) });
  }
  return out;
}
