import { describe, expect, it } from "vitest";
import { bmr, calculateTargets, DomainValidationError, NutritionCalculator, sumDay, type BodyProfile } from "../src";

const adult: BodyProfile = { sex: "male", ageYears: 30, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain" };

describe("NutritionCalculator", () => {
  it("computes Mifflin–St Jeor BMR", () => {
    expect(bmr(adult)).toBe(10 * 80 + 6.25 * 180 - 5 * 30 + 5); // 1780
    expect(bmr({ ...adult, sex: "female" })).toBe(1780 - 166);
  });

  it("computes maintenance targets whose macros add up to the calorie target", () => {
    const t = calculateTargets(adult);
    expect(t.tdeeKcal).toBe(Math.round(1780 * 1.55));
    expect(t.targetKcal).toBe(t.tdeeKcal);
    const macroKcal = t.proteinG * 4 + t.carbsG * 4 + t.fatG * 9;
    expect(Math.abs(macroKcal - t.targetKcal)).toBeLessThan(15);
  });

  it("caps the deficit at 750 kcal", () => {
    const big: BodyProfile = { ...adult, weightKg: 150, activity: "very_active", goal: "lose" };
    const t = calculateTargets(big);
    expect(t.tdeeKcal - t.targetKcal).toBe(750);
  });

  it("never sets a target below the safe floor", () => {
    const small: BodyProfile = { sex: "female", ageYears: 60, heightCm: 150, weightKg: 45, activity: "sedentary", goal: "lose" };
    const t = calculateTargets(small);
    expect(t.targetKcal).toBeGreaterThanOrEqual(1200);
    expect(t.targetKcal).toBeGreaterThanOrEqual(t.bmrKcal);
    expect(t.targetKcal).toBe(t.safeFloorKcal);
    expect(t.notes.join(" ")).toMatch(/safe minimum/);
  });

  it("does not give minors a weight-loss deficit", () => {
    const t = calculateTargets({ ...adult, ageYears: 16, goal: "lose" });
    expect(t.appliedGoal).toBe("maintain");
    expect(t.targetKcal).toBe(t.tdeeKcal);
  });

  it("rejects out-of-range profiles", () => {
    expect(() => calculateTargets({ ...adult, ageYears: 10 })).toThrow(DomainValidationError);
    expect(() => calculateTargets({ ...adult, weightKg: Number.NaN })).toThrow(DomainValidationError);
    expect(() => calculateTargets({ ...adult, activity: "extreme" as never })).toThrow(DomainValidationError);
  });

  it("scales per-100g macros to a measured weight", () => {
    const rice = { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 };
    expect(NutritionCalculator.present(NutritionCalculator.nutrients(rice, 250))).toEqual({ kcal: 325, proteinG: 6.8, carbsG: 70, fatG: 0.8 });
    expect(() => NutritionCalculator.nutrients(rice, -1)).toThrow();
  });

  it("sums a day and reports the share that came from estimates, scans and measurements", () => {
    const totals = sumDay([
      { kcal: 300, proteinG: 10, carbsG: 50, fatG: 6, mealType: "breakfast", source: "verified_database", amountMethod: "measured" },
      { kcal: 700, proteinG: 25, carbsG: 100, fatG: 20, mealType: "dinner", source: "scan_estimate", amountMethod: "estimated" },
    ]);
    expect(totals.kcal).toBe(1000);
    expect(totals.estimatedKcalShare).toBe(0.7);
    expect(totals.scanKcalShare).toBe(0.7);
    expect(totals.measuredKcalShare).toBe(0.3);
    expect(sumDay([]).estimatedKcalShare).toBe(0);
  });
});
