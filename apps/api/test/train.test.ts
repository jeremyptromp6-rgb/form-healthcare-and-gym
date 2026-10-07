import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canPerform, EXERCISE_BY_ID } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { makeApp, onboard, PROFILE, registerUser, squatTrace, TestClock, TODAY } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object = {}) => app.inject({ method: "POST", url, headers: auth, payload });
const start = (auth: Auth, clientSessionId: string = randomUUID(), source = "plan") => post(auth, "/workouts/sessions", { clientSessionId, source });
const logSet = (auth: Auth, sessionId: string, body: object) => post(auth, `/workouts/sessions/${sessionId}/sets`, { clientSetId: randomUUID(), ...body });
const complete = (auth: Auth, sessionId: string, painLevel = "none") => post(auth, `/workouts/sessions/${sessionId}/complete`, { painLevel });

async function onboardedUser(clock?: TestClock) {
  ({ app } = await makeApp({ clock }));
  const u = await registerUser(app);
  await onboard(app, u.auth);
  return u;
}

describe("today's workout", () => {
  it("generates a plan from the user's profile, using only equipment they have", async () => {
    const u = await onboardedUser();
    const today = await get(u.auth, "/workouts/today");
    expect(today.plan.generator).toEqual({ id: "rule_based", version: 1 });
    expect(today.plan.focus).toBe("full_body"); // 3 days a week
    expect(today.plan.exercises.length).toBeGreaterThanOrEqual(3);
    for (const e of today.plan.exercises) expect(canPerform(EXERCISE_BY_ID.get(e.exerciseId)!, [...PROFILE.equipment])).toBe(true);
    expect(today.activeSession).toBeNull();
    expect(today.completedToday).toBe(0);
  });

  it("stays the same all day, and changes on a new day", async () => {
    const clock = new TestClock();
    const u = await onboardedUser(clock);
    const first = await get(u.auth, "/workouts/today");
    expect(await get(u.auth, "/workouts/today")).toEqual(first);
    clock.set("2026-09-28T12:00:00Z");
    const next = await get(u.auth, "/workouts/today");
    expect(next.date).toBe("2026-09-28");
    expect(next.planId).not.toBe(first.planId);
  });

  it("regenerates after an equipment change", async () => {
    const u = await onboardedUser();
    await get(u.auth, "/workouts/today");
    await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { equipment: ["bodyweight"], trainingLocation: "home", localDate: TODAY } });
    const regen = (await post(u.auth, "/workouts/today/regenerate")).json();
    for (const e of regen.plan.exercises) expect(canPerform(EXERCISE_BY_ID.get(e.exerciseId)!, ["bodyweight"])).toBe(true);
  });

  it("works for a user who hasn't finished personalizing (bodyweight defaults)", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const plan = (await get(u.auth, "/workouts/today")).plan;
    expect(plan.exercises.map((e: { exerciseId: string }) => e.exerciseId)).toEqual(expect.arrayContaining(["bodyweight_squat", "push_up"]));
  });
});

