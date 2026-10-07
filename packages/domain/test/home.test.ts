import { describe, expect, it } from "vitest";
import {
  daysBetween,
  DomainValidationError,
  evaluateQuest,
  isValidTimeZone,
  localDateIn,
  localHourIn,
  QUESTS,
  questsFor,
  suggestToday,
  validateQuestDefinition,
  waterTargetMl,
  weekStart,
  type QuestMetrics,
} from "../src";

describe("authoritative local date", () => {
  const instant = new Date("2026-09-27T11:30:00Z");

  it("resolves the calendar date in the user's zone, including UTC+14 and UTC−11", () => {
    expect(localDateIn("UTC", instant)).toBe("2026-09-27");
    expect(localDateIn("Pacific/Kiritimati", new Date("2026-09-27T10:30:00Z"))).toBe("2026-09-28"); // UTC+14
    expect(localDateIn("Pacific/Pago_Pago", new Date("2026-09-27T10:30:00Z"))).toBe("2026-09-26"); // UTC−11
    expect(localDateIn("Asia/Kolkata", new Date("2026-09-27T18:29:00Z"))).toBe("2026-09-27"); // 23:59 IST
    expect(localDateIn("Asia/Kolkata", new Date("2026-09-27T18:31:00Z"))).toBe("2026-09-28"); // 00:01 IST
  });

  it("follows daylight saving transitions", () => {
    // New York falls back on 2026-11-01 at 06:00 UTC; 04:30 UTC is still Oct 31 local.
    expect(localDateIn("America/New_York", new Date("2026-11-01T03:30:00Z"))).toBe("2026-10-31");
    expect(localDateIn("America/New_York", new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01");
    expect(localHourIn("America/New_York", new Date("2026-07-01T16:00:00Z"))).toBe(12);
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(() => localDateIn("Nope/Nope", instant)).toThrow(DomainValidationError);
  });

  it("finds the Monday of a week, across month and year boundaries", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday → previous Monday
    expect(weekStart("2026-09-21")).toBe("2026-09-21"); // Monday → itself
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // Friday in a week spanning new year
    expect(daysBetween("2026-09-21", "2026-09-27")).toBe(6);
  });
});

describe("water target", () => {
  it("scales with body weight within safe bounds", () => {
    expect(waterTargetMl(70)).toEqual({ targetMl: 2450, basis: "body_weight" });
    expect(waterTargetMl(35)).toEqual({ targetMl: 1500, basis: "body_weight" });
    expect(waterTargetMl(200)).toEqual({ targetMl: 4000, basis: "body_weight" });
    expect(waterTargetMl(null)).toEqual({ targetMl: 2000, basis: "default" });
  });
});

describe("quest catalog and engine", () => {
  it("every live quest passes the safety validator", () => {
    for (const q of QUESTS) expect(validateQuestDefinition(q), q.id).toEqual([]);
  });

  it("personalizes the weekly training quest to the user's plan, always leaving a rest day", () => {
    const base = { today: "2026-09-27", weekStart: "2026-09-21", hasNutritionTargets: true, cameraVerificationAvailable: false };
    const train = (days: number | null) => questsFor({ ...base, trainingDaysPerWeek: days }).find((q) => q.id === "weekly_train")!;
    expect(train(4)).toMatchObject({ target: 4, title: "Consistency: train 4 days this week", periodKey: "2026-09-21" });
    expect(train(7).target).toBe(6);
    expect(train(null).target).toBe(3);
  });

  it("only offers quests the user can actually complete", () => {
    const ids = (hasNutritionTargets: boolean, cameraVerificationAvailable: boolean) =>
      questsFor({ today: "2026-09-27", weekStart: "2026-09-21", trainingDaysPerWeek: 3, hasNutritionTargets, cameraVerificationAvailable }).map((q) => q.id);
    expect(ids(false, false)).not.toContain("daily_protein");
    expect(ids(false, false)).not.toContain("weekly_verified_reps");
    expect(ids(true, true)).toEqual(expect.arrayContaining(["daily_protein", "weekly_verified_reps"]));
  });

  it("evaluates progress, capped at the target", () => {
    const [meals] = questsFor({ today: "2026-09-27", weekStart: "2026-09-21", trainingDaysPerWeek: 3, hasNutritionTargets: false, cameraVerificationAvailable: false });
    const metrics = { meals_logged: 5 } as QuestMetrics;
    expect(evaluateQuest(meals!, metrics)).toMatchObject({ id: "daily_log_meals", progress: 3, target: 3, completed: true, periodKey: "2026-09-27" });
    expect(evaluateQuest(meals!, { meals_logged: 1 } as QuestMetrics)).toMatchObject({ progress: 1, completed: false });
  });
});

describe("today suggestion", () => {
  const base = { today: "2026-09-24", weekStart: "2026-09-21", plannedDaysPerWeek: 4, workoutDates: [] as string[], seriousPainDates: [] as string[] };

  it("prioritises recovery after serious pain", () => {
    expect(suggestToday({ ...base, seriousPainDates: ["2026-09-23"], workoutDates: ["2026-09-21"] }).kind).toBe("recover");
    expect(suggestToday({ ...base, seriousPainDates: ["2026-09-20"] }).kind).toBe("train");
  });

  it("recognises a finished day and a finished week", () => {
    expect(suggestToday({ ...base, workoutDates: ["2026-09-24"] }).kind).toBe("done_today");
    expect(suggestToday({ ...base, workoutDates: ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-21"], plannedDaysPerWeek: 3 }).kind).toBe("weekly_goal_met");
  });

  it("suggests rest after training only when the plan still fits", () => {
    // Thu, 1 of 4 done yesterday; 3 left over 4 days (Thu–Sun) → rest fits.
    expect(suggestToday({ ...base, workoutDates: ["2026-09-23"] })).toMatchObject({ kind: "rest_suggested" });
    // Sat, 2 of 4 done (Thu, Fri); 2 left over 2 days → must train.
    expect(suggestToday({ ...base, today: "2026-09-26", workoutDates: ["2026-09-24", "2026-09-25"] }).kind).toBe("train");
  });

  it("gives a first action to a brand-new user", () => {
    expect(suggestToday({ ...base, plannedDaysPerWeek: null })).toEqual({ kind: "train", title: "Train today", reason: "Log a workout to start building your streak." });
  });

  it("ignores future-dated workouts and last week's", () => {
    expect(suggestToday({ ...base, workoutDates: ["2026-09-25", "2026-09-18"] }).reason).toBe("0 of 4 planned sessions done this week.");
  });
});
