import { describe, expect, it } from "vitest";
import {
  activeXpFrom,
  classifyDay,
  CONSISTENCY_RULES,
  dayOutcome,
  daysUntilReset,
  daysWithoutTraining,
  decayAmount,
  lifetimeXpFrom,
  progressFromXp,
  QUESTS,
  resetThreshold,
  validateQuestDefinition,
  verifiedRepXp,
  workoutXp,
  XP_RULES,
  xpRequiredForLevel,
  type ConsistencyInput,
} from "../src";

const base = { durationMinutes: 45, priorTrainingMinutesToday: 0, painLevel: "none" as const };
const quality = (n: number, formScore: number, romPercent: number) => Array.from({ length: n }, () => ({ formScore, romPercent }));

describe("workout XP: completion, reps, form, ROM, PRs", () => {
  it("itemises every component", () => {
    const a = workoutXp({ ...base, sets: [{ reps: 10, verifiedReps: 8, repQuality: [...quality(6, 90, 100), ...quality(2, 70, 80)] }], personalRecords: 1 });
    expect(a.breakdown).toMatchObject({ verifiedRepXp: 16, unverifiedRepXp: 1, goodFormReps: 6, formXp: 3, fullRomReps: 6, romXp: 1.5, personalRecords: 1, prXp: 30, completionBonus: 25 });
    expect(a.xp).toBe(Math.floor(16 + 1 + 3 + 1.5 + 30 + 25));
  });

  it("verified reps have diminishing returns and a ceiling", () => {
    expect(verifiedRepXp(100)).toBe(200);
    expect(verifiedRepXp(200)).toBe(300);
    expect(verifiedRepXp(300)).toBe(350);
    expect(verifiedRepXp(1000)).toBe(350);
    const big = workoutXp({ ...base, durationMinutes: 120, sets: Array.from({ length: 10 }, () => ({ reps: 100, verifiedReps: 100 })) });
    expect(big.breakdown.verifiedRepXp).toBe(350);
  });

  it("caps self-logged reps, form, ROM and PR bonuses", () => {
    const a = workoutXp({ ...base, sets: [{ reps: 200, verifiedReps: 0 }, { reps: 200, verifiedReps: 200, repQuality: quality(200, 100, 100) }], personalRecords: 9 });
    expect(a.breakdown.unverifiedRepXp).toBe(XP_RULES.unverifiedRepXpCap);
    expect(a.breakdown.formXp).toBe(XP_RULES.goodFormXpCap);
    expect(a.breakdown.romXp).toBe(XP_RULES.fullRomXpCap);
    expect(a.breakdown.prXp).toBe(XP_RULES.perPersonalRecord * XP_RULES.maxPersonalRecordsRewarded);
  });

  it("quality can't be claimed for reps that weren't verified", () => {
    const a = workoutXp({ ...base, sets: [{ reps: 10, verifiedReps: 2, repQuality: quality(10, 100, 100) }] });
    expect(a.breakdown.goodFormReps).toBe(2);
  });

  it("never rewards unsafe training: serious pain earns nothing; the daily cap limits volume", () => {
    const pain = workoutXp({ ...base, painLevel: "serious", sets: [{ reps: 10, verifiedReps: 10, repQuality: quality(10, 100, 100) }], personalRecords: 2 });
    expect(pain.xp).toBe(0);
    const capped = workoutXp({ ...base, priorTrainingMinutesToday: 120, sets: [{ reps: 10, verifiedReps: 10 }] });
    expect(capped).toMatchObject({ xp: 0, flags: ["daily_training_cap_reached"] });
  });
});

describe("levels and the level display", () => {
  it("LEVEL n — into / span XP", () => {
    const p = progressFromXp(xpRequiredForLevel(13) + 250);
    expect(p.level).toBe(13);
    expect(p.xpIntoLevel).toBe(250);
    expect(p.xpForNextLevel).toBe(xpRequiredForLevel(14) - xpRequiredForLevel(13));
    expect(p.rank).toBe("Athlete");
  });
});

describe("XP ledger math", () => {
  it("active XP restarts after a reset; lifetime XP keeps everything earned", () => {
    const events = [
      { kind: "award" as const, xp: 200 },
      { kind: "decay" as const, xp: -10 },
      { kind: "reset" as const, xp: 0 },
      { kind: "award" as const, xp: 40 },
      { kind: "adjustment" as const, xp: -15 },
    ];
    expect(activeXpFrom(events)).toBe(25);
    expect(lifetimeXpFrom(events)).toBe(225);
    expect(activeXpFrom([{ kind: "decay", xp: -50 }])).toBe(0);
  });
});

