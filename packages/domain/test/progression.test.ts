import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  MAX_LEVEL,
  nutritionDayXp,
  progressFromXp,
  RANKS,
  rankForLevel,
  workoutXp,
  xpRequiredForLevel,
} from "../src";

describe("level curve", () => {
  it("starts at level 1 with 0 XP and increases strictly", () => {
    expect(xpRequiredForLevel(1)).toBe(0);
    for (let l = 2; l <= MAX_LEVEL; l++) expect(xpRequiredForLevel(l)).toBeGreaterThan(xpRequiredForLevel(l - 1));
  });

  it("maps XP to level at exact boundaries", () => {
    const l5 = xpRequiredForLevel(5);
    expect(progressFromXp(l5 - 1).level).toBe(4);
    expect(progressFromXp(l5).level).toBe(5);
    expect(progressFromXp(l5).xpIntoLevel).toBe(0);
  });

  it("caps at MAX_LEVEL", () => {
    const p = progressFromXp(1e12);
    expect(p.level).toBe(MAX_LEVEL);
    expect(p.xpForNextLevel).toBe(0);
    expect(p.fractionToNext).toBe(1);
  });

  it("rejects negative or non-finite XP", () => {
    expect(() => progressFromXp(-1)).toThrow(DomainValidationError);
    expect(() => progressFromXp(Number.NaN)).toThrow(DomainValidationError);
  });

  it("assigns ranks by level", () => {
    expect(rankForLevel(1)).toBe("Rookie");
    expect(rankForLevel(4)).toBe("Rookie");
    expect(rankForLevel(5)).toBe("Starter");
    expect(rankForLevel(10)).toBe("Athlete");
    expect(rankForLevel(20)).toBe("Iron");
    expect(rankForLevel(30)).toBe("Elite");
    expect(rankForLevel(45)).toBe("Master");
    expect(rankForLevel(60)).toBe("Champion");
    expect(rankForLevel(100)).toBe("Champion");
    expect(RANKS.map((r) => r.name)).toEqual(["Rookie", "Starter", "Athlete", "Iron", "Elite", "Master", "Champion"]);
  });
});

describe("workout XP", () => {
  const base = { durationMinutes: 45, priorTrainingMinutesToday: 0, painLevel: "none" as const };

  it("rewards verified reps more than unverified reps", () => {
    const verified = workoutXp({ ...base, sets: [{ reps: 10, verifiedReps: 10 }] });
    const unverified = workoutXp({ ...base, sets: [{ reps: 10, verifiedReps: 0 }] });
    expect(verified.xp).toBe(10 * 2 + 25);
    expect(unverified.xp).toBe(Math.floor(10 * 0.5 + 25));
    expect(verified.xp).toBeGreaterThan(unverified.xp);
  });

  it("gives nothing for an empty workout", () => {
    expect(workoutXp({ ...base, sets: [] }).xp).toBe(0);
  });

  it("never rewards training through serious pain", () => {
    const r = workoutXp({ ...base, painLevel: "serious", sets: [{ reps: 10, verifiedReps: 10 }] });
    expect(r.xp).toBe(0);
    expect(r.flags).toContain("serious_pain_no_xp");
  });

  it("stops rewarding training beyond the daily cap", () => {
    const r = workoutXp({ ...base, priorTrainingMinutesToday: 120, sets: [{ reps: 10, verifiedReps: 10 }] });
    expect(r.xp).toBe(0);
    expect(r.flags).toContain("daily_training_cap_reached");
  });

  it("pro-rates a workout that crosses the daily cap", () => {
    const r = workoutXp({ durationMinutes: 60, priorTrainingMinutesToday: 90, painLevel: "none", sets: [{ reps: 10, verifiedReps: 10 }] });
    expect(r.flags).toContain("partially_capped");
    expect(r.xp).toBe(Math.floor(45 * 0.5));
  });

  it("rejects verifiedReps greater than reps (cannot inflate verification)", () => {
    expect(() => workoutXp({ ...base, sets: [{ reps: 5, verifiedReps: 6 }] })).toThrow(DomainValidationError);
  });

  it("rejects absurd inputs", () => {
    expect(() => workoutXp({ ...base, sets: [{ reps: 5000, verifiedReps: 0 }] })).toThrow();
    expect(() => workoutXp({ ...base, sets: [{ reps: 2.5, verifiedReps: 0 }] })).toThrow();
    expect(() => workoutXp({ ...base, durationMinutes: 0, sets: [] })).toThrow();
    expect(() => workoutXp({ ...base, sets: Array(101).fill({ reps: 1, verifiedReps: 0 }) })).toThrow();
  });
});

describe("nutrition XP", () => {
  const day = { targetKcal: 2200, safeFloorKcal: 1500 };

  it("rewards logging, capped per day", () => {
    expect(nutritionDayXp({ ...day, mealsLogged: 2, totalKcal: 900, dayComplete: false }).xp).toBe(10);
    expect(nutritionDayXp({ ...day, mealsLogged: 9, totalKcal: 900, dayComplete: false }).xp).toBe(20);
  });

  it("gives an on-target bonus for a completed day", () => {
    const r = nutritionDayXp({ ...day, mealsLogged: 3, totalKcal: 2150, dayComplete: true });
    expect(r.flags).toContain("on_target");
    expect(r.xp).toBe(15 + 20);
  });

  it("never rewards a completed day below the safe floor", () => {
    const r = nutritionDayXp({ ...day, mealsLogged: 4, totalKcal: 800, dayComplete: true });
    expect(r.xp).toBe(0);
    expect(r.flags).toEqual(["below_safe_minimum"]);
  });

  it("does not judge an unfinished day against the floor", () => {
    expect(nutritionDayXp({ ...day, mealsLogged: 1, totalKcal: 400, dayComplete: false }).xp).toBe(5);
  });
});
