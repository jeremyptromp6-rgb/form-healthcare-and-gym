import { describe, expect, it } from "vitest";
import { evaluateWorkout, isPlausibleLiveSet, MANUAL_XP_FACTOR, resolveSetMode, workoutXp, XP_RULES } from "../src";

const base = { durationMinutes: 40, priorTrainingMinutesToday: 0, painLevel: "none" as const };
const set = (over: Record<string, unknown> = {}) => ({ exerciseId: "push_up", reps: 10, loadKg: 0, ...over });
const xp = (sets: Parameters<typeof evaluateWorkout>[0]["sets"]) => evaluateWorkout({ ...base, sets }).award;

describe("set mode and XP", () => {
  it("a live set earns the full self-logged rate, a manual set half of it", () => {
    const live = xp([set({ mode: "live", liveSeconds: 40 })]);
    const manual = xp([set()]);
    const explicitManual = xp([set({ mode: "manual" })]);
    expect(live.breakdown.unverifiedRepXp).toBe(10 * XP_RULES.perUnverifiedRep);
    expect(manual.breakdown.unverifiedRepXp).toBe(10 * XP_RULES.perUnverifiedRep * MANUAL_XP_FACTOR);
    expect(explicitManual.xp).toBe(manual.xp);
    expect(live.xp).toBeGreaterThan(manual.xp);
    expect(live.xp).toBe(Math.floor(5 + 25));
    expect(manual.xp).toBe(Math.floor(2.5 + 25));
  });

  it("treats an implausible live set (under 1.5 s per rep) as manual", () => {
    expect(isPlausibleLiveSet(10, 15)).toBe(true);
    expect(isPlausibleLiveSet(10, 14)).toBe(false);
    const { sets, award } = evaluateWorkout({ ...base, sets: [set({ mode: "live", liveSeconds: 5 })] });
    expect(sets[0]).toMatchObject({ mode: "manual", liveSeconds: null });
    expect(award.xp).toBe(xp([set()]).xp);
  });

  it("keeps a plausible live set live and records its timer", () => {
    const { sets } = evaluateWorkout({ ...base, sets: [set({ mode: "live", liveSeconds: 30 })] });
    expect(sets[0]).toMatchObject({ mode: "live", liveSeconds: 30 });
  });

  it("a camera claim without server-verified reps is manual; verified reps make a camera set", () => {
    expect(resolveSetMode({ mode: "camera", reps: 8, verifiedReps: 0 })).toBe("manual");
    expect(resolveSetMode({ mode: undefined, reps: 8, verifiedReps: 3 })).toBe("camera");
    expect(resolveSetMode({ mode: "live", liveSeconds: 60, reps: 8, verifiedReps: 3 })).toBe("camera");
    expect(resolveSetMode({ reps: 8, verifiedReps: 0 })).toBe("manual");
    expect(resolveSetMode({ mode: "live", reps: 8, verifiedReps: 0 })).toBe("manual");
  });

  it("warm-up sets still earn nothing, live or manual", () => {
    const working = set({ mode: "live", liveSeconds: 40 });
    const plain = xp([working]);
    expect(xp([set({ reps: 30, warmup: true, mode: "live", liveSeconds: 90 }), working]).xp).toBe(plain.xp);
    expect(xp([set({ reps: 30, warmup: true }), working]).xp).toBe(plain.xp);
  });

  it("direct workoutXp callers without a mode are paid in full; the unverified cap still applies", () => {
    const plain = workoutXp({ ...base, sets: [{ reps: 10, verifiedReps: 0 }] });
    expect(plain.breakdown.unverifiedRepXp).toBe(5);
    const manual = workoutXp({ ...base, sets: [{ reps: 10, verifiedReps: 0, mode: "manual" }] });
    expect(manual.breakdown.unverifiedRepXp).toBe(2.5);
    const capped = workoutXp({ ...base, sets: [{ reps: 200, verifiedReps: 0, mode: "live" }] });
    expect(capped.breakdown.unverifiedRepXp).toBe(XP_RULES.unverifiedRepXpCap);
  });
});