// A plan of 3 training days a week. Week of Mon 2026-09-28 … Sun 2026-10-04.
const plan = (workoutDates: string[], seriousPainDates: string[] = [], trainingDaysPerWeek: number | null = 3): ConsistencyInput => ({ workoutDates, seriousPainDates, trainingDaysPerWeek });

describe("missed days vs planned rest", () => {
  it("rest days are flexible: a day is missed only once the week can't fit the sessions still owed", () => {
    const input = plan(["2026-09-21"]); // first workout the week before
    const kinds = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((d) => classifyDay(d, input, "2026-09-21"));
    // Mon–Thu can still be rest (3 sessions fit Fri–Sun); from Fri the week can't be met.
    expect(kinds).toEqual(["rest", "rest", "rest", "rest", "missed", "missed", "missed"]);
  });

  it("training on time means no missed days at all", () => {
    const input = plan(["2026-09-21", "2026-09-29", "2026-10-01", "2026-10-03"]);
    const kinds = ["2026-09-28", "2026-09-30", "2026-10-02", "2026-10-04"].map((d) => classifyDay(d, input, "2026-09-21"));
    expect(kinds).toEqual(["rest", "rest", "rest", "rest"]);
  });

  it("recovery after serious pain is protected and lowers the week's target", () => {
    const input = plan(["2026-09-21", "2026-09-28"], ["2026-09-28"]);
    expect(classifyDay("2026-09-29", input, "2026-09-21")).toBe("recovery");
    expect(classifyDay("2026-10-01", input, "2026-09-21")).toBe("recovery");
    // 3 planned − 1 trained − 3 recovery days ⇒ nothing owed this week.
    expect(classifyDay("2026-10-04", input, "2026-09-21")).toBe("rest");
  });

  it("nothing before the first workout", () => {
    expect(classifyDay("2026-09-25", plan(["2026-09-27"]), "2026-09-27")).toBe("before_start");
  });
});

describe("decay and reset", () => {
  it("decay is small and never takes active XP below zero", () => {
    expect(decayAmount(500)).toBe(CONSISTENCY_RULES.decayPerMissedDay);
    expect(decayAmount(4)).toBe(4);
    expect(decayAmount(0)).toBe(0);
  });

  it("the reset threshold is 5 days, longer only for plans that need longer gaps", () => {
    expect(resetThreshold(3)).toBe(5);
    expect(resetThreshold(2)).toBe(5);
    expect(resetThreshold(1)).toBe(6);
    expect(resetThreshold(null)).toBe(5);
  });

  it("counts days without training from the last workout or reset, skipping recovery days", () => {
    expect(daysWithoutTraining("2026-10-04", plan(["2026-09-28"]), null)).toBe(6);
    expect(daysWithoutTraining("2026-10-04", plan(["2026-09-28"]), "2026-10-02")).toBe(2);
    expect(daysWithoutTraining("2026-10-04", plan(["2026-09-28"], ["2026-09-28"]), null)).toBe(3); // 3 recovery days don't count
  });

  it("day outcome: reset once the gap passes the threshold (if there's progress to reset), else decay for a missed day", () => {
    const input = { ...plan(["2026-09-21", "2026-09-28"]), firstWorkout: "2026-09-21", lastReset: null, activeXp: 300 };
    expect(dayOutcome({ ...input, date: "2026-10-03" })).toEqual({ kind: "decay", amount: 10 }); // gap 5, Sat missed
    expect(dayOutcome({ ...input, date: "2026-10-04" })).toEqual({ kind: "reset", gapDays: 6, threshold: 5 });
    expect(dayOutcome({ ...input, date: "2026-10-04", activeXp: 0 })).toEqual({ kind: "none" }); // nothing to reset or decay
    expect(dayOutcome({ ...input, date: "2026-09-30" })).toEqual({ kind: "none" }); // planned rest
  });

  it("tells the user how long they have", () => {
    expect(daysUntilReset("2026-09-30", plan(["2026-09-28"]), null)).toBe(5); // trained Mon → train by Sat to keep progress
    expect(daysUntilReset("2026-10-03", plan(["2026-09-28"]), null)).toBe(2);
    expect(daysUntilReset("2026-09-30", plan([]), null)).toBeNull();
  });
});

describe("quests", () => {
  it("the catalog includes Form Master, Consistency, Protein Target and Personal Best — all valid and capped", () => {
    const titles = QUESTS.map((q) => q.title).join(" | ");
    expect(titles).toMatch(/Form Master/);
    expect(titles).toMatch(/Consistency/);
    expect(titles).toMatch(/Protein Target/);
    expect(titles).toMatch(/Personal Best/);
    for (const q of QUESTS) expect(validateQuestDefinition(q)).toEqual([]);
    expect(validateQuestDefinition({ id: "greedy", title: "x", cadence: "daily", metric: "prs_awarded", target: 50, xpReward: 10 })).toContain("target_out_of_range");
  });
});
