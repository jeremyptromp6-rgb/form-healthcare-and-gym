import { describe, expect, it } from "vitest";
import { computeMuscleRanks, EXERCISE_BY_ID, MUSCLE_RANK_MUSCLES, rankFor, rankWindowStart, TIER_THRESHOLDS, weightedSetsByMuscle, type RankSet } from "../src";

const sets = (exerciseId: string, n: number, verifiedReps = 5): RankSet[] => Array.from({ length: n }, () => ({ exerciseId, verifiedReps }));
const rank = (all: RankSet[], muscle: string) => computeMuscleRanks(all).find((r) => r.muscle === muscle)!;

describe("muscle ranks", () => {
  it("ranks every muscle as untrained for a brand-new user", () => {
    const r = computeMuscleRanks([]);
    expect(r).toHaveLength(MUSCLE_RANK_MUSCLES.length);
    expect(r.every((m) => m.tier === "untrained" && m.level === 0 && m.sets === 0 && m.nextTier === "bronze" && m.setsToNext === 4)).toBe(true);
  });

  it("weights primary muscles 1.0 and secondary 0.5, from the exercise library", () => {
    const ex = EXERCISE_BY_ID.get("squat")!;
    const w = weightedSetsByMuscle(sets("squat", 6));
    for (const m of ex.primaryMuscles) expect(w[m]).toBe(6);
    for (const m of ex.secondaryMuscles.filter((x) => !ex.primaryMuscles.includes(x))) expect(w[m]).toBe(3);
    expect(w.chest).toBe(0);
  });

  it("counts only sets with verified reps, and ignores unknown exercises", () => {
    const w = weightedSetsByMuscle([...sets("squat", 3), ...sets("squat", 5, 0), ...sets("not_an_exercise", 9)]);
    expect(w.quads).toBe(3);
  });

  it("maps weighted sets to tiers and levels at the documented thresholds", () => {
    expect(rankFor(3.5)).toMatchObject({ tier: "untrained", level: 0 });
    expect(rankFor(4)).toMatchObject({ tier: "bronze", level: 1 });
    expect(rankFor(12)).toMatchObject({ tier: "bronze", level: 3 });
    expect(rankFor(16)).toMatchObject({ tier: "silver", level: 1 });
    expect(rankFor(31.5)).toMatchObject({ tier: "silver", level: 3 });
    expect(rankFor(32)).toMatchObject({ tier: "gold", level: 1, nextTier: "platinum", setsToNext: 16 });
    expect(rankFor(60)).toMatchObject({ tier: "platinum", level: 3, nextTier: "diamond", setsToNext: 4 });
    expect(rankFor(64)).toMatchObject({ tier: "diamond", level: 1 });
    expect(rankFor(500)).toMatchObject({ tier: "diamond", level: 3, nextTier: null, setsToNext: null });
    // ~10 to 20 hard sets a week over 4 weeks is Gold to Diamond.
    expect(rankFor(10 * 4).tier).toBe("gold");
    expect(rankFor(16 * 4).tier).toBe("diamond");
  });

  it("keeps thresholds strictly increasing", () => {
    const all = Object.values(TIER_THRESHOLDS).flat();
    expect(all).toEqual([...all].sort((a, b) => a - b));
    expect(new Set(all).size).toBe(all.length);
  });

  it("reports sets still needed to the next tier, rounded up", () => {
    const r = rank(sets("squat", 5), "hamstrings"); // 2.5 weighted
    expect(r).toMatchObject({ tier: "untrained", sets: 2.5, nextTier: "bronze", setsToNext: 2 });
    expect(rank(sets("squat", 20), "quads")).toMatchObject({ tier: "silver", level: 1, nextTier: "gold", setsToNext: 12 });
  });

  it("sorts the weakest muscles first", () => {
    const r = computeMuscleRanks(sets("squat", 40));
    expect(r[0]!.tier).toBe("untrained");
    for (let i = 1; i < r.length; i++) expect(r[i]!.sets >= 0).toBe(true);
    const order = r.map((m) => m.muscle);
    expect(order.indexOf("chest")).toBeLessThan(order.indexOf("quads"));
    expect(order.at(-1)).toMatch(/quads|glutes/);
  });

  it("uses a 28-day window ending today", () => {
    expect(rankWindowStart("2026-10-14")).toBe("2026-09-17");
  });
});
