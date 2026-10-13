import { describe, expect, it } from "vitest";
import { evaluateSet, evaluateWorkout, traceBudgetMs, workoutXp, xpDurationMinutes, XP_RULES, type AngleSample } from "../src";

/** Bug-hunt batch S1: XP duration plausibility, the per-day workout cap, and the real-time bound on camera traces. */

function squats(n: number): AngleSample[] {
  const out: AngleSample[] = [];
  let t = 0;
  for (let r = 0; r < n; r++) {
    for (let i = 0; i <= 10; i++) {
      const phase = i <= 5 ? i / 5 : (10 - i) / 5;
      out.push({ tMs: t, angleDeg: 170 - 80 * phase, confidence: 0.9 });
      t += 200;
    }
  }
  return out;
}

const base = { durationMinutes: 45, priorTrainingMinutesToday: 0, painLevel: "none" as const };

describe("A1-01: XP duration and the daily workout cap", () => {
  it("charges at least 3 seconds a rep", () => {
    expect(xpDurationMinutes(1, 200)).toBe(10);
    expect(xpDurationMinutes(1, 21)).toBe(2);
    expect(xpDurationMinutes(40, 200)).toBe(40);
    expect(xpDurationMinutes(5, 0)).toBe(5);
  });

  it("a tiny claimed duration can't hide a big workout from the 120-minute cap", () => {
    // 1,200 reps = 60 minutes at 3 s a rep; only 30 minutes are left today -> half the XP.
    const sets = Array.from({ length: 6 }, () => ({ reps: 200, verifiedReps: 0 }));
    const full = workoutXp({ ...base, durationMinutes: 1, sets });
    const capped = workoutXp({ ...base, durationMinutes: 1, priorTrainingMinutesToday: 90, sets });
    expect(full.flags).toEqual([]);
    expect(capped.flags).toEqual(["partially_capped"]);
    expect(capped.breakdown.cappedFraction).toBe(0.5);
    expect(capped.xp).toBe(Math.floor(full.xp * 0.5));
  });

  it("a real workout is unaffected by the pace floor", () => {
    const sets = [{ reps: 30, verifiedReps: 30 }];
    expect(workoutXp({ ...base, durationMinutes: 20, sets }).breakdown.cappedFraction).toBe(1);
    // 100 reps in 5 minutes is 3 s a rep: exactly at the floor.
    expect(workoutXp({ ...base, durationMinutes: 5, priorTrainingMinutesToday: 115, sets: [{ reps: 100, verifiedReps: 100 }] }).breakdown.cappedFraction).toBe(1);
  });

  it("awards no XP once the day already has the maximum number of XP-bearing workouts", () => {
    const sets = [{ reps: 10, verifiedReps: 10 }];
    expect(workoutXp({ ...base, priorXpWorkoutsToday: XP_RULES.dailyXpWorkoutsCap - 1, sets }).xp).toBeGreaterThan(0);
    const capped = workoutXp({ ...base, priorXpWorkoutsToday: XP_RULES.dailyXpWorkoutsCap, sets });
    expect(capped.xp).toBe(0);
    expect(capped.flags).toEqual(["daily_workout_cap_reached"]);
    // The workout's data is still described in full for the summary.
    expect(capped.breakdown.verifiedReps).toBe(10);
  });

  it("reports the stricter reason first: serious pain, then the training cap, then the workout cap", () => {
    const sets = [{ reps: 10, verifiedReps: 10 }];
    expect(workoutXp({ ...base, painLevel: "serious", priorXpWorkoutsToday: 3, sets }).flags).toEqual(["serious_pain_no_xp"]);
    expect(workoutXp({ ...base, priorTrainingMinutesToday: 120, priorXpWorkoutsToday: 3, sets }).flags).toEqual(["daily_training_cap_reached"]);
  });
});

describe("A1-02: traces must fit in real time", () => {
  const trace = (n: number) => ({ poseStatus: "ok" as const, samples: squats(n) }); // 2 s a rep

  it("budgets real time plus 10% and 30 seconds", () => {
    expect(traceBudgetMs(60_000)).toBe(96_000);
    expect(traceBudgetMs(0)).toBe(30_000);
    expect(traceBudgetMs(-5)).toBe(30_000);
  });

  it("rejects a set whose trace is longer than the budget: kept as unverified reps, with a clear status", () => {
    const set = evaluateSet({ exerciseId: "squat", reps: 50, loadKg: 60, trace: trace(50) }, 0, 30_000); // 100 s of trace
    expect(set).toMatchObject({ reps: 50, verifiedReps: 0, verificationStatus: "trace_exceeds_time", romPercent: null, formScore: null, analysis: null });
    expect(set.verifiedRepDetails).toEqual([]);
  });

  it("verifies the same set when it fits, and when no budget is given", () => {
    expect(evaluateSet({ exerciseId: "squat", reps: 5, loadKg: 60, trace: trace(5) }, 0, 30_000)).toMatchObject({ verifiedReps: 5, verificationStatus: "verified" });
    expect(evaluateSet({ exerciseId: "squat", reps: 50, loadKg: 60, trace: trace(50) }, 0)).toMatchObject({ verifiedReps: 50, verificationStatus: "verified" });
  });

  it("shares one budget across a workout's sets, in order", () => {
    // 1 minute -> 96 s. Each 20-rep set traces 40 s: the first two fit, the third doesn't.
    const { sets, award } = evaluateWorkout({
      ...base,
      durationMinutes: 1,
      sets: [1, 2, 3].map(() => ({ exerciseId: "squat", reps: 20, loadKg: 60, trace: trace(20) })),
    });
    expect(sets.map((s) => [s.verifiedReps, s.verificationStatus])).toEqual([
      [20, "verified"],
      [20, "verified"],
      [0, "trace_exceeds_time"],
    ]);
    expect(award.breakdown).toMatchObject({ verifiedReps: 40, unverifiedReps: 20 });
  });

  it("a set that doesn't fit doesn't use up budget the next, shorter set could use", () => {
    const { sets } = evaluateWorkout({
      ...base,
      durationMinutes: 1,
      sets: [
        { exerciseId: "squat", reps: 100, loadKg: 60, trace: trace(100) }, // 200 s: rejected
        { exerciseId: "squat", reps: 10, loadKg: 60, trace: trace(10) }, // 20 s: fits
      ],
    });
    expect(sets.map((s) => s.verificationStatus)).toEqual(["trace_exceeds_time", "verified"]);
  });
});
