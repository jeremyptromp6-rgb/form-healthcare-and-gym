import { describe, expect, it } from "vitest";
import { DomainValidationError, evaluateWorkout, type AngleSample } from "../src";

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

const base = { durationMinutes: 30, priorTrainingMinutesToday: 0, painLevel: "none" as const };

describe("Workout Engine", () => {
  it("verifies traced sets, leaves untraced sets unverified, and awards XP", () => {
    const { sets, award } = evaluateWorkout({
      ...base,
      sets: [
        { exerciseId: "squat", reps: 4, loadKg: 60, trace: { poseStatus: "ok", samples: squats(4) } },
        { exerciseId: "bench_press", reps: 8, loadKg: 70 },
      ],
    });
    expect(sets.map((s) => [s.setIndex, s.verifiedReps, s.verificationStatus])).toEqual([
      [0, 4, "verified"],
      [1, 0, "not_tracked"],
    ]);
    expect(sets[0]!.verifiedRepDetails).toHaveLength(4);
    // Verified reps, recorded reps, completion — plus form and range-of-motion bonuses from the server's analysis.
    expect(award.breakdown).toMatchObject({ verifiedReps: 4, unverifiedReps: 8, verifiedRepXp: 8, unverifiedRepXp: 4, completionBonus: 25 });
    expect(award.xp).toBe(Math.floor(4 * 2 + 8 * 0.5 + 25 + award.breakdown.formXp + award.breakdown.romXp));
    expect(award.breakdown.goodFormReps + award.breakdown.fullRomReps).toBeGreaterThan(0);
  });

  it("never verifies more reps than the user reported", () => {
    const { sets } = evaluateWorkout({ ...base, sets: [{ exerciseId: "squat", reps: 2, loadKg: 0, trace: { poseStatus: "ok", samples: squats(5) } }] });
    expect(sets[0]!.verifiedReps).toBe(2);
    expect(sets[0]!.verifiedRepDetails).toHaveLength(2);
  });

  it("marks a trace for an exercise without ROM rules as unsupported", () => {
    const { sets } = evaluateWorkout({ ...base, sets: [{ exerciseId: "deadlift", reps: 5, loadKg: 100, trace: { poseStatus: "ok", samples: squats(5) } }] });
    expect(sets[0]).toMatchObject({ verificationStatus: "unsupported_exercise", verifiedReps: 0 });
  });

  it("rejects unknown exercises", () => {
    expect(() => evaluateWorkout({ ...base, sets: [{ exerciseId: "nope", reps: 5, loadKg: 0 }] })).toThrow(DomainValidationError);
  });
});
