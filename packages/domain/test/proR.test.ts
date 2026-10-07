import { describe, expect, it } from "vitest";
import {
  adaptiveGenerator,
  bodyQuestInsights,
  buildWeeklyReport,
  formIntelligence,
  ruleBasedGenerator,
  type AdaptiveInput,
  type BodyQuestResult,
  type ExerciseSession,
  type FormRepRow,
  type WeeklyReportInput,
} from "../src";

// ---- Adaptive training ---------------------------------------------------------------------------

const base: Omit<AdaptiveInput, "history" | "previous" | "consistency"> = {
  date: "2026-10-05",
  goal: "build_muscle",
  experience: "intermediate",
  equipment: ["barbell", "dumbbells", "bench"],
  trainingDaysPerWeek: 3,
  sessionsThisWeek: 0,
  daysSinceLastWorkout: 2,
  recentSeriousPain: false,
};
const session = (over: Partial<ExerciseSession> = {}): ExerciseSession => ({ localDate: "2026-10-03", painLevel: "none", sets: [{ reps: 12, loadKg: 60 }, { reps: 12, loadKg: 60 }, { reps: 12, loadKg: 60 }], formScore: 88, romPercent: 95, verifiedReps: 36, ...over });

/** Builds input where the plan's squat-pattern exercise has `history` (newest first). */
function inputWith(history: ExerciseSession[], consistency = { plannedDays: 6, completedDays: 6 }): AdaptiveInput & { exerciseId: string } {
  const probe = ruleBasedGenerator.generate({ ...base, previous: {} });
  const exerciseId = probe.exercises.find((e) => e.exerciseId.includes("squat"))?.exerciseId ?? probe.exercises[0]!.exerciseId;
  const latest = history[0]!;
  return {
    ...base,
    previous: { [exerciseId]: { localDate: latest.localDate, painLevel: latest.painLevel, sets: latest.sets, averageRomPercent: latest.romPercent } },
    history: { [exerciseId]: history },
    consistency,
    exerciseId,
  };
}
const planned = (i: ReturnType<typeof inputWith>) => adaptiveGenerator.generate(i).exercises.find((e) => e.exerciseId === i.exerciseId)!;

describe("adaptive training — progress when earned", () => {
  it("progresses when reps, form and range of motion are all strong, and says why", () => {
    const p = planned(inputWith([session(), session({ localDate: "2026-10-01", formScore: 86 })]));
    expect(p.progression).toBe("increase_load");
    expect(p.targetLoadKg).toBeGreaterThan(60);
    expect(p.note).toMatch(/Earned: .* form \(88, range 95%\)/);
  });

  it("holds the load when performance went up but form went down", () => {
    const p = planned(inputWith([session({ sets: [{ reps: 12, loadKg: 65 }, { reps: 12, loadKg: 65 }, { reps: 12, loadKg: 65 }], formScore: 72 }), session({ localDate: "2026-10-01", formScore: 86 })]));
    expect(p.progression).toBe("hold_for_form");
    expect(p.targetLoadKg).toBe(65);
    expect(p.note).toContain("form dropped from 86 to 72");
  });

  it("won't add weight on weak form even at the top of the range", () => {
    const p = planned(inputWith([session({ formScore: 70 })]));
    expect(p.progression).toBe("hold_for_form");
    expect(p.targetLoadKg).toBe(60);
  });

  it("steps back a little after two sessions short of the range at the same load", () => {
    const short = session({ sets: [{ reps: 6, loadKg: 60 }, { reps: 5, loadKg: 60 }, { reps: 5, loadKg: 60 }], formScore: 85 });
    const p = planned(inputWith([short, { ...short, localDate: "2026-10-01" }]));
    expect(p.progression).toBe("deload");
    expect(p.targetLoadKg!).toBeLessThan(60);
  });

  it("adapts volume, not loads, when consistency drops", () => {
    const i = inputWith([session()], { plannedDays: 6, completedDays: 2 });
    const plan = adaptiveGenerator.generate(i);
    const free = ruleBasedGenerator.generate(i);
    expect(plan.exercises.every((e, n) => e.sets === Math.max(2, free.exercises[n]!.sets - (free.exercises[n]!.sets > 2 ? 1 : 0)))).toBe(true);
    expect(plan.notes.join(" ")).toContain("2 of 6 planned days");
  });

  it("never invents form: without camera data it progresses on performance and asks for a tracked set", () => {
    const p = planned(inputWith([session({ formScore: null, romPercent: null, verifiedReps: 0 })]));
    expect(p.progression).toBe("increase_load");
    expect(p.note).toContain("Track a set with the camera");
  });

  it("keeps the safety rules: a deload after pain stands", () => {
    const i = { ...inputWith([session({ painLevel: "serious" })]), recentSeriousPain: true };
    expect(planned(i).progression).toBe("deload");
    expect(adaptiveGenerator.generate(i).generator.id).toBe("adaptive");
  });
});

