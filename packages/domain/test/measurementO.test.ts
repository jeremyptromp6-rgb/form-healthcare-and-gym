import { describe, expect, it } from "vitest";
import { cmToFtIn, DEFAULT_NOTIFICATIONS, DEFAULT_SETTINGS, formatMeasure, fromDisplay, ftInToCm, GRAMS_PER, inQuietHours, KG_PER_LB, ML_PER, toDisplay } from "../src";

describe("centralised units", () => {
  it("stores metric and converts only at the edges, round-tripping exactly", () => {
    expect(toDisplay(80, "body_weight", "metric")).toEqual({ value: 80, unit: "kg" });
    expect(toDisplay(80, "body_weight", "imperial")).toEqual({ value: 176.4, unit: "lb" });
    expect(fromDisplay(150, "body_weight", "imperial")).toBe(68.04);
    expect(toDisplay(fromDisplay(150, "body_weight", "imperial"), "body_weight", "imperial").value).toBe(150);
    expect(toDisplay(100, "food_mass", "imperial")).toEqual({ value: 3.5, unit: "oz" });
    expect(toDisplay(500, "volume", "imperial")).toEqual({ value: 16.9, unit: "fl oz" });
    expect(fromDisplay(70, "load", "metric")).toBe(70);
  });

  it("handles height in feet and inches, including the 12-inch carry", () => {
    expect(cmToFtIn(180)).toEqual({ ft: 5, inches: 11 });
    expect(cmToFtIn(182.8)).toEqual({ ft: 6, inches: 0 });
    expect(ftInToCm(5, 11)).toBeCloseTo(180.34, 2);
    expect(formatMeasure(180, "height", "imperial")).toBe("5′ 11″");
    expect(formatMeasure(180.4, "height", "metric")).toBe("180 cm");
  });

  it("food units and analytics share the same constants", () => {
    expect(GRAMS_PER.lb).toBeCloseTo(KG_PER_LB * 1000, 9);
    expect(ML_PER.fl_oz).toBeCloseTo(29.5735295625, 9);
  });
});

describe("privacy defaults", () => {
  it("opts out of everything external and every notification by default", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ personalizedAdsConsent: false, analyticsConsent: false, aiCoachConsent: false, foodScanConsent: false });
    expect(Object.entries(DEFAULT_NOTIFICATIONS).filter(([, v]) => v === true)).toEqual([]);
  });

  it("understands quiet hours that cross midnight", () => {
    const q = { start: "22:00", end: "07:00" };
    expect(inQuietHours("23:30", q)).toBe(true);
    expect(inQuietHours("06:59", q)).toBe(true);
    expect(inQuietHours("07:00", q)).toBe(false);
    expect(inQuietHours("12:00", q)).toBe(false);
    expect(inQuietHours("13:00", { start: "12:00", end: "14:00" })).toBe(true);
    expect(inQuietHours("13:00", null)).toBe(false);
  });
});
