import { describe, expect, it } from "vitest";
import {
  AMOUNT_PRECEDENCE,
  calculatePortion,
  canSupersede,
  CALCULATION_VERSION,
  FOOD_UNITS,
  GRAMS_PER,
  measuredPortionFromScale,
  ML_PER,
  NO_SCALE_PROVIDER,
  normalizePortion,
  nutrientsFor,
  NutritionCalculator,
  portionLabel,
  presentMacros,
  recipeMacrosPerServing,
  resolveAmountMethod,
  SCALE_IDLE,
  scaleReducer,
  servingKind,
  stableWeight,
  sumDay,
  sumNutrients,
  verifiedFood,
  type DayEntry,
  type ScaleEvent,
  type ScaleState,
} from "../src";

const food = (id: string) => verifiedFood(`fdb:${id}`)!;

describe("unit conversions (exact definitions)", () => {
  it("mass units are gram-first", () => {
    expect(GRAMS_PER).toEqual({ g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 });
    const rice = food("rice_white_cooked");
    expect(normalizePortion(rice, { quantity: 0.25, unit: "kg" })).toMatchObject({ amount: 250, grams: 250, via: "mass", label: "0.25 kg" });
    expect(normalizePortion(rice, { quantity: 1, unit: "lb" }).amount).toBe(453.59237);
    expect(normalizePortion(rice, { quantity: 16, unit: "oz" }).amount).toBeCloseTo(453.59237, 9); // 16 oz = 1 lb exactly
  });

  it("volume units are US customary and consistent with each other", () => {
    expect(ML_PER.cup).toBeCloseTo(16 * ML_PER.tbsp, 9);
    expect(ML_PER.tbsp).toBeCloseTo(3 * ML_PER.tsp, 9);
    expect(ML_PER.cup).toBeCloseTo(8 * ML_PER.fl_oz, 9);
    const oj = food("orange_juice");
    expect(normalizePortion(oj, { quantity: 0.5, unit: "l" })).toMatchObject({ amount: 500, via: "volume" });
    expect(normalizePortion(oj, { quantity: 500, unit: "ml" }).grams).toBeCloseTo(520, 6); // drinks know their weight via density
  });

  it("cups and spoons of a solid use the reference's own household measure", () => {
    const rice = food("rice_white_cooked"); // 1 cup = 158 g in the reference data
    const cup = normalizePortion(rice, { quantity: 1, unit: "cup" });
    expect(cup.amount).toBeCloseTo(158, 9);
    expect(cup).toMatchObject({ via: "density", amountUnit: "g" });
    expect(normalizePortion(food("peanut_butter"), { quantity: 2, unit: "tbsp" }).amount).toBeCloseTo(32, 9);
    expect(normalizePortion(food("olive_oil"), { quantity: 3, unit: "tsp" }).amount).toBeCloseTo(13.5, 9);
  });

  it("units that don't fit the food are refused with the reason", () => {
    expect(() => normalizePortion(food("chicken_breast_cooked"), { quantity: 1, unit: "cup" })).toThrow(/by weight/);
    expect(() => normalizePortion(food("orange_juice"), { quantity: 1, unit: "piece", servingId: "s1" })).toThrow(/isn't counted in pieces/);
  });

  it("every unit has a readable label", () => {
    for (const u of FOOD_UNITS) expect(portionLabel(2, u, "1 cup (158 g)")).toMatch(/^2 /);
    expect(portionLabel(1, "cup")).toBe("1 cup");
    expect(portionLabel(1.5, "cup")).toBe("1.5 cups");
    expect(portionLabel(2, "l")).toBe("2 L");
    expect(portionLabel(12, "fl_oz")).toBe("12 fl oz");
  });
});

describe("serving units: serving, piece, item", () => {
  it("catalog servings know what they count", () => {
    expect(servingKind("1 medium (118 g)")).toBe("piece");
    expect(servingKind("1 large egg (50 g)")).toBe("piece");
    expect(servingKind("1 can drained (142 g)")).toBe("item");
    expect(servingKind("1 container (170 g)")).toBe("item");
    expect(servingKind("1 cup (158 g)")).toBe("serving");
    expect(servingKind("½ block (126 g)")).toBe("serving");
  });

  it("pieces and items resolve through the food's own serving; 'serving' works for any of them", () => {
    const banana = food("banana");
    expect(normalizePortion(banana, { quantity: 2, unit: "piece", servingId: "s1" })).toMatchObject({ amount: 236, via: "count", label: "2 × 1 medium (118 g)" });
    expect(normalizePortion(banana, { quantity: 2, unit: "serving", servingId: "s1" }).amount).toBe(236);
    expect(normalizePortion(food("tuna_canned_water"), { quantity: 1, unit: "item", servingId: "s1" }).amount).toBe(142);
    expect(() => normalizePortion(banana, { quantity: 1, unit: "item", servingId: "s1" })).toThrow(/items/);
  });
});

describe("NutritionCalculator", () => {
  it("is deterministic and keeps full precision; rounding happens only for presentation", () => {
    const chicken = food("chicken_breast_cooked");
    const a = calculatePortion(chicken, { quantity: 5, unit: "oz" });
    const b = calculatePortion(chicken, { quantity: 5, unit: "oz" });
    expect(a).toEqual(b);
    expect(a.portion.amount).toBeCloseTo(141.747615625, 9);
    expect(a.nutrients.kcal).toBeCloseTo(233.8835658, 6); // not rounded
    expect(a.display).toEqual({ kcal: 234, proteinG: 43.9, carbsG: 0, fatG: 5.1 });
    expect(NutritionCalculator.version).toBe(CALCULATION_VERSION);
  });

  it("sums exact values and rounds once — no accumulated rounding error", () => {
    // Ten 1 g portions of black coffee-like food at 1.4 kcal/100 g → 0.014 kcal each.
    const per100 = { kcal: 4.4, proteinG: 0.04, carbsG: 0, fatG: 0 };
    const parts = Array.from({ length: 10 }, () => nutrientsFor(per100, 10)); // 0.44 kcal each
    expect(parts.map((p) => presentMacros(p).kcal)).toEqual(Array(10).fill(0)); // each rounds to 0 on its own…
    expect(presentMacros(sumNutrients(parts)).kcal).toBe(4); // …but the total is 4.4 → 4, not 0
    const day: DayEntry[] = parts.map((p) => ({ ...p, mealType: "snack", source: "verified_database", amountMethod: "measured" }));
    expect(sumDay(day).kcal).toBe(4);
  });

  it("rounds half away from zero and never shows -0", () => {
    expect(presentMacros({ kcal: 0.5, proteinG: 0.05, carbsG: 2.25, fatG: 1.005 })).toEqual({ kcal: 1, proteinG: 0.1, carbsG: 2.3, fatG: 1 });
    expect(Object.is(presentMacros({ kcal: -0.2, proteinG: 0, carbsG: 0, fatG: 0 }).kcal, 0)).toBe(true);
  });

  it("multiple weighed ingredients: meal total = sum of exact parts", () => {
    const parts = [
      calculatePortion(food("chicken_breast_cooked"), { quantity: 172.4, unit: "g" }),
      calculatePortion(food("rice_white_cooked"), { quantity: 1.5, unit: "cup" }),
      calculatePortion(food("olive_oil"), { quantity: 1, unit: "tbsp" }),
    ];
    const total = presentMacros(sumNutrients(parts.map((p) => p.nutrients)));
    // 165×1.724 + 130×2.37 + 884×0.135 = 284.46 + 308.1 + 119.34 = 711.9
    expect(total.kcal).toBe(712);
    expect(total.fatG).toBeCloseTo(3.6 * 1.724 + 0.3 * 2.37 + 13.5, 1);
  });

  it("recipes use the same engine", () => {
    const m = recipeMacrosPerServing({ servings: 3, ingredients: [{ name: "Oil", grams: 10, per100g: { kcal: 884, proteinG: 0, carbsG: 0, fatG: 100 } }] });
    expect(m.kcal).toBe(29); // 88.4 / 3 = 29.47 → 29 (rounded once)
  });
});

describe("measured vs estimated", () => {
  it("measured needs a weight or volume read directly — not a count, not a density conversion", () => {
    expect(resolveAmountMethod("verified_database", "measured", "kg", "mass")).toBe("measured");
    expect(resolveAmountMethod("verified_database", "measured", "lb", "mass")).toBe("measured");
    expect(resolveAmountMethod("verified_database", "measured", "cup", "volume")).toBe("measured"); // a drink in a measuring cup
    expect(() => resolveAmountMethod("verified_database", "measured", "cup", "density")).toThrow(/converted volume/);
    expect(() => resolveAmountMethod("verified_database", "measured", "piece", "count")).toThrow(/weight or volume/);
    expect(resolveAmountMethod("verified_database", "estimated", "cup", "density")).toBe("estimated");
    expect(resolveAmountMethod("verified_database", "measured", "g", normalizePortion(verifiedFood("fdb:milk_whole")!, { quantity: 250, unit: "g" }).via)).toBe("measured"); // weighed milk
  });

  it("precedence: measured > label > estimated; only scan estimates are superseded, and only upward", () => {
    expect(AMOUNT_PRECEDENCE.measured).toBeGreaterThan(AMOUNT_PRECEDENCE.label);
    expect(AMOUNT_PRECEDENCE.label).toBeGreaterThan(AMOUNT_PRECEDENCE.estimated);
    const scan = { source: "scan_estimate" as const, amountMethod: "estimated" as const };
    expect(canSupersede({ amountMethod: "measured" }, scan)).toBe(true);
    expect(canSupersede({ amountMethod: "label" }, scan)).toBe(true);
    expect(canSupersede({ amountMethod: "estimated" }, scan)).toBe(false);
    expect(canSupersede({ amountMethod: "measured" }, { source: "verified_database", amountMethod: "estimated" })).toBe(false);
  });
});

describe("ScaleProvider state machine", () => {
  const run = (events: ScaleEvent[], from: ScaleState = SCALE_IDLE) => events.reduce(scaleReducer, from);
  const samples = (grams: number[], startMs = 0, stepMs = 250): ScaleEvent[] => grams.map((g, i) => ({ type: "sample", grams: g, atMs: startMs + i * stepMs }));

  it("not connected → connecting → connected → reading → stable", () => {
    expect(SCALE_IDLE.status).toBe("not_connected");
    expect(run([{ type: "connect" }]).status).toBe("connecting");
    const connected = run([{ type: "connect" }, { type: "connected", device: "Kitchen scale" }]);
    expect(connected).toEqual({ status: "connected", device: "Kitchen scale" });
    const reading = run(samples([40, 120, 175]), connected);
    expect(reading).toMatchObject({ status: "reading", grams: 175 });
    const stable = run(samples([182.1, 182.3, 182.2, 182.2, 182.3], 1000), reading);
    expect(stable).toMatchObject({ status: "stable", grams: 182.2 });
    expect(measuredPortionFromScale(stable)).toEqual({ quantity: 182.2, unit: "g" });
  });

  it("a moving weight is never stable; taking food off makes it unstable again", () => {
    const connected: ScaleState = { status: "connected", device: "S" };
    expect(run(samples([100, 110, 120, 130, 140, 150]), connected).status).toBe("reading");
    const stable = run(samples([200, 200, 200, 200, 200]), connected);
    expect(stable.status).toBe("stable");
    const lifted = scaleReducer(stable, { type: "sample", grams: 20, atMs: 1250 });
    expect(lifted.status).toBe("reading");
    expect(measuredPortionFromScale(lifted)).toBeNull();
  });

  it("works the same for fast and slow scales (e.g. a throttled 1 Hz stream)", () => {
    const connected: ScaleState = { status: "connected", device: "S" };
    const slow = run(samples([180, 180.2, 180.1], 0, 1000), connected);
    expect(slow).toMatchObject({ status: "stable", grams: 180.1 });
    // Each further steady sample keeps it stable — no flicker between stable and reading.
    const next = [180.2, 180.1, 180.1].map((g, i) => ({ type: "sample" as const, grams: g, atMs: 3000 + i * 1000 }));
    const states: string[] = [];
    next.reduce((s, e) => {
      const n = scaleReducer(s, e);
      states.push(n.status);
      return n;
    }, slow);
    expect(states).toEqual(["stable", "stable", "stable"]);
    const fast = run(samples([150, 150, 150, 150, 150, 150], 0, 100), connected); // only 500 ms of data
    expect(fast.status).toBe("reading");
    expect(run(samples([150, 150, 150, 150, 150, 150], 600, 100), fast).status).toBe("stable");
  });

  it("too few or too recent samples aren't stable; an empty stable scale isn't a measurement", () => {
    expect(stableWeight([{ grams: 100, atMs: 0 }, { grams: 100, atMs: 100 }]).stable).toBe(false);
    const empty = run(samples([0, 0, 0, 0, 0]), { status: "connected", device: "S" });
    expect(empty.status).toBe("stable");
    expect(measuredPortionFromScale(empty)).toBeNull();
  });

  it("errors, disconnects and overloads", () => {
    const connected: ScaleState = { status: "connected", device: "S" };
    expect(scaleReducer(connected, { type: "disconnected" })).toMatchObject({ status: "error", code: "disconnected" });
    expect(scaleReducer(connected, { type: "sample", grams: 9000, atMs: 0 })).toMatchObject({ status: "error", code: "out_of_range" });
    expect(scaleReducer(SCALE_IDLE, { type: "sample", grams: 100, atMs: 0 })).toBe(SCALE_IDLE); // no connection, no reading
    expect(scaleReducer({ status: "error", code: "failed", message: "x" }, { type: "reset" })).toEqual(SCALE_IDLE);
  });

  it("without a scale integration the provider says so instead of pretending", () => {
    expect(NO_SCALE_PROVIDER.supported).toBe(false);
    const events: ScaleEvent[] = [];
    NO_SCALE_PROVIDER.connect((e) => events.push(e));
    expect(events).toEqual([expect.objectContaining({ type: "error", code: "unsupported" })]);
  });
});