describe("sessions and set entry", () => {
  it("starts one session at a time; a retried start returns the same session", async () => {
    const u = await onboardedUser();
    const cid = randomUUID();
    const first = await start(u.auth, cid);
    expect(first.statusCode).toBe(201);
    const s = first.json().session;
    expect(s.status).toBe("active");
    expect(s.exercises.length).toBeGreaterThan(0);
    const retry = await start(u.auth, cid);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().session.id).toBe(s.id);
    const other = await start(u.auth);
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toMatchObject({ code: "session_open", details: { sessionId: s.id } });
    expect((await get(u.auth, "/workouts/today")).activeSession).toMatchObject({ id: s.id, status: "active" });
  });

  it("records target, recorded and verified reps separately; verification comes only from the trace", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth, randomUUID(), "empty")).json().session;
    const res = await logSet(u.auth, s.id, { exerciseId: "bodyweight_squat", reps: 8, targetReps: 10, trace: squatTrace(6) });
    expect(res.statusCode).toBe(201);
    expect(res.json().set).toMatchObject({ targetReps: 10, reps: 8, verifiedReps: 6, verificationStatus: "verified", romPercent: 100, formScore: 100 });
    expect(res.json().set.quality).toMatchObject({ attemptedReps: 6, verifiedReps: 6, perfectReps: 6 });
    const manual = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 12 })).json().set;
    expect(manual).toMatchObject({ verifiedReps: 0, verificationStatus: "not_tracked", formScore: null, quality: null });
  });

  it("rejects client-asserted verification, unknown exercises and bad values", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth)).json().session;
    expect((await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10, verifiedReps: 10 })).statusCode).toBe(400);
    expect((await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10, formScore: 99 })).statusCode).toBe(400);
    expect((await logSet(u.auth, s.id, { exerciseId: "moon_walk", reps: 10 })).statusCode).toBe(422);
    expect((await logSet(u.auth, s.id, { exerciseId: "push_up", reps: -1 })).statusCode).toBe(400);
    expect((await logSet(u.auth, s.id, { exerciseId: "bicep_curl", reps: 10, loadKg: 2000 })).statusCode).toBe(400);
  });

  it("counts a retried set once", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth)).json().session;
    const clientSetId = randomUUID();
    expect((await post(u.auth, `/workouts/sessions/${s.id}/sets`, { clientSetId, exerciseId: "push_up", reps: 10 })).statusCode).toBe(201);
    const retry = await post(u.auth, `/workouts/sessions/${s.id}/sets`, { clientSetId, exerciseId: "push_up", reps: 10 });
    expect(retry.statusCode).toBe(200);
    const view = (await get(u.auth, `/workouts/sessions/${s.id}`)).session;
    expect(view.exercises.find((e: { exerciseId: string }) => e.exerciseId === "push_up").loggedSets).toHaveLength(1);
  });

  it("edits and deletes sets; lowering reps can never leave more verified reps than recorded", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth)).json().session;
    const set = (await logSet(u.auth, s.id, { exerciseId: "bodyweight_squat", reps: 6, trace: squatTrace(6) })).json().set;
    const edited = (await app.inject({ method: "PATCH", url: `/workouts/sessions/${s.id}/sets/${set.id}`, headers: u.auth, payload: { reps: 4 } })).json().set;
    expect(edited).toMatchObject({ reps: 4, verifiedReps: 4 });
    const raised = (await app.inject({ method: "PATCH", url: `/workouts/sessions/${s.id}/sets/${set.id}`, headers: u.auth, payload: { reps: 10 } })).json().set;
    expect(raised).toMatchObject({ reps: 10, verifiedReps: 4 }); // raising reps adds no verification
    expect((await app.inject({ method: "DELETE", url: `/workouts/sessions/${s.id}/sets/${set.id}`, headers: u.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/workouts/sessions/${s.id}/sets/${set.id}`, headers: u.auth })).statusCode).toBe(404);
  });
});

describe("pause, resume, rest and interruption", () => {
  it("pauses and resumes; paused time doesn't count and no sets can be logged while paused", async () => {
    const clock = new TestClock(new Date("2026-09-27T10:00:00Z"));
    const u = await onboardedUser(clock);
    const s = (await start(u.auth)).json().session;
    await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10 });
    clock.set("2026-09-27T10:10:00Z");
    expect((await post(u.auth, `/workouts/sessions/${s.id}/pause`)).json().session).toMatchObject({ status: "paused", activeMinutes: 10 });
    expect((await post(u.auth, `/workouts/sessions/${s.id}/pause`)).statusCode).toBe(200); // idempotent
    expect((await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10 })).json().error.code).toBe("session_paused");
    clock.set("2026-09-27T10:40:00Z");
    expect((await post(u.auth, `/workouts/sessions/${s.id}/resume`)).json().session).toMatchObject({ status: "active", activeMinutes: 10 });
    clock.set("2026-09-27T10:50:00Z");
    const done = (await complete(u.auth, s.id)).json();
    expect(done.workout.durationMinutes).toBe(20);
  });

  it("keeps the rest timer on the server", async () => {
    const clock = new TestClock(new Date("2026-09-27T10:00:00Z"));
    const u = await onboardedUser(clock);
    const s = (await start(u.auth)).json().session;
    const logged = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10, restSeconds: 90 })).json().session;
    expect(logged.rest).toMatchObject({ seconds: 90, remainingSeconds: 90 });
    clock.set("2026-09-27T10:00:30Z");
    expect((await get(u.auth, `/workouts/sessions/${s.id}`)).session.rest.remainingSeconds).toBe(60);
    expect((await post(u.auth, `/workouts/sessions/${s.id}/rest/skip`)).json().session.rest).toBeNull();
    expect((await post(u.auth, `/workouts/sessions/${s.id}/rest`, { seconds: 120 })).json().session.rest.remainingSeconds).toBe(120);
    expect((await post(u.auth, `/workouts/sessions/${s.id}/pause`)).json().session.rest).toBeNull();
    expect((await post(u.auth, `/workouts/sessions/${s.id}/rest`, { seconds: 5 })).statusCode).toBe(400);
  });

  it("survives an interruption: the session, sets and pause state are all there after a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "form-train-"));
    const config = { databasePath: join(dir, "train.db") };
    try {
      ({ app } = await makeApp({ config }));
      const u = await registerUser(app);
      await onboard(app, u.auth);
      const s = (await start(u.auth)).json().session;
      await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 12, targetReps: 12 });
      await post(u.auth, `/workouts/sessions/${s.id}/pause`);
      await app.close();

      ({ app } = await makeApp({ config }));
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, password: "correct-horse-battery" } });
      const auth = { authorization: `Bearer ${login.json().token}` };
      const active = (await get(auth, "/workouts/sessions/active")).session;
      expect(active).toMatchObject({ id: s.id, status: "paused" });
      expect(active.exercises.find((e: { exerciseId: string }) => e.exerciseId === "push_up").loggedSets[0]).toMatchObject({ reps: 12, targetReps: 12 });
      await post(auth, `/workouts/sessions/${s.id}/resume`);
      expect((await complete(auth, s.id)).statusCode).toBe(201);
      await app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("completion", () => {
  it("creates one workout with XP, PRs, streak, quest progress and history", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth)).json().session;
    await logSet(u.auth, s.id, { exerciseId: "bodyweight_squat", reps: 5, trace: squatTrace(5) });
    await logSet(u.auth, s.id, { exerciseId: "bicep_curl", reps: 10, loadKg: 12, targetReps: 12 });
    const res = await complete(u.auth, s.id);
    expect(res.statusCode).toBe(201);
    const done = res.json();
    expect(done.duplicate).toBe(false);
    expect(done.totals).toEqual({ sets: 2, reps: 15, verifiedReps: 5, volumeKg: 120, perfectReps: 5, averageFormScore: 100 });
    // 5 verified + 10 recorded reps + completion, plus form and range bonuses on the verified reps.
    expect(done.workout.xp).toBe(Math.floor(5 * 2 + 10 * 0.5 + 25 + 5 * 0.5 + 5 * 0.25));
    expect(done.progress.streak.current).toBe(1);
    expect(done.prs.length).toBeGreaterThan(0);

    const history = (await get(u.auth, "/workouts")).workouts;
    expect(history).toEqual([expect.objectContaining({ id: done.workout.id, xp: done.workout.xp })]);
    const detail = await get(u.auth, `/workouts/${done.workout.id}`);
    expect(detail.sets.find((x: { exerciseId: string }) => x.exerciseId === "bicep_curl")).toMatchObject({ targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 12, formScore: null });
    expect((await get(u.auth, "/workouts/today")).completedToday).toBe(1);
    const home = await get(u.auth, "/home");
    expect(home.today).toMatchObject({ trainedToday: true, suggestion: { kind: "done_today" } });
    expect(home.quests.weekly.find((q: { id: string }) => q.id === "weekly_train").progress).toBe(1);
  });

  it("is idempotent: retries (sequential and concurrent) never duplicate the workout, XP, PRs, streak or quests", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth)).json().session;
    await logSet(u.auth, s.id, { exerciseId: "bicep_curl", reps: 10, loadKg: 12 });
    await logSet(u.auth, s.id, { exerciseId: "bodyweight_squat", reps: 5, trace: squatTrace(5) });
    const results = await Promise.all([complete(u.auth, s.id), complete(u.auth, s.id), complete(u.auth, s.id)]);
    const retry = await complete(u.auth, s.id);
    const all = [...results, retry].map((r) => r.json());
    expect(new Set(all.map((r) => r.workout.id)).size).toBe(1);
    expect(all.filter((r) => r.duplicate === false)).toHaveLength(1);
    expect(retry.statusCode).toBe(200);
    expect(all.every((r) => JSON.stringify(r.prs) === JSON.stringify(all[0].prs))).toBe(true);

    const events = (await get(u.auth, "/xp/events")).events;
    expect(events.filter((e: { source: string }) => e.source === "workout")).toHaveLength(1);
    expect((await get(u.auth, "/workouts")).workouts).toHaveLength(1);
    expect((await get(u.auth, "/records")).records.length).toBe(all[0].prs.filter((p: { status: string }) => p.status === "awarded").length);
    expect((await get(u.auth, `/progress?today=${TODAY}`)).streak.current).toBe(1);
    expect((await get(u.auth, "/home")).quests.weekly.find((q: { id: string }) => q.id === "weekly_train").progress).toBe(1);

    // The one-shot log endpoint shares the idempotency key, so it can't create a second copy either.
    const oneShot = await post(u.auth, "/workouts", { clientWorkoutId: s.clientSessionId, localDate: TODAY, durationMinutes: 30, painLevel: "none", sets: [{ exerciseId: "push_up", reps: 10 }] });
    expect(oneShot.json().duplicate).toBe(true);
  });

  it("requires at least one set, and discarded sessions never become workouts", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth)).json().session;
    expect((await complete(u.auth, s.id)).json().error.code).toBe("no_sets");
    await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10 });
    expect((await post(u.auth, `/workouts/sessions/${s.id}/discard`)).json().session.status).toBe("discarded");
    expect((await complete(u.auth, s.id)).statusCode).toBe(409);
    expect((await get(u.auth, "/workouts")).workouts).toEqual([]);
    expect((await start(u.auth)).statusCode).toBe(201); // a new one can start
  });

  it("gives no XP or PRs for a session ending in serious pain", async () => {
    const u = await onboardedUser();
    const s = (await start(u.auth)).json().session;
    await logSet(u.auth, s.id, { exerciseId: "bicep_curl", reps: 10, loadKg: 12 });
    const done = (await complete(u.auth, s.id, "serious")).json();
    expect(done.workout.xp).toBe(0);
    expect(done.prs).toEqual([]);
  });

  it("a first-ever lift sets a baseline; only beating it earns the PR bonus and the Personal Best quest", async () => {
    const u = await onboardedUser();
    const prBonus = async (workoutId: string) => (await get(u.auth, "/xp/events")).events.find((e: { reference: string }) => e.reference === workoutId).detail.breakdown.personalRecords;
    const personalBest = async () => (await get(u.auth, "/home")).quests.weekly.find((q: { id: string }) => q.id === "weekly_personal_best");
    const first = (await start(u.auth)).json().session;
    await logSet(u.auth, first.id, { exerciseId: "bodyweight_squat", reps: 8, trace: squatTrace(8) });
    const baseline = (await complete(u.auth, first.id)).json();
    expect(baseline.prs.some((p: { status: string }) => p.status === "awarded")).toBe(true);
    expect(await prBonus(baseline.workout.id)).toBe(0);
    expect(await personalBest()).toMatchObject({ progress: 0, completed: false });

    const second = (await start(u.auth)).json().session;
    await logSet(u.auth, second.id, { exerciseId: "bodyweight_squat", reps: 10, trace: squatTrace(10) }); // within the plausible-jump limit
    const beaten = (await complete(u.auth, second.id)).json();
    expect(await prBonus(beaten.workout.id)).toBeGreaterThan(0);
    expect(await personalBest()).toMatchObject({ progress: 1, completed: true });
  });
});

describe("previous performance", () => {
  it("shows last time's sets in the next session and on the exercise page", async () => {
    const clock = new TestClock(new Date("2026-09-26T12:00:00Z"));
    const u = await onboardedUser(clock);
    const s1 = (await start(u.auth, randomUUID(), "empty")).json().session;
    await logSet(u.auth, s1.id, { exerciseId: "bicep_curl", reps: 12, loadKg: 10 });
    await logSet(u.auth, s1.id, { exerciseId: "bicep_curl", reps: 11, loadKg: 10 });
    await complete(u.auth, s1.id);

    clock.set(`${TODAY}T12:00:00Z`);
    const s2 = (await start(u.auth, randomUUID(), "empty")).json().session;
    const view = (await logSet(u.auth, s2.id, { exerciseId: "bicep_curl", reps: 12, loadKg: 11 })).json().session;
    expect(view.exercises[0]).toMatchObject({ exerciseId: "bicep_curl", previous: { localDate: "2026-09-26", sets: [{ reps: 12, loadKg: 10 }, { reps: 11, loadKg: 10 }] } });

    const page = await get(u.auth, "/exercises/bicep_curl");
    expect(page.exercise).toMatchObject({ name: "Bicep Curl", pattern: "elbow_flexion", cameraVerifiable: true });
    expect(page.history[0]).toMatchObject({ localDate: "2026-09-26" });
    expect((await app.inject({ method: "GET", url: "/exercises/moon_walk", headers: u.auth })).statusCode).toBe(404);
  });

  it("feeds progression into tomorrow's plan", async () => {
    const clock = new TestClock(new Date("2026-09-26T12:00:00Z"));
    const u = await onboardedUser(clock);
    const plan = (await get(u.auth, "/workouts/today")).plan;
    const loaded = plan.exercises.find((e: { exerciseId: string }) => EXERCISE_BY_ID.get(e.exerciseId)!.loadable)!;
    const s = (await start(u.auth)).json().session;
    for (let i = 0; i < loaded.sets; i++) await logSet(u.auth, s.id, { exerciseId: loaded.exerciseId, reps: loaded.targetReps.max, loadKg: 20 });
    await complete(u.auth, s.id);

    clock.set("2026-09-29T12:00:00Z");
    const next = (await get(u.auth, "/workouts/today")).plan.exercises.find((e: { exerciseId: string }) => e.exerciseId === loaded.exerciseId);
    if (next) expect(next).toMatchObject({ progression: "increase_load", targetLoadKg: 20 + EXERCISE_BY_ID.get(loaded.exerciseId)!.loadIncrementKg });
  });
});

describe("authorization", () => {
  it("never lets one user see or touch another user's sessions or workouts", async () => {
    const u = await onboardedUser();
    const other = await registerUser(app);
    const s = (await start(u.auth)).json().session;
    const set = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10 })).json().set;

    for (const [method, url] of [
      ["GET", `/workouts/sessions/${s.id}`],
      ["POST", `/workouts/sessions/${s.id}/sets`],
      ["PATCH", `/workouts/sessions/${s.id}/sets/${set.id}`],
      ["DELETE", `/workouts/sessions/${s.id}/sets/${set.id}`],
      ["POST", `/workouts/sessions/${s.id}/pause`],
      ["POST", `/workouts/sessions/${s.id}/resume`],
      ["POST", `/workouts/sessions/${s.id}/rest`],
      ["POST", `/workouts/sessions/${s.id}/discard`],
      ["POST", `/workouts/sessions/${s.id}/complete`],
    ] as const) {
      const payload = url.endsWith("/sets") ? { clientSetId: randomUUID(), exerciseId: "push_up", reps: 1 } : url.endsWith("/rest") ? { seconds: 60 } : url.endsWith("complete") ? { painLevel: "none" } : method === "PATCH" ? { reps: 1 } : undefined;
      expect((await app.inject({ method, url, headers: other.auth, payload })).statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await get(other.auth, "/workouts/sessions/active")).session).toBeNull();

    const done = (await complete(u.auth, s.id)).json();
    expect((await app.inject({ method: "GET", url: `/workouts/${done.workout.id}`, headers: other.auth })).statusCode).toBe(404);
    expect((await get(other.auth, "/workouts")).workouts).toEqual([]);
  });

  it("requires authentication", async () => {
    ({ app } = await makeApp());
    for (const [method, url] of [
      ["GET", "/workouts/today"],
      ["POST", "/workouts/sessions"],
      ["GET", "/workouts/sessions/active"],
      ["GET", "/exercises/push_up"],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, url).toBe(401);
    }
  });
});
