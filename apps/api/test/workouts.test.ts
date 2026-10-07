import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, registerUser, squatTrace, TODAY, workoutPayload } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

describe("POST /workouts", () => {
  it("verifies reps server-side from the pose trace and awards XP", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload() });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.workout.sets[0]).toMatchObject({ verifiedReps: 5, verificationStatus: "verified", romPercent: 100 });
    // 5 verified reps, completion, and form + range bonuses (first lifts are baselines, not PR bonuses).
    expect(body.workout.breakdown).toMatchObject({ verifiedRepXp: 10, completionBonus: 25, goodFormReps: 5, formXp: 2.5, fullRomReps: 5, romXp: 1.25, personalRecords: 0, prXp: 0 });
    expect(body.workout.xp).toBe(38);
    // Plus the one-time First Workout (20) and First Rep (10) achievements, through the same ledger.
    expect(body.progress.totalXp).toBe(68);
    expect(body.progress.streak.current).toBe(1);
    // Every first value is a baseline record: load, 1RM, form and range for the exercise, plus workout-wide ones.
    expect(body.prs.map((p: { kind: string }) => p.kind).sort()).toEqual(["best_form", "best_rom", "estimated_1rm", "longest_streak", "max_load", "workout_verified_reps"]);
    expect(body.prs.every((p: { previous: number | null }) => p.previous === null)).toBe(true);
  });

  it("rejects exercises that are not in the catalog", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload({ sets: [{ exerciseId: "made_up_move", reps: 10 }] }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details.field).toBe("exerciseId");
  });

  it("persists every verified rep and records the XP in the ledger", async () => {
    let ctxRef: Awaited<ReturnType<typeof makeApp>>["ctx"];
    ({ app, ctx: ctxRef } = await makeApp());
    const u = await registerUser(app);
    const res = (await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload() })).json();
    const reps = ctxRef.db
      .prepare("SELECT r.rep_index, r.rom_percent FROM verified_reps r JOIN workout_sets s ON s.id = r.set_id WHERE s.workout_id = ? ORDER BY r.rep_index")
      .all(res.workout.id);
    expect(reps).toHaveLength(5);
    const events = (await app.inject({ method: "GET", url: "/xp/events", headers: u.auth })).json().events;
    const workoutEvents = events.filter((e: { source: string }) => e.source === "workout");
    expect(workoutEvents).toEqual([expect.objectContaining({ source: "workout", reference: res.workout.id, kind: "award", xp: 38 })]);
    expect(workoutEvents[0].detail.breakdown).toMatchObject({ verifiedReps: 5 });
  });

  it("rejects a client-supplied verifiedReps or xp field", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const cheatSet = await app.inject({
      method: "POST",
      url: "/workouts",
      headers: u.auth,
      payload: workoutPayload({ sets: [{ exerciseId: "squat", reps: 10, verifiedReps: 10 }] }),
    });
    expect(cheatSet.statusCode).toBe(400);
    const cheatXp = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: { ...workoutPayload(), xp: 99999 } });
    expect(cheatXp.statusCode).toBe(400);
  });

  it("verifies no more reps than the pose trace shows, even if the client claims more", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/workouts",
      headers: u.auth,
      payload: workoutPayload({ sets: [{ exerciseId: "squat", reps: 20, loadKg: 0, trace: squatTrace(3) }] }),
    });
    expect(res.json().workout.sets[0].verifiedReps).toBe(3);
  });

  it("counts no verified reps when pose is unavailable or the movement is untracked", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await app.inject({
      method: "POST",
      url: "/workouts",
      headers: u.auth,
      payload: workoutPayload({
        sets: [
          { exerciseId: "squat", reps: 10, trace: { poseStatus: "unavailable", samples: [] } },
          { exerciseId: "bench_press", reps: 8, loadKg: 80 },
          { exerciseId: "bench_press", reps: 8, loadKg: 80, trace: squatTrace(8) },
        ],
      }),
    });
    const sets = res.json().workout.sets;
    expect(sets.map((s: { verificationStatus: string }) => s.verificationStatus)).toEqual(["pose_unavailable", "not_tracked", "unsupported_exercise"]);
    expect(sets.every((s: { verifiedReps: number }) => s.verifiedReps === 0)).toBe(true);
    // Unverified sets never set exercise or rep records (only the training-streak baseline exists).
    expect(res.json().prs.map((p: { kind: string }) => p.kind)).toEqual(["longest_streak"]);
  });

  it("is idempotent: retrying the same workout never awards XP twice", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const payload = workoutPayload();
    const first = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload });
    const retry = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(retry.json().progress.totalXp).toBe(first.json().progress.totalXp);
  });

  it("stops awarding XP after the daily training cap", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload({ durationMinutes: 40 }) });
    }
    const fourth = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload({ durationMinutes: 40 }) });
    expect(fourth.json().workout.xp).toBe(0);
    expect(fourth.json().workout.flags).toContain("daily_training_cap_reached");
  });

  it("awards no XP and no PRs for a session with serious pain", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload({ painLevel: "serious" }) });
    expect(res.json().workout.xp).toBe(0);
    expect(res.json().prs).toEqual([]);
  });

  it("rejects implausible dates (cannot farm XP on future days)", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload({ localDate: "2026-10-15" }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("implausible_date");
  });

  it("holds an implausible PR jump for review instead of awarding it", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload() });
    const jump = await app.inject({
      method: "POST",
      url: "/workouts",
      headers: u.auth,
      payload: workoutPayload({ sets: [{ exerciseId: "squat", reps: 5, loadKg: 120, trace: squatTrace(5) }] }),
    });
    expect(jump.json().prs.every((p: { status: string }) => p.status === "needs_review")).toBe(true);
    const records = await app.inject({ method: "GET", url: "/records", headers: u.auth });
    expect(records.json().records.find((r: { kind: string }) => r.kind === "max_load").value).toBe(60);
  });
});

describe("user isolation", () => {
  it("never shows one user's workouts, records or progress to another", async () => {
    ({ app } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    await app.inject({ method: "POST", url: "/workouts", headers: a.auth, payload: workoutPayload() });

    expect((await app.inject({ method: "GET", url: "/workouts", headers: b.auth })).json().workouts).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/records", headers: b.auth })).json().records).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/progress?today=${TODAY}`, headers: b.auth })).json().totalXp).toBe(0);
    expect((await app.inject({ method: "GET", url: "/workouts", headers: a.auth })).json().workouts).toHaveLength(1);
  });

  it("scopes idempotency keys per user", async () => {
    ({ app } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    const payload = workoutPayload();
    await app.inject({ method: "POST", url: "/workouts", headers: a.auth, payload });
    const res = await app.inject({ method: "POST", url: "/workouts", headers: b.auth, payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().duplicate).toBe(false);
  });
});
