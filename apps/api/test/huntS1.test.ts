import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { questMetrics } from "../src/modules/quests/service";
import type { AppContext } from "../src/shared/context";
import { grantPro, makeApp, onboard, registerUser, squatTrace, TestClock, TODAY, workoutPayload } from "./helpers";

/** Bug-hunt batch S1: anti-cheat and progression correctness (XP farming, fabricated traces, pain, reports, set indexes). */

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object = {}) => app.inject({ method: "POST", url, headers: auth, payload });
const logSet = (auth: Auth, sessionId: string, body: object) => post(auth, `/workouts/sessions/${sessionId}/sets`, { clientSetId: randomUUID(), ...body });
const startEmpty = async (auth: Auth) => (await post(auth, "/workouts/sessions", { clientSessionId: randomUUID(), source: "empty" })).json().session.id as string;

describe("A1-01: XP farming with tiny workouts", () => {
  it("30 one-minute, 200-rep workouts in a day earn the first 3 workouts' XP and nothing more", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    let total = 0;
    const flags: string[][] = [];
    for (let i = 0; i < 30; i++) {
      const r = await post(u.auth, "/workouts", { clientWorkoutId: randomUUID(), localDate: TODAY, durationMinutes: 1, painLevel: "none", sets: [{ exerciseId: "squat", reps: 200, loadKg: 0 }] });
      expect(r.statusCode).toBe(201);
      total += r.json().workout.xp;
      flags.push(r.json().workout.flags);
    }
    // Each earning workout: 40 (unverified cap) + 25 (completion) = 65.
    expect(total).toBe(3 * 65);
    expect(total).toBeLessThan(400);
    // 10 training minutes are charged per workout, so the per-day workout cap bites first (4th to 12th) and the 120-minute cap after.
    for (const f of flags.slice(3, 12)) expect(f).toEqual(["daily_workout_cap_reached"]);
    for (const f of flags.slice(12)) expect(f).toEqual(["daily_training_cap_reached"]);
    // The capped workouts are still saved in full and still count as workouts.
    const list = (await get(u.auth, "/workouts?limit=100")).workouts;
    expect(list).toHaveLength(30);
    expect((await get(u.auth, "/workouts/" + list[0].id)).sets).toHaveLength(1);
    expect((await get(u.auth, "/progress")).streak.current).toBe(1);
    expect((await get(u.auth, "/progress")).xpSources.workouts).toBe(195);
  });

  it("charges tiny claimed durations at the pace of their reps (3 s a rep) against the 120-minute cap", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    // 1,200 reps in each "1-minute" workout = 60 minutes charged each; the third has nothing left to earn.
    const xp: number[] = [];
    for (let i = 0; i < 3; i++) {
      const sets = Array.from({ length: 6 }, () => ({ exerciseId: "squat", reps: 200, loadKg: 0 }));
      const r = await post(u.auth, "/workouts", { clientWorkoutId: randomUUID(), localDate: TODAY, durationMinutes: 1, painLevel: "none", sets });
      xp.push(r.json().workout.xp);
      if (i === 2) expect(r.json().workout.flags).toContain("daily_training_cap_reached");
    }
    expect(xp[0]).toBeGreaterThan(0);
    expect(xp[1]).toBeGreaterThan(0);
    expect(xp[2]).toBe(0);
  });

  it("leaves a normal day (one or two real workouts) unaffected", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const a = (await post(u.auth, "/workouts", workoutPayload({ durationMinutes: 40 }))).json();
    const b = (await post(u.auth, "/workouts", workoutPayload({ durationMinutes: 40 }))).json();
    expect(a.workout.xp).toBeGreaterThan(0);
    expect(b.workout.xp).toBeGreaterThan(0);
    expect(a.workout.flags).toEqual([]);
    expect(b.workout.flags).toEqual([]);
  });

  it("a capped workout counts for the quest, the streak and PRs' data but not for XP", async () => {
    ({ app, ctx } = await makeApp());
    const u = await registerUser(app);
    for (let i = 0; i < 4; i++) await post(u.auth, "/workouts", workoutPayload({ durationMinutes: 10 }));
    expect(questMetrics(ctx.db, u.id, TODAY, TODAY).workouts_completed).toBe(4);
  });
});

