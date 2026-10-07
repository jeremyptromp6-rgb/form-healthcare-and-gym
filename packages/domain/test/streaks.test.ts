import { describe, expect, it } from "vitest";
import { computeStreak, dayNumber, DomainValidationError } from "../src";

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
