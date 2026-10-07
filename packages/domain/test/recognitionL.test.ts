import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  BODY_QUEST_STATS,
  dailyStreak,
  detectSetRecords,
  evaluateAchievements,
  evaluateBodyQuest,
  formatRecordValue,
  improves,
  isRewardedRecord,
  judgeRecord,
  plannedRestDays,
  reachedMilestones,
  validateAchievementDefinition,
  weeklyStreak,
  weeksMeetingPlan,
  workoutStreak,
  type AchievementMetrics,
  type BodyQuestInput,
  type BodyQuestWorkout,
} from "../src";

describe("streaks", () => {
  it("a daily chain allows gaps up to the limit, and excused days never break it", () => {
    expect(dailyStreak(["2026-09-01", "2026-09-04"], "2026-09-04", { maxGapDays: 2 })).toMatchObject({ current: 2, longest: 2, activeToday: true, startDate: "2026-09-01" });
    expect(dailyStreak(["2026-09-01", "2026-09-05"], "2026-09-05", { maxGapDays: 2 }).current).toBe(1);
    expect(dailyStreak(["2026-09-01", "2026-09-05"], "2026-09-05", { maxGapDays: 2, excusedDates: ["2026-09-03"] }).current).toBe(2);
  });

  it("today is pending: a strict daily streak survives until today ends", () => {
    const s = dailyStreak(["2026-09-02", "2026-09-03"], "2026-09-04", { maxGapDays: 0 });
    expect(s).toMatchObject({ current: 2, activeToday: false, restDaysRemaining: 0 });
    expect(dailyStreak(["2026-09-02", "2026-09-03"], "2026-09-05", { maxGapDays: 0 }).current).toBe(0);
  });

  it("workout streaks respect the plan's scheduled rest", () => {
    expect(plannedRestDays(3)).toBe(2);
    expect(plannedRestDays(2)).toBe(3);
    expect(plannedRestDays(1)).toBe(6);
    expect(plannedRestDays(6)).toBe(2); // never stricter than two rest days
    const weekly = [{ localDate: "2026-09-01", painLevel: "none" }, { localDate: "2026-09-08", painLevel: "none" }, { localDate: "2026-09-15", painLevel: "none" }];
    expect(workoutStreak({ workouts: weekly, trainingDaysPerWeek: 1 }, "2026-09-15").current).toBe(3);
    expect(workoutStreak({ workouts: weekly, trainingDaysPerWeek: 3 }, "2026-09-15").current).toBe(1);
  });

  it("training with serious pain never extends a streak, and the recovery after it never breaks one", () => {
    const w = [
      { localDate: "2026-09-01", painLevel: "none" },
      { localDate: "2026-09-02", painLevel: "serious" },
      { localDate: "2026-09-08", painLevel: "none" },
    ];
    const s = workoutStreak({ workouts: w, trainingDaysPerWeek: 3 }, "2026-09-08");
    expect(s.current).toBe(2); // 3–5 Sep are recovery, 6–7 Sep are planned rest
    expect(workoutStreak({ workouts: [{ localDate: "2026-09-02", painLevel: "serious" }], trainingDaysPerWeek: 3 }, "2026-09-02").current).toBe(0);
  });

  it("weekly consistency counts consecutive weeks that met the plan; this week is pending", () => {
    const w = (d: string) => ({ localDate: d, painLevel: "none" });
    const workouts = ["2026-08-31", "2026-09-02", "2026-09-04", "2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14"].map(w);
    const met = weeksMeetingPlan({ workouts, trainingDaysPerWeek: 3 });
    expect(met.sort()).toEqual(["2026-08-31", "2026-09-07"]);
    expect(weeklyStreak(met, "2026-09-16")).toMatchObject({ current: 2, longest: 2, metThisWeek: false, startWeek: "2026-08-31" });
    expect(weeklyStreak(met, "2026-09-23").current).toBe(0); // last week was missed
  });

  it("names the milestones a chain has reached", () => {
    expect(reachedMilestones("workout", 8)).toEqual([3, 7]);
    expect(reachedMilestones("weekly", 4)).toEqual([2, 4]);
  });
});

