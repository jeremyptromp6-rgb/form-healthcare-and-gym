import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  MAX_LEVEL,
  nutritionDayXp,
  PRESTIGE_STEP_XP,
  progressFromXp,
  RANKS,
  rankForLevel,
  rankLabel,
  workoutXp,
  xpRequiredForLevel,
} from "../src";

describe("endless Champion prestige", () => {
  const top = xpRequiredForLevel(MAX_LEVEL);

  it("has no prestige below the top and keeps the per-level step", () => {
    const p = progressFromXp(top - 1);
    expect(p.level).toBe(MAX_LEVEL - 1);
    expect(p.prestige).toBeNull();
    expect(p.xpIntoStep).toBe(p.xpIntoLevel);
    expect(p.xpForStep).toBe(p.xpForNextLevel);
    expect(progressFromXp(0)).toMatchObject({ prestige: null, xpIntoStep: 0, xpForStep: xpRequiredForLevel(2) });
  });

  it("is Champion 1 exactly at the max-level threshold, then +1 per step", () => {
    expect(progressFromXp(top)).toMatchObject({ level: MAX_LEVEL, rank: "Champion", prestige: 1, xpIntoStep: 0, xpForStep: PRESTIGE_STEP_XP, xpForNextLevel: 0, fractionToNext: 1 });
    expect(progressFromXp(top + PRESTIGE_STEP_XP - 1)).toMatchObject({ prestige: 1, xpIntoStep: PRESTIGE_STEP_XP - 1 });
    expect(progressFromXp(top + PRESTIGE_STEP_XP)).toMatchObject({ prestige: 2, xpIntoStep: 0 });
    expect(progressFromXp(top + 9 * PRESTIGE_STEP_XP + 5)).toMatchObject({ prestige: 10, xpIntoStep: 5 });
  });

  it("labels the rank", () => {
    expect(rankLabel("Champion", 3)).toBe("Champion 3");
    expect(rankLabel("Iron", null)).toBe("Iron");
  });

  it("stays modest: a year of a max-capped workout every day is well under 100", () => {
    const day = workoutXp({
      sets: [{ reps: 200, verifiedReps: 200, repQuality: Array.from({ length: 200 }, () => ({ formScore: 100, romPercent: 100 })) }, { reps: 100, verifiedReps: 100, repQuality: Array.from({ length: 100 }, () => ({ formScore: 100, romPercent: 100 })) }],
      durationMinutes: 60,
      priorTrainingMinutesToday: 0,
      painLevel: "none",
      personalRecords: 3,
    }).xp + nutritionDayXp({ mealsLogged: 4, totalKcal: 2000, targetKcal: 2000, safeFloorKcal: 1200, dayComplete: true }).xp;
    const prestige = progressFromXp(day * 365).prestige;
    expect(prestige).not.toBeNull();
    expect(prestige!).toBeLessThan(60);
    expect(PRESTIGE_STEP_XP).toBeLessThanOrEqual(3 * (xpRequiredForLevel(MAX_LEVEL) - xpRequiredForLevel(MAX_LEVEL - 1)));
  });
});

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
