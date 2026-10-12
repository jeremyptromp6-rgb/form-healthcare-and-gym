import { describe, expect, it } from "vitest";
import {
  initialPostWorkoutAd,
  nextPostWorkoutAdState,
  POST_WORKOUT_FRESH_MS,
  POST_WORKOUT_RESERVATION_MS,
  postWorkoutAdEligibility,
  postWorkoutAdReducer,
  type PostWorkoutAdMachine,
  type PostWorkoutAdRecord,
} from "../src";

const NOW = new Date("2026-10-12T18:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base = { isPro: false, workout: { completedAt: ago(60_000) }, now: NOW, existingForWorkout: null, today: [] as PostWorkoutAdRecord[] };

describe("postWorkoutAdEligibility", () => {
  it("is eligible for a Free user's fresh workout with nothing shown today", () => {
    expect(postWorkoutAdEligibility(base)).toEqual({ eligible: true, resume: false });
  });

  it("Pro is never eligible, checked before anything else", () => {
    expect(postWorkoutAdEligibility({ ...base, isPro: true, workout: null })).toEqual({ eligible: false, reason: "pro_user" });
  });

  it("needs a committed, recent workout", () => {
    expect(postWorkoutAdEligibility({ ...base, workout: null })).toMatchObject({ reason: "workout_not_found" });
    expect(postWorkoutAdEligibility({ ...base, workout: { completedAt: ago(POST_WORKOUT_FRESH_MS + 1) } })).toMatchObject({ reason: "workout_not_recent" });
    expect(postWorkoutAdEligibility({ ...base, workout: { completedAt: new Date(NOW.getTime() + 60_000) } })).toMatchObject({ reason: "workout_not_recent" });
  });

  it("one per local day: a shown or dismissed ad, or a live reservation, uses the day", () => {
    for (const state of ["shown", "dismissed"] as const) {
      expect(postWorkoutAdEligibility({ ...base, today: [{ workoutId: "w0", state, createdAt: ago(5 * 3600_000) }] })).toMatchObject({ reason: "daily_cap" });
    }
    expect(postWorkoutAdEligibility({ ...base, today: [{ workoutId: "w0", state: "reserved", createdAt: ago(60_000) }] })).toMatchObject({ reason: "daily_cap" });
  });

  it("a failed ad or an expired reservation doesn't use the day", () => {
    expect(postWorkoutAdEligibility({ ...base, today: [{ workoutId: "w0", state: "failed", createdAt: ago(60_000) }] }).eligible).toBe(true);
    expect(
      postWorkoutAdEligibility({ ...base, today: [{ workoutId: "w0", state: "reserved", createdAt: ago(POST_WORKOUT_RESERVATION_MS + 1) }] }).eligible,
    ).toBe(true);
  });

  it("the same workout asked again resumes a live reservation, otherwise it's already handled", () => {
    const live = { workoutId: "w1", state: "reserved" as const, createdAt: ago(1000) };
    expect(postWorkoutAdEligibility({ ...base, existingForWorkout: live, today: [live] })).toEqual({ eligible: true, resume: true });
    expect(postWorkoutAdEligibility({ ...base, existingForWorkout: { ...live, state: "shown" } })).toMatchObject({ reason: "already_handled" });
    expect(postWorkoutAdEligibility({ ...base, existingForWorkout: { ...live, state: "failed" } })).toMatchObject({ reason: "already_handled" });
  });
});

describe("nextPostWorkoutAdState", () => {
  it("moves forward only", () => {
    expect(nextPostWorkoutAdState("reserved", "loaded")).toBe("reserved");
    expect(nextPostWorkoutAdState("reserved", "shown")).toBe("shown");
    expect(nextPostWorkoutAdState("reserved", "dismissed")).toBe("dismissed");
    expect(nextPostWorkoutAdState("reserved", "failed")).toBe("failed");
    expect(nextPostWorkoutAdState("shown", "failed")).toBe("shown");
    expect(nextPostWorkoutAdState("shown", "dismissed")).toBe("dismissed");
    expect(nextPostWorkoutAdState("failed", "shown")).toBe("failed");
    expect(nextPostWorkoutAdState("dismissed", "failed")).toBe("dismissed");
  });
});

describe("postWorkoutAdReducer", () => {
  const run = (...actions: Parameters<typeof postWorkoutAdReducer>[1][]) => actions.reduce<PostWorkoutAdMachine>(postWorkoutAdReducer, initialPostWorkoutAd);

  it("happy path: checking → loading → ready → showing → dismissed", () => {
    expect(run({ type: "check" }, { type: "eligible", adId: "a" }, { type: "loaded" }, { type: "show" }, { type: "closed" })).toEqual({
      phase: "DISMISSED",
      adId: "a",
      reason: null,
    });
  });

  it("not eligible and not configured settle immediately", () => {
    expect(run({ type: "check" }, { type: "not_eligible", reason: "pro_user" }).phase).toBe("NOT_ELIGIBLE");
    expect(run({ type: "check" }, { type: "not_configured" }).phase).toBe("NOT_CONFIGURED");
  });

  it("a failure while loading or showing ends in FAILED; settled states stay put", () => {
    expect(run({ type: "check" }, { type: "eligible", adId: "a" }, { type: "failed", reason: "no_fill" }).phase).toBe("FAILED");
    expect(run({ type: "check" }, { type: "not_eligible", reason: "daily_cap" }, { type: "failed", reason: "x" }).phase).toBe("NOT_ELIGIBLE");
  });

  it("ignores out-of-order actions", () => {
    expect(run({ type: "show" }).phase).toBe("IDLE");
    expect(run({ type: "check" }, { type: "loaded" }).phase).toBe("CHECKING");
    expect(run({ type: "check" }, { type: "eligible", adId: "a" }, { type: "show" }).phase).toBe("LOADING");
  });
});