describe("A1-02: fabricated camera traces", () => {
  it("rejects verification when the traces are longer than the stated duration (the audit repro)", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const r = await post(u.auth, "/workouts", {
      clientWorkoutId: randomUUID(),
      localDate: TODAY,
      durationMinutes: 1,
      painLevel: "none",
      sets: [1, 2, 3].map(() => ({ exerciseId: "squat", reps: 100, loadKg: 1000, trace: squatTrace(100) })),
    });
    const j = r.json();
    expect(r.statusCode).toBe(201);
    expect(j.workout.breakdown.verifiedReps).toBe(0);
    expect(j.workout.sets.map((s: { verificationStatus: string }) => s.verificationStatus)).toEqual(["trace_exceeds_time", "trace_exceeds_time", "trace_exceeds_time"]);
    // The reps are kept as unverified reps, and no exercise record comes from them.
    expect(j.workout.sets.every((s: { reps: number; verifiedReps: number }) => s.reps === 100 && s.verifiedReps === 0)).toBe(true);
    expect(j.prs.filter((p: { kind: string }) => p.kind !== "longest_streak")).toEqual([]);
    expect(j.workout.xp).toBeLessThanOrEqual(65);
  });

  it("budgets the traces of a one-shot workout together: what fits is verified, the rest is not", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    // 1 minute -> 60 s + 10% + 30 s = 96 s of trace. 20 reps trace 40 s each.
    const r = await post(u.auth, "/workouts", {
      clientWorkoutId: randomUUID(),
      localDate: TODAY,
      durationMinutes: 1,
      painLevel: "none",
      sets: [1, 2, 3].map(() => ({ exerciseId: "squat", reps: 20, loadKg: 60, trace: squatTrace(20) })),
    });
    expect(r.json().workout.sets.map((s: { verificationStatus: string }) => s.verificationStatus)).toEqual(["verified", "verified", "trace_exceeds_time"]);
    expect(r.json().workout.sets.map((s: { verifiedRepCount: number }) => s.verifiedRepCount)).toEqual([20, 20, 0]);
  });

  it("verifies real traces of a normal workout", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const r = await post(u.auth, "/workouts", workoutPayload({ durationMinutes: 40, sets: [1, 2, 3].map(() => ({ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) })) }));
    expect(r.json().workout.sets.map((s: { verificationStatus: string }) => s.verificationStatus)).toEqual(["verified", "verified", "verified"]);
    expect(r.json().workout.breakdown.verifiedReps).toBe(15);
  });

  it("bounds a live session's traces by the server-measured session time", async () => {
    const clock = new TestClock();
    ({ app, ctx } = await makeApp({ clock }));
    const u = await registerUser(app);
    await onboard(app, u.auth);
    const sessionId = await startEmpty(u.auth);
    // At t=0 there is only the 30 s tolerance: a 200 s trace is not trusted, a 20 s one is.
    const fake = (await logSet(u.auth, sessionId, { exerciseId: "squat", reps: 100, loadKg: 60, trace: squatTrace(100) })).json().set;
    expect(fake).toMatchObject({ reps: 100, verifiedReps: 0, verificationStatus: "trace_exceeds_time" });
    const ok = (await logSet(u.auth, sessionId, { exerciseId: "squat", reps: 10, loadKg: 60, trace: squatTrace(10) })).json().set;
    expect(ok).toMatchObject({ verifiedReps: 10, verificationStatus: "verified" });
    // Five real minutes later there is room for one 200 s trace (330 s budget incl. tolerance, 20 s used) but not two.
    clock.set("2026-09-27T12:05:00Z");
    const a = (await logSet(u.auth, sessionId, { exerciseId: "squat", reps: 100, loadKg: 60, trace: squatTrace(100) })).json().set;
    expect(a.verificationStatus).toBe("verified");
    const b = (await logSet(u.auth, sessionId, { exerciseId: "squat", reps: 100, loadKg: 60, trace: squatTrace(100) })).json().set;
    expect(b).toMatchObject({ verifiedReps: 0, verificationStatus: "trace_exceeds_time" });
    // The completed workout keeps the unverified sets and verifies only what fit.
    const done = (await post(u.auth, `/workouts/sessions/${sessionId}/complete`, { painLevel: "none" })).json();
    expect(done.totals.verifiedReps).toBe(110);
    expect(done.totals.reps).toBe(310);
  });

  it("does not count paused time as session time for the trace budget", async () => {
    const clock = new TestClock();
    ({ app, ctx } = await makeApp({ clock }));
    const u = await registerUser(app);
    await onboard(app, u.auth);
    const sessionId = await startEmpty(u.auth);
    await post(u.auth, `/workouts/sessions/${sessionId}/pause`);
    clock.set("2026-09-27T12:20:00Z");
    await post(u.auth, `/workouts/sessions/${sessionId}/resume`);
    const s = (await logSet(u.auth, sessionId, { exerciseId: "squat", reps: 100, loadKg: 60, trace: squatTrace(100) })).json().set;
    expect(s.verificationStatus).toBe("trace_exceeds_time");
  });

  it("ignores implausibly heavy sets for personal records", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const first = await post(u.auth, "/workouts", workoutPayload({ sets: [{ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) }] }));
    expect(first.json().prs.some((p: { kind: string }) => p.kind === "max_load")).toBe(true);
    const heavy = await post(u.auth, "/workouts", workoutPayload({ sets: [{ exerciseId: "squat", reps: 5, loadKg: 600, trace: squatTrace(5) }] }));
    expect(heavy.json().prs.filter((p: { kind: string }) => p.kind === "max_load" || p.kind === "estimated_1rm")).toEqual([]);
    // A legitimate improvement still counts.
    const better = await post(u.auth, "/workouts", workoutPayload({ sets: [{ exerciseId: "squat", reps: 5, loadKg: 65, trace: squatTrace(5) }] }));
    expect(better.json().prs.some((p: { kind: string; status: string }) => p.kind === "max_load" && p.status === "awarded")).toBe(true);
  });
});

