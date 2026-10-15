import { describe, expect, it } from "vitest";
import { computeStreak, dayNumber, DomainValidationError, STREAK_FREEZES_PER_MONTH, workoutStreakWithFreezes, type StreakFreezeOptions } from "../src";

describe("StreakEngine", () => {
  it("returns an empty streak with no activity", () => {
    expect(computeStreak([], "2026-09-27")).toEqual({ current: 0, longest: 0, activeToday: false, restDaysRemaining: null, startDate: null });
  });

  it("counts consecutive active days", () => {
    const s = computeStreak(["2026-09-25", "2026-09-26", "2026-09-27"], "2026-09-27");
    expect(s).toMatchObject({ current: 3, longest: 3, activeToday: true });
  });

  it("allows up to two rest days without breaking the streak", () => {
    const s = computeStreak(["2026-09-20", "2026-09-23", "2026-09-26"], "2026-09-26");
    expect(s.current).toBe(3);
  });

  it("breaks after three consecutive rest days", () => {
    const s = computeStreak(["2026-09-20", "2026-09-24"], "2026-09-24");
    expect(s.current).toBe(1);
    expect(s.longest).toBe(1);
  });

  it("counts down rest days remaining when inactive today", () => {
    expect(computeStreak(["2026-09-26"], "2026-09-27").restDaysRemaining).toBe(2);
    expect(computeStreak(["2026-09-26"], "2026-09-28").restDaysRemaining).toBe(1);
    expect(computeStreak(["2026-09-26"], "2026-09-29").restDaysRemaining).toBe(0);
    const broken = computeStreak(["2026-09-26"], "2026-09-30");
    expect(broken.current).toBe(0);
    expect(broken.longest).toBe(1);
    expect(broken.restDaysRemaining).toBeNull();
  });

  it("ignores duplicate and future dates", () => {
    const s = computeStreak(["2026-09-27", "2026-09-27", "2026-10-05"], "2026-09-27");
    expect(s.current).toBe(1);
  });

  it("crosses month and year boundaries", () => {
    expect(computeStreak(["2026-12-31", "2027-01-01"], "2027-01-01").current).toBe(2);
    expect(computeStreak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01").current).toBe(3);
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => dayNumber("2026-9-27")).toThrow(DomainValidationError);
    expect(() => dayNumber("2026-02-30")).toThrow(DomainValidationError);
  });
});