// ---- Form intelligence --------------------------------------------------------------------------

const rep = (workoutId: string, localDate: string, loadKg: number, formScore: number, romPercent: number, issues: FormRepRow["issues"] = []): FormRepRow => ({ workoutId, localDate, loadKg, formScore, romPercent, issues });

describe("form intelligence", () => {
  it("builds history, trends, issue changes and form by load from verified reps only", () => {
    const rows: FormRepRow[] = [
      ...Array.from({ length: 6 }, () => rep("w1", "2026-09-10", 60, 90, 96, ["torso_lean"])),
      ...Array.from({ length: 6 }, () => rep("w2", "2026-09-17", 60, 91, 97, ["torso_lean"])),
      ...Array.from({ length: 6 }, () => rep("w3", "2026-09-24", 70, 78, 92)),
      ...Array.from({ length: 6 }, () => rep("w4", "2026-10-01", 70, 76, 91)),
    ];
    const f = formIntelligence(rows, { from: "2026-09-04", to: "2026-10-02" });
    expect(f.sessions.map((s) => [s.localDate, s.topLoadKg, s.formScore])).toEqual([["2026-09-10", 60, 90], ["2026-09-17", 60, 91], ["2026-09-24", 70, 78], ["2026-10-01", 70, 76]]);
    expect(f.formTrend.direction).toBe("declining");
    expect(f.byLoad).toEqual([expect.objectContaining({ loadKg: 60, formScore: 91 }), expect.objectContaining({ loadKg: 70, formScore: 77 })]);
    expect(f.insights.join(" ")).toContain("Form drops at heavier loads: 91 at 60 kg vs 77 at 70 kg");
    expect(f.issues[0]).toMatchObject({ code: "torso_lean", label: "Torso position", earlierPercent: 100, recentPercent: 0, change: "fewer" });
    expect(f.reps).toBe(24);
  });

  it("says nothing it can't support", () => {
    const f = formIntelligence([rep("w1", "2026-10-01", 0, 85, 95)], { from: "2026-09-04", to: "2026-10-02" });
    expect(f.formTrend.direction).toBe("insufficient_data");
    expect(f.insights).toEqual([]);
    expect(formIntelligence([], { from: "2026-09-04", to: "2026-10-02" })).toMatchObject({ sessions: [], reps: 0, insights: [] });
  });
});

// ---- Weekly report -----------------------------------------------------------------------------

const week = (over: Partial<WeeklyReportInput> = {}): WeeklyReportInput => ({
  weekStart: "2026-09-28",
  weekEnd: "2026-10-04",
  training: { workouts: 3, trainingDays: 3, plannedDays: 3, minutes: 120, verifiedReps: 80, averageFormScore: 86, averageRomPercent: 94 },
  previousTraining: { workouts: 2, trainingDays: 2, plannedDays: 3, minutes: 80, verifiedReps: 50, averageFormScore: 80, averageRomPercent: 90 },
  recordsBeaten: [{ exercise: "Squat", label: "Heaviest weight", display: "70 kg" }],
  nutrition: { daysLogged: 6, hasTargets: true, proteinDaysMet: 5, daysOnTarget: 4, daysBelowSafeMinimum: 0 },
  xp: { earned: 340, levelAtEnd: 6, rankAtEnd: "Starter" },
  bodyQuest: { stageAtStart: "starter", stageAtEnd: "foundation", overallAtStart: 28, overallAtEnd: 36 },
  ...over,
});

