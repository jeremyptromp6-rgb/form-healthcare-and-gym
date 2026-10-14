import { describe, expect, it } from "vitest";
import { daysLeftInSeason, monthGrid, SEASON_MILESTONES, seasonMonths, seasonOf, seasonProgress, seasonTrainingDays } from "../src";

const w = (localDate: string, painLevel = "none") => ({ localDate, painLevel });

/** The i-th day from 2026-10-01 (stays inside Q4 for i < 92). */
const nthDay = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);

describe("seasonOf", () => {
  it("splits the year into calendar quarters", () => {
    expect(seasonOf("2026-01-01")).toEqual({ id: "2026-Q1", year: 2026, quarter: 1, start: "2026-01-01", end: "2026-03-31" });
    expect(seasonOf("2026-03-31").quarter).toBe(1);
    expect(seasonOf("2026-04-01")).toMatchObject({ quarter: 2, start: "2026-04-01", end: "2026-06-30" });
    expect(seasonOf("2026-09-30")).toMatchObject({ quarter: 3, start: "2026-07-01", end: "2026-09-30" });
    expect(seasonOf("2026-10-14")).toMatchObject({ id: "2026-Q4", start: "2026-10-01", end: "2026-12-31" });
  });
  it("is unaffected by a leap day", () => {
    expect(seasonOf("2028-02-29")).toMatchObject({ quarter: 1, end: "2028-03-31" });
  });
  it("rejects an invalid date", () => {
    expect(() => seasonOf("2026-13-01")).toThrow();
  });
});

describe("daysLeftInSeason", () => {
  it("counts days to the season end", () => {
    expect(daysLeftInSeason("2026-12-31")).toBe(0);
    expect(daysLeftInSeason("2026-12-30")).toBe(1);
    expect(daysLeftInSeason("2026-10-14")).toBe(78);
    expect(daysLeftInSeason("2026-10-01")).toBe(91);
  });
});

describe("seasonMonths", () => {
  it("lists the three month starts", () => {
    expect(seasonMonths(seasonOf("2026-10-14"))).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(seasonMonths(seasonOf("2026-02-02"))).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});

describe("seasonTrainingDays", () => {
  const season = seasonOf("2026-10-14");
  it("counts distinct pain-free days inside the season, up to today", () => {
    const days = seasonTrainingDays([w("2026-09-30"), w("2026-10-01"), w("2026-10-01"), w("2026-10-05", "mild"), w("2026-10-07", "serious"), w("2026-10-14"), w("2026-10-20")], season, "2026-10-14");
    expect(days).toEqual(["2026-10-01", "2026-10-05", "2026-10-14"]);
  });
  it("is empty without workouts", () => {
    expect(seasonTrainingDays([], season, "2026-10-14")).toEqual([]);
  });
});

describe("seasonProgress", () => {
  const dates = (n: number) => Array.from({ length: n }, (_, i) => w(nthDay(i)));
  it("starts with every chest closed", () => {
    const p = seasonProgress([], "2026-10-14");
    expect(p.days).toBe(0);
    expect(p.milestones.map((m) => m.reached)).toEqual([false, false, false, false]);
    expect(p.next).toEqual({ at: 7, remaining: 7 });
    expect(p.fractionToNext).toBe(0);
    expect(p.daysLeft).toBe(78);
  });
  it("opens a chest on reaching its milestone and aims at the next", () => {
    const p = seasonProgress(dates(7), "2026-10-14");
    expect(p.milestones.map((m) => m.reached)).toEqual([true, false, false, false]);
    expect(p.next).toEqual({ at: 20, remaining: 13 });
    expect(p.fractionToNext).toBe(0);
    const q = seasonProgress(dates(10), "2026-10-14");
    expect(q.next).toEqual({ at: 20, remaining: 10 });
    expect(q.fractionToNext).toBeCloseTo(3 / 13);
  });
  it("is complete after the last milestone", () => {
    const last = SEASON_MILESTONES[SEASON_MILESTONES.length - 1]!;
    const p = seasonProgress(dates(last), "2026-12-31");
    expect(p.next).toBeNull();
    expect(p.fractionToNext).toBe(1);
    expect(p.milestones.every((m) => m.reached)).toBe(true);
  });
  it("ignores serious-pain days and other seasons", () => {
    const p = seasonProgress([w("2026-10-02", "serious"), w("2026-09-02"), w("2026-10-03")], "2026-10-14");
    expect(p.days).toBe(1);
  });
});

describe("monthGrid", () => {
  it("lays out a month Monday-first with null padding", () => {
    const grid = monthGrid("2026-10-01"); // 1 Oct 2026 is a Thursday
    expect(grid[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(grid.every((r) => r.length === 7)).toBe(true);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
    expect(grid[grid.length - 1]!.filter(Boolean).pop()).toBe("2026-10-31");
  });
  it("needs no leading padding when the month starts on a Monday", () => {
    const grid = monthGrid("2026-06-01");
    expect(grid[0]![0]).toBe("2026-06-01");
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
  });
  it("handles February in and out of a leap year", () => {
    expect(monthGrid("2028-02-01").flat().filter(Boolean)).toHaveLength(29);
    expect(monthGrid("2026-02-01").flat().filter(Boolean)).toHaveLength(28);
  });
});