describe("Streak freezes (Pro Streak Shield)", () => {
  const run = (dates: string[], today: string, freezes?: Partial<StreakFreezeOptions>) =>
    workoutStreakWithFreezes({ workouts: dates.map((localDate) => ({ localDate, painLevel: "none" })), trainingDaysPerWeek: 3 }, today, { enabled: true, eligibleFrom: null, frozenDates: [], ...freezes });
  const free = (dates: string[], today: string) => workoutStreakWithFreezes({ workouts: dates.map((localDate) => ({ localDate, painLevel: "none" })), trainingDaysPerWeek: 3 }, today);

  it("gives two freezes a month", () => {
    expect(STREAK_FREEZES_PER_MONTH).toBe(2);
    expect(run([], "2026-10-05").freezes).toMatchObject({ usedThisMonth: 0, freezesLeft: 2, frozenDates: [] });
  });

  it("covers the oldest missed day when a gap would break the streak, and it is not a training day", () => {
    const dates = ["2026-10-01", "2026-10-05"];
    expect(free(dates, "2026-10-05").streak.current).toBe(1);
    const pro = run(dates, "2026-10-05");
    expect(pro.streak).toMatchObject({ current: 2, longest: 2, activeToday: true });
    expect(pro.freezes).toMatchObject({ usedThisMonth: 1, freezesLeft: 1, frozenDates: ["2026-10-02"], newlyFrozen: ["2026-10-02"] });
  });

  it("keeps a streak alive while waiting, spending the freeze only when it would otherwise break", () => {
    const waiting = run(["2026-10-01"], "2026-10-04");
    expect(waiting.streak).toMatchObject({ current: 1, restDaysRemaining: 0 });
    expect(waiting.freezes.frozenDates).toEqual([]);
    expect(free(["2026-10-01"], "2026-10-05").streak.current).toBe(0);
    const covered = run(["2026-10-01"], "2026-10-05");
    expect(covered.streak).toMatchObject({ current: 1, restDaysRemaining: 0 });
    expect(covered.freezes.frozenDates).toEqual(["2026-10-02"]);
  });

  it("breaks on the third miss in a month and spends nothing on a gap it cannot bridge", () => {
    const s = run(["2026-10-01", "2026-10-05", "2026-10-09", "2026-10-13"], "2026-10-13");
    expect(s.freezes).toMatchObject({ usedThisMonth: 2, freezesLeft: 0, frozenDates: ["2026-10-02", "2026-10-06"] });
    expect(s.streak).toMatchObject({ current: 1, longest: 3 });
    // A gap needing more freezes than are left is not partly covered.
    const long = run(["2026-10-01", "2026-10-09"], "2026-10-09");
    expect(long.streak.current).toBe(1);
    expect(long.freezes.frozenDates).toEqual([]);
  });

  it("never covers days before Pro began", () => {
    const dates = ["2026-10-01", "2026-10-05"];
    expect(run(dates, "2026-10-05", { eligibleFrom: "2026-10-05" }).streak.current).toBe(1);
    expect(run(dates, "2026-10-05", { eligibleFrom: "2026-10-04" }).freezes.frozenDates).toEqual(["2026-10-04"]);
  });

  it("resets each calendar month and keeps earlier freezes stable", () => {
    const s = run(["2026-10-01", "2026-10-05"], "2026-10-05", { frozenDates: ["2026-09-10", "2026-09-20"] });
    expect(s.freezes).toMatchObject({ usedThisMonth: 1, freezesLeft: 1, newlyFrozen: ["2026-10-02"] });
    expect(s.freezes.frozenDates).toEqual(["2026-09-10", "2026-09-20", "2026-10-02"]);
    expect(run([], "2026-09-25", { frozenDates: ["2026-09-10", "2026-09-20"] }).freezes.freezesLeft).toBe(0);
  });

  it("budgets freezes by the month of the missed day", () => {
    // Five missed days (Sep 29 – Oct 3) need three freezes; September has one left, so October covers the rest.
    const s = run(["2026-09-28", "2026-10-04"], "2026-10-04", { frozenDates: ["2026-09-01"] });
    expect(s.freezes.newlyFrozen).toEqual(["2026-09-29", "2026-10-01", "2026-10-02"]);
    expect(s.streak.current).toBe(2);
    // With September used up, a gap needing three cannot be bridged and nothing is spent.
    const full = run(["2026-09-28", "2026-10-04"], "2026-10-04", { frozenDates: ["2026-09-01", "2026-09-02"] });
    expect(full.streak.current).toBe(1);
    expect(full.freezes.newlyFrozen).toEqual([]);
  });

  it("keeps used freezes frozen even when no longer Pro, but spends no new ones", () => {
    const dates = ["2026-10-01", "2026-10-05"];
    const lapsed = run(dates, "2026-10-05", { enabled: false, frozenDates: ["2026-10-02"] });
    expect(lapsed.streak.current).toBe(2);
    expect(lapsed.freezes).toMatchObject({ enabled: false, freezesLeft: 0, newlyFrozen: [] });
    expect(run(dates, "2026-10-05", { enabled: false }).streak.current).toBe(1);
  });

  it("drops a frozen day the user later trained on", () => {
    const s = run(["2026-10-01", "2026-10-02", "2026-10-05"], "2026-10-05", { frozenDates: ["2026-10-02"] });
    expect(s.freezes.frozenDates).not.toContain("2026-10-02");
    expect(s.streak.current).toBe(3);
  });
});