describe("weekly report", () => {
  it("summarises the week from the numbers it's given, with a change on last week", () => {
    const r = buildWeeklyReport(week());
    expect(r.training.change).toEqual({ workouts: 1, verifiedReps: 30, formScore: 6 });
    expect(r.highlights).toEqual([
      "3 workouts on 3 days (plan: 3), 120 minutes in total.",
      "80 camera-verified reps at an average form score of 86 and 94% range of motion.",
      "Form improved from 80 to 86 on last week.",
      "1 record beaten: Squat heaviest weight 70 kg.",
      "Protein target met on 5 of 6 logged days.",
      "340 XP earned — level 6, Starter.",
      "Body Quest: reached foundation.",
    ]);
    expect(r.focus).toMatch(/^Keep going/);
  });

  it("puts safety first, then the biggest gap", () => {
    expect(buildWeeklyReport(week({ nutrition: { daysLogged: 6, hasTargets: true, proteinDaysMet: 5, daysOnTarget: 2, daysBelowSafeMinimum: 2 } })).focus).toMatch(/^Eat enough: 2 days/);
    expect(buildWeeklyReport(week({ training: { ...week().training, trainingDays: 1, workouts: 1 } })).focus).toMatch(/^Consistency: 1 of 3/);
    expect(buildWeeklyReport(week({ training: { ...week().training, averageFormScore: 70 } })).focus).toMatch(/^Form: your average was 70/);
  });

  it("is honest about a quiet week — no zeros dressed as achievements", () => {
    const r = buildWeeklyReport(week({ training: { workouts: 0, trainingDays: 0, plannedDays: 3, minutes: 0, verifiedReps: 0, averageFormScore: null, averageRomPercent: null }, previousTraining: null, recordsBeaten: [], nutrition: { daysLogged: 0, hasTargets: true, proteinDaysMet: 0, daysOnTarget: 0, daysBelowSafeMinimum: 0 }, xp: { earned: 0, levelAtEnd: 6, rankAtEnd: "Starter" }, bodyQuest: null }));
    expect(r.empty).toBe(true);
    expect(r.highlights).toEqual([]);
    expect(r.focus).toMatch(/^Get one session in/);
  });
});

// ---- Body Quest insights -----------------------------------------------------------------------

describe("Body Quest insights", () => {
  const stat = (value: number | null, detail: Record<string, number> = {}) => ({ value, status: value === null ? ("insufficient_data" as const) : ("ok" as const), sample: 10, needs: null, detail });
  const live = { stats: { strength: stat(40), muscle: stat(55, { setsPerWeek: 18 }), endurance: stat(62, { minutesPerWeek: 93 }), mobility: stat(88), form: stat(84), consistency: stat(null) } } as unknown as Pick<BodyQuestResult, "stats">;
  const snaps = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map((weekStart, i) => ({ weekStart, stats: { strength: 30 + i * 3, muscle: 50, endurance: 60, mobility: 85, form: 80 + i, consistency: null } }));

  it("shows each stat's weekly history and change, the stat to work on, and exactly what moves it", () => {
    const r = bodyQuestInsights(live, snaps);
    expect(r.stats.find((s) => s.stat === "strength")).toMatchObject({ value: 40, change4w: 10, history: [{ weekStart: "2026-09-07", value: 30 }, expect.anything(), expect.anything(), { weekStart: "2026-09-28", value: 39 }] });
    expect(r.stats.find((s) => s.stat === "endurance")!.lever).toBe("Active minutes each week, up to 150 (now 93).");
    expect(r.focus).toMatchObject({ stat: "strength", value: 40 });
    expect(r.focus!.lever).toMatch(/^Strength \(40\) is your lowest stat\./);
    expect(r.strongest).toEqual({ stat: "mobility", value: 88 });
    expect(r.stats.find((s) => s.stat === "consistency")!.change4w).toBeNull(); // not measurable: no change claimed
  });
});