describe("personal records", () => {
  it("compares in the metric's direction with its minimum step", () => {
    const lower = { direction: "lower" as const, minStep: 0 };
    expect(improves(lower, 9.5, 10)).toBe(true);
    expect(improves(lower, 10.5, 10)).toBe(false);
    expect(improves({ direction: "higher", minStep: 2 }, 91, 90)).toBe(false);
    expect(improves({ direction: "higher", minStep: 2 }, 92, 90)).toBe(true);
    expect(improves({ direction: "higher", minStep: 0 }, 5, null)).toBe(true);
  });

  it("the first value is a baseline; beating it is a record; big jumps are held for review", () => {
    expect(judgeRecord("max_load", 60, null)).toEqual({ kind: "max_load", value: 60, previous: null, status: "awarded" });
    expect(judgeRecord("max_load", 60, 60)).toBeNull();
    expect(judgeRecord("max_load", 70, 60)?.status).toBe("awarded");
    expect(judgeRecord("max_load", 90, 60)?.status).toBe("needs_review");
    expect(judgeRecord("best_form", 98, 70)?.status).toBe("awarded"); // bounded scores aren't jump-checked
    expect(isRewardedRecord({ kind: "max_load", previous: null, status: "awarded" })).toBe(false);
    expect(isRewardedRecord({ kind: "max_load", previous: 60, status: "awarded" })).toBe(true);
    expect(isRewardedRecord({ kind: "longest_streak", previous: 5, status: "awarded" })).toBe(false); // recognition only
  });

  it("detects load, rep, form and range-of-motion records from verified sets only", () => {
    expect(detectSetRecords({}, { loadKg: 50, verifiedReps: 0, formScore: 90 })).toEqual([]);
    const kinds = detectSetRecords({ max_load: 45, estimated_1rm: 55 }, { loadKg: 50, verifiedReps: 5, formScore: 91, romPercent: 97 }).map((r) => r.kind);
    expect(kinds).toEqual(["max_load", "estimated_1rm", "best_form", "best_rom"]);
    // Form and ROM need a few reps to mean something.
    expect(detectSetRecords({}, { loadKg: 0, verifiedReps: 2, formScore: 99, romPercent: 99 }).map((r) => r.kind)).toEqual(["max_reps"]);
    expect(formatRecordValue("best_form", 92)).toBe("form 92");
    expect(formatRecordValue("longest_streak", 1)).toBe("1 day");
  });
});

describe("achievements", () => {
  const zero: AchievementMetrics = { total_verified_reps: 0, workouts_completed: 0, good_form_reps: 0, weekly_consistency_streak: 0, prs_beaten: 0, nutrition_on_track_days: 0 };

  it("has a valid catalog with the required achievements", () => {
    for (const a of ACHIEVEMENTS) expect(validateAchievementDefinition(a)).toEqual([]);
    expect(ACHIEVEMENTS.map((a) => a.title)).toEqual(expect.arrayContaining(["First Rep", "First Workout", "Form Master", "Consistent", "PR Breaker", "Nutrition On Track"]));
  });

  it("moves from locked to in progress to unlocked, from real metrics", () => {
    const { statuses, newlyUnlocked } = evaluateAchievements(ACHIEVEMENTS, { ...zero, workouts_completed: 1, good_form_reps: 40 }, new Map());
    const by = (id: string) => statuses.find((s) => s.id === id)!;
    expect(by("first_rep").state).toBe("locked");
    expect(by("form_master")).toMatchObject({ state: "in_progress", progress: 40, target: 100 });
    expect(by("first_workout").state).toBe("unlocked");
    expect(newlyUnlocked.map((a) => a.id)).toEqual(["first_workout"]);
  });

  it("an unlock is permanent and never unlocks twice", () => {
    const unlocked = new Map([["first_workout", "2026-09-01T10:00:00Z"]]);
    const { statuses, newlyUnlocked } = evaluateAchievements(ACHIEVEMENTS, zero, unlocked);
    expect(statuses.find((s) => s.id === "first_workout")).toMatchObject({ state: "unlocked", unlockedAt: "2026-09-01T10:00:00Z" });
    expect(newlyUnlocked).toEqual([]);
  });
});