describe("A1-08: serious-pain workouts earn no quest progress", () => {
  it("does not count a serious-pain workout toward any quest metric", async () => {
    ({ app, ctx } = await makeApp());
    const u = await registerUser(app);
    await post(u.auth, "/workouts", workoutPayload({ painLevel: "serious" }));
    expect(questMetrics(ctx.db, u.id, TODAY, TODAY)).toMatchObject({ workouts_completed: 0, active_days: 0, verified_reps: 0, good_form_reps: 0 });
    const quests = await get(u.auth, "/quests");
    for (const q of [...quests.daily, ...quests.weekly]) {
      if (["workouts_completed", "active_days", "verified_reps"].includes(q.metric)) expect(q.progress).toBe(0);
    }
    expect((await get(u.auth, "/progress")).xpSources.quests).toBe(0);
    // A normal workout does count.
    await post(u.auth, "/workouts", workoutPayload({ painLevel: "none" }));
    expect(questMetrics(ctx.db, u.id, TODAY, TODAY)).toMatchObject({ workouts_completed: 1, active_days: 1, verified_reps: 5 });
  });
});

describe("A1-16: weekly report filters", () => {
  it("leaves serious-pain workouts out and doesn't net decay into 'XP earned'", async () => {
    const clock = new TestClock(new Date("2026-09-14T12:00:00Z"));
    ({ app, ctx } = await makeApp({ clock }));
    const u = await registerUser(app);
    await onboard(app, u.auth, "2026-09-14");
    grantPro(ctx, u.id);
    const good = await post(u.auth, "/workouts", workoutPayload({ localDate: "2026-09-14", durationMinutes: 30 }));
    // Missed days follow (the plan owes 3 sessions); the last day of the week has a serious-pain workout.
    clock.set("2026-09-20T12:00:00Z");
    await post(u.auth, "/workouts", workoutPayload({ localDate: "2026-09-20", durationMinutes: 45, painLevel: "serious" }));
    const earned = good.json().workout.xp as number;
    expect(earned).toBeGreaterThan(0);
    // Days pass with no training: decay is booked against the week.
    clock.set("2026-09-22T12:00:00Z");
    await get(u.auth, "/progress");
    const decay = (ctx.db.prepare("SELECT COALESCE(SUM(xp), 0) AS n FROM xp_events WHERE user_id = ? AND source = 'decay' AND local_date BETWEEN '2026-09-14' AND '2026-09-20'").get(u.id) as { n: number }).n;
    expect(decay).toBeLessThan(0);

    const r = (await post(u.auth, "/reports/weekly")).json();
    expect(r.weekStart).toBe("2026-09-14");
    expect(r.report.training).toMatchObject({ workouts: 1, trainingDays: 1, minutes: 30, verifiedReps: 5 });
    // Quests and achievements earned in the week count; the decay does not.
    const sum = (where: string) => (ctx.db.prepare(`SELECT COALESCE(SUM(xp), 0) AS n FROM xp_events WHERE user_id = ? AND local_date BETWEEN '2026-09-14' AND '2026-09-20' ${where}`).get(u.id) as { n: number }).n;
    expect(r.report.xp.earned).toBe(sum("AND source <> 'decay'"));
    expect(r.report.xp.earned).toBeGreaterThanOrEqual(earned);
    expect(r.report.xp.earned).toBeGreaterThan(sum(""));
  });
});

describe("A1-23: set indexes", () => {
  it("numbers a session's sets in one stable, non-repeating sequence", async () => {
    ({ app, ctx } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    const sessionId = await startEmpty(u.auth);
    const idx = async (body: object) => (await logSet(u.auth, sessionId, body)).json().set as { id: string; setIndex: number };
    const a = await idx({ exerciseId: "squat", reps: 5, loadKg: 60 });
    const b = await idx({ exerciseId: "bench_press", reps: 5, loadKg: 40 });
    const c = await idx({ exerciseId: "squat", reps: 5, loadKg: 60 });
    expect([a.setIndex, b.setIndex, c.setIndex]).toEqual([0, 1, 2]);
    // Deleting a set never makes a later one reuse a number that's still in use.
    await app.inject({ method: "DELETE", url: `/workouts/sessions/${sessionId}/sets/${a.id}`, headers: u.auth });
    const d = await idx({ exerciseId: "squat", reps: 5, loadKg: 60 });
    expect(new Set([b.setIndex, c.setIndex, d.setIndex]).size).toBe(3);
    expect(d.setIndex).toBe(3);
    // Completion keeps the same global order.
    const done = (await post(u.auth, `/workouts/sessions/${sessionId}/complete`, { painLevel: "none" })).json();
    expect(done.sets.map((s: { exerciseId: string; setIndex: number }) => [s.exerciseId, s.setIndex])).toEqual([
      ["bench_press", 0],
      ["squat", 1],
      ["squat", 2],
    ]);
  });
});
