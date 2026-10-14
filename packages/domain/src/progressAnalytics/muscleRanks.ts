import { addDays } from "../shared/dates";
import { EXERCISE_BY_ID, type MuscleGroup } from "../workouts/exercises";

/**
 * Muscle ranks — which muscles are well trained and which need attention, from the user's own
 * training only (never compared with other people).
 *
 * Volume: every hard set (a logged set with at least one verified rep, from a workout without
 * serious pain) over the last 28 days counts 1.0 towards each primary muscle of its exercise and 0.5
 * towards each secondary muscle (a muscle in both lists counts as primary). A set with unknown exercise
 * is ignored.
 *
 * Thresholds follow common weekly-volume guidance: roughly 10 to 20 hard sets per muscle per week is a
 * strong, well-supported range, below ~4 a week is a maintenance-or-less dose. Over 4 weeks:
 *   Bronze 4 (1 a week), Silver 16 (4 a week), Gold 32 (8 a week), Platinum 48 (12 a week),
 *   Diamond 64 (16 a week). Each tier has three levels (I, II, III) at equal steps to the next tier;
 *   Diamond III (75, about 19 a week) is the top. Fewer than 4 weighted sets is "untrained".
 */

export const RANK_WINDOW_DAYS = 28;

export const MUSCLE_TIERS = ["untrained", "bronze", "silver", "gold", "platinum", "diamond"] as const;
export type MuscleTier = (typeof MUSCLE_TIERS)[number];

export const MUSCLE_RANK_MUSCLES: readonly MuscleGroup[] = ["chest", "back", "lats", "traps", "shoulders", "biceps", "triceps", "forearms", "core", "glutes", "quads", "hamstrings", "calves"];

/** Weighted sets (over the window) at which level I, II and III of each tier begin. */
export const TIER_THRESHOLDS: Record<Exclude<MuscleTier, "untrained">, readonly [number, number, number]> = {
  bronze: [4, 8, 12],
  silver: [16, 21, 27],
  gold: [32, 37, 43],
  platinum: [48, 53, 59],
  diamond: [64, 69, 75],
};

export const PRIMARY_WEIGHT = 1;
export const SECONDARY_WEIGHT = 0.5;

export interface MuscleRank {
  muscle: MuscleGroup;
  tier: MuscleTier;
  /** 1 to 3 within the tier; 0 when untrained. */
  level: 0 | 1 | 2 | 3;
  /** Weighted hard sets in the window (primary 1.0, secondary 0.5), one decimal. */
  sets: number;
  /** The next tier up, or null at the top (Diamond). */
  nextTier: MuscleTier | null;
  /** Weighted sets still needed to start `nextTier` (whole number, rounded up), or null at the top. */
  setsToNext: number | null;
}

export interface RankSet {
  exerciseId: string;
  verifiedReps: number;
}

/** First day of the 28-day window ending on `today` (inclusive). */
export const rankWindowStart = (today: string): string => addDays(today, -(RANK_WINDOW_DAYS - 1));

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Weighted hard sets per muscle. Sets with no verified reps and unknown exercises don't count. */
export function weightedSetsByMuscle(sets: readonly RankSet[]): Record<MuscleGroup, number> {
  const out = Object.fromEntries(MUSCLE_RANK_MUSCLES.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  for (const s of sets) {
    if (!(s.verifiedReps > 0)) continue;
    const ex = EXERCISE_BY_ID.get(s.exerciseId);
    if (!ex) continue;
    const primary = new Set(ex.primaryMuscles);
    for (const m of primary) out[m] += PRIMARY_WEIGHT;
    for (const m of new Set(ex.secondaryMuscles)) if (!primary.has(m)) out[m] += SECONDARY_WEIGHT;
  }
  return out;
}

/** The tier and level for a number of weighted sets in the window. */
export function rankFor(weighted: number): Pick<MuscleRank, "tier" | "level" | "nextTier" | "setsToNext"> {
  const tiers = MUSCLE_TIERS.slice(1) as Exclude<MuscleTier, "untrained">[];
  let at = -1; // index into `tiers` of the tier reached
  let level: MuscleRank["level"] = 0;
  tiers.forEach((t, ti) => {
    TIER_THRESHOLDS[t].forEach((from, i) => {
      if (weighted >= from) {
        at = ti;
        level = (i + 1) as 1 | 2 | 3;
      }
    });
  });
  const tier: MuscleTier = at < 0 ? "untrained" : tiers[at]!;
  const next = tiers[at + 1];
  return { tier, level, nextTier: next ?? null, setsToNext: next ? Math.ceil(TIER_THRESHOLDS[next][0] - weighted) : null };
}

/** Rank order, weakest first: lower tier, then lower level, then fewer sets, then the usual muscle order. */
const score = (r: Pick<MuscleRank, "tier" | "level">) => MUSCLE_TIERS.indexOf(r.tier) * 4 + r.level;

/** Every muscle's rank, weakest first (the muscles to improve lead). */
export function computeMuscleRanks(sets: readonly RankSet[]): MuscleRank[] {
  const weighted = weightedSetsByMuscle(sets);
  return MUSCLE_RANK_MUSCLES.map((muscle, order) => ({ muscle, order, sets: round1(weighted[muscle]), ...rankFor(weighted[muscle]) }))
    .sort((a, b) => score(a) - score(b) || a.sets - b.sets || a.order - b.order)
    .map(({ order: _order, ...r }) => r);
}