describe("Body Quest", () => {
  const set = (exerciseId: string, reps: number, verifiedReps = 0, loadKg = 0) => ({ exerciseId, reps, verifiedReps, loadKg });
  const workout = (localDate: string, sets: BodyQuestWorkout["sets"], durationMinutes = 40, painLevel = "none"): BodyQuestWorkout => ({ localDate, durationMinutes, painLevel, sets });
  const base = (over: Partial<BodyQuestInput> = {}): BodyQuestInput => ({ asOf: "2026-09-28", trainingDaysPerWeek: 3, workouts: [], verifiedReps: [], proteinDays: null, ...over });

  it("is honest about insufficient data and never guesses", () => {
    const r = evaluateBodyQuest(base());
    expect(r.stage).toBe("starter");
    expect(r.overall).toBeNull();
    for (const k of BODY_QUEST_STATS) expect(r.stats[k]).toMatchObject({ value: null, status: "insufficient_data" });
    expect(r.stats.strength.needs).toBe("verify_same_exercise_twice");
    expect(r.stats.form.needs).toBe("verify_more_reps");
  });

  it("strength is improvement over the user's own verified baseline", () => {
    const r = evaluateBodyQuest(base({ workouts: [workout("2026-09-01", [set("push_up", 10, 10)]), workout("2026-09-20", [set("push_up", 12, 12)])] }));
    expect(r.stats.strength).toMatchObject({ value: 40, status: "ok" }); // +20% of the +50% scale
    // Recorded (unverified) reps don't count.
    expect(evaluateBodyQuest(base({ workouts: [workout("2026-09-01", [set("push_up", 10, 0)]), workout("2026-09-20", [set("push_up", 30, 0)])] })).stats.strength.value).toBeNull();
  });

  it("volume, minutes and consistency are capped so more than planned never scores higher", () => {
    const days = Array.from({ length: 28 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    const lots = days.map((d) => workout(d, [set("squat", 10, 0, 60), set("bench_press", 10, 0, 40), set("row", 10, 0, 40), set("overhead_press", 10, 0, 20), set("bicep_curl", 10, 0, 10)], 200));
    const r = evaluateBodyQuest(base({ workouts: lots, trainingDaysPerWeek: 3 }));
    expect(r.stats.endurance.value).toBe(100);
    expect(r.stats.consistency.value).toBe(100);
    expect(r.stats.muscle.value).toBeLessThanOrEqual(100);
  });

  it("sessions with serious pain count toward nothing", () => {
    const w = [workout("2026-09-10", [set("push_up", 10, 10)]), workout("2026-09-25", [set("push_up", 14, 14)], 40, "serious")];
    expect(evaluateBodyQuest(base({ workouts: w })).stats.strength.value).toBeNull();
  });

  it("form and mobility come from verified reps; protein adds to muscle only with enough logged days", () => {
    const reps = Array.from({ length: 30 }, (_, i) => ({ localDate: "2026-09-20", painLevel: "none", formScore: i % 2 ? 90 : 80, romPercent: 95 }));
    const w = [workout("2026-09-08", [set("squat", 10, 0, 60)]), workout("2026-09-20", [set("squat", 10, 0, 60)])];
    const r = evaluateBodyQuest(base({ workouts: w, verifiedReps: reps }));
    expect(r.stats.form).toMatchObject({ value: 85, sample: 30 });
    expect(r.stats.mobility).toMatchObject({ value: 95 });
    const protein = Array.from({ length: 8 }, (_, i) => ({ localDate: `2026-09-${String(20 + i).padStart(2, "0")}`, hit: true }));
    const withProtein = evaluateBodyQuest(base({ workouts: w, verifiedReps: reps, proteinDays: protein }));
    expect(withProtein.stats.muscle.value!).toBeGreaterThan(r.stats.muscle.value!);
    expect(withProtein.stats.muscle.detail.proteinHitPercent).toBe(100);
  });

  it("stages need an overall score, stats with data, and weeks of history", () => {
    const days: string[] = [];
    for (let d = 0; d < 84; d += 2) days.push(new Date(Date.UTC(2026, 6, 6 + d)).toISOString().slice(0, 10));
    const w = days.map((d, i) => workout(d, [set("push_up", 10 + Math.floor(i / 6), 10 + Math.floor(i / 6)), set("squat", 10, 0, 40), set("row", 10, 0, 30), set("overhead_press", 8, 0, 15), set("bench_press", 8, 0, 30), set("bicep_curl", 10, 0, 8)], 50));
    const reps = days.slice(-12).flatMap((d) => Array.from({ length: 10 }, () => ({ localDate: d, painLevel: "none", formScore: 92, romPercent: 96 })));
    const r = evaluateBodyQuest(base({ asOf: days.at(-1)!, workouts: w, verifiedReps: reps }));
    expect(r.statsWithData).toBe(6);
    expect(r.historyWeeks).toBeGreaterThanOrEqual(11);
    expect(["athlete", "elite"]).toContain(r.stage);
    // The same performance with two weeks of history is capped by the history requirement.
    const short = evaluateBodyQuest(base({ asOf: days[6]!, workouts: w.slice(0, 7), verifiedReps: [] }));
    expect(["starter", "foundation"]).toContain(short.stage);
    expect(short.next?.requirements.find((q) => q.kind === "weeks")).toBeDefined();
  });

  it("never reads body weight: the input has no place for it", () => {
    const keys = Object.keys(base());
    expect(keys).not.toContain("weightKg");
    expect(keys.join(",")).not.toMatch(/weight|waist|photo/i);
  });
});
