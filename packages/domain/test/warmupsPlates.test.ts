import { describe, expect, it } from "vitest";
import { KG_PLATES, LB_PLATES, platesPerSide, suggestWarmups } from "../src";

const bb = (workingKg: number, over: Partial<Parameters<typeof suggestWarmups>[0]> = {}) =>
  suggestWarmups({ loadable: true, barbell: true, stepKg: 2.5, workingKg, workingReps: 5, ...over });

describe("warm-up sets", () => {
  it("builds the full barbell ladder from 60 kg, rounded to the load step", () => {
    expect(bb(100)).toEqual([
      { loadKg: 20, reps: 10 },
      { loadKg: 40, reps: 8 },
      { loadKg: 60, reps: 5 },
      { loadKg: 80, reps: 3 },
    ]);
    // 40% of 62.5 = 25, 60% = 37.5, 80% = 50
    expect(bb(62.5).map((s) => s.loadKg)).toEqual([20, 25, 37.5, 50]);
    // 40% of 67 = 26.8 -> 27.5 (nearest 2.5)
    expect(bb(67).map((s) => s.loadKg)).toEqual([20, 27.5, 40, 52.5]);
  });

  it("uses fewer steps for lighter weights", () => {
    expect(bb(40).map((s) => s.loadKg)).toEqual([20, 25, 32.5]);
    // 30 kg: 60% = 18 is under the bar, so only the bar and 80% (24 -> 25) remain
    expect(bb(30).map((s) => s.loadKg)).toEqual([20, 25]);
    expect(bb(25).map((s) => s.loadKg)).toEqual([20]);
  });

  it("never goes below the bar and never repeats a load", () => {
    for (const w of [23, 25, 30, 35, 45, 60, 75, 140]) {
      const loads = bb(w).map((s) => s.loadKg);
      expect(loads.every((l) => l >= 20 && l < w)).toBe(true);
      expect(new Set(loads).size).toBe(loads.length);
      expect([...loads].sort((a, b) => a - b)).toEqual(loads);
    }
  });

  it("gives nothing at or near the bar", () => {
    expect(bb(20)).toEqual([]);
    expect(bb(22)).toEqual([]);
    expect(bb(15)).toEqual([]);
  });

  it("uses the chosen bar weight", () => {
    const loads = bb(100, { barKg: 15 }).map((s) => s.loadKg);
    expect(loads[0]).toBe(15);
    expect(bb(16, { barKg: 15 })).toEqual([]);
  });

  it("gives nothing for bodyweight, non-loadable or empty loads", () => {
    expect(suggestWarmups({ loadable: false, workingKg: 100, workingReps: 5, stepKg: 2.5, barbell: true })).toEqual([]);
    expect(bb(0)).toEqual([]);
    expect(bb(Number.NaN)).toEqual([]);
  });

  it("warms up other loaded moves with two lighter sets, and skips very light ones", () => {
    const db = (workingKg: number) => suggestWarmups({ loadable: true, stepKg: 2.5, workingKg, workingReps: 10 });
    expect(db(40)).toEqual([
      { loadKg: 20, reps: 8 },
      { loadKg: 30, reps: 5 },
    ]);
    expect(db(8)).toEqual([]);
    // 12.5 kg: 50% = 6.25 -> 7.5 (round half up on the step), 75% = 9.375 -> 10
    expect(db(12.5).map((s) => s.loadKg)).toEqual([7.5, 10]);
  });

  it("keeps warm-up reps within a heavy low-rep working set's reach", () => {
    expect(bb(100, { workingReps: 1 }).map((s) => s.reps)).toEqual([10, 3, 3, 3]);
  });
});

describe("plate calculator", () => {
  it("finds exact plates per side", () => {
    const r = platesPerSide(100, 20, KG_PLATES);
    expect(r.perSide).toEqual([25, 15]);
    expect(r).toMatchObject({ loaded: 100, remainder: 0, exact: true, belowBar: false });
    expect(platesPerSide(72.5, 20, KG_PLATES).perSide).toEqual([25, 1.25]);
  });

  it("groups repeated plates", () => {
    const r = platesPerSide(140, 20, KG_PLATES);
    expect(r.perSide).toEqual([25, 25, 10]);
    expect(r.stacks).toEqual([
      { plate: 25, count: 2 },
      { plate: 10, count: 1 },
    ]);
  });

  it("returns the nearest load below the target with the remainder", () => {
    const r = platesPerSide(61, 20, KG_PLATES);
    expect(r.perSide).toEqual([20]);
    expect(r.loaded).toBe(60);
    expect(r.remainder).toBe(1);
    expect(r.exact).toBe(false);
  });

  it("works in pounds", () => {
    expect(platesPerSide(135, 45, LB_PLATES).perSide).toEqual([45]);
    expect(platesPerSide(225, 45, LB_PLATES).perSide).toEqual([45, 45]);
    const r = platesPerSide(185, 45, LB_PLATES);
    expect(r.perSide).toEqual([45, 25]);
    expect(r.exact).toBe(true);
    expect(platesPerSide(137, 45, LB_PLATES)).toMatchObject({ perSide: [45], loaded: 135, remainder: 2, exact: false });
  });

  it("shows just the bar when the target is the bar or lighter", () => {
    expect(platesPerSide(20, 20, KG_PLATES)).toMatchObject({ perSide: [], loaded: 20, remainder: 0, belowBar: false, exact: true });
    expect(platesPerSide(15, 20, KG_PLATES)).toMatchObject({ perSide: [], loaded: 20, remainder: 0, belowBar: true, exact: false });
    expect(platesPerSide(0, 20, KG_PLATES).belowBar).toBe(true);
  });

  it("copes with a missing plate and with 1.25 kg plates without float drift", () => {
    expect(platesPerSide(22.5, 20, KG_PLATES)).toMatchObject({ perSide: [1.25], loaded: 22.5, exact: true });
    expect(platesPerSide(100, 20, [20, 10])).toMatchObject({ perSide: [20, 20], loaded: 100 });
    expect(platesPerSide(100, 20, [])).toMatchObject({ perSide: [], loaded: 20, remainder: 80 });
  });
});
