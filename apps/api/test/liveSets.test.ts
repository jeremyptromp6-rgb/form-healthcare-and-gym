import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, onboard, registerUser, squatTrace, TestClock } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const post = (auth: Auth, url: string, payload: object = {}) => app.inject({ method: "POST", url, headers: auth, payload });
const patch = (auth: Auth, url: string, payload: object) => app.inject({ method: "PATCH", url, headers: auth, payload });
const start = (auth: Auth) => post(auth, "/workouts/sessions", { clientSessionId: randomUUID(), source: "empty" });
const logSet = (auth: Auth, sessionId: string, body: object) => post(auth, `/workouts/sessions/${sessionId}/sets`, { clientSetId: randomUUID(), ...body });
const complete = (auth: Auth, sessionId: string) => post(auth, `/workouts/sessions/${sessionId}/complete`, { painLevel: "none" });

async function setup() {
  const clock = new TestClock(new Date("2026-09-27T10:00:00Z"));
  const made = await makeApp({ clock });
  app = made.app;
  const u = await registerUser(app);
  await onboard(app, u.auth);
  return { ...u, ctx: made.ctx, clock };
}

/** One 10-rep push-up set in a fresh app, finished: the workout's XP and summary. */
async function oneSet(extra: object) {
  const u = await setup();
  const s = (await start(u.auth)).json().session;
  const set = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10, ...extra })).json().set;
  const done = (await complete(u.auth, s.id)).json();
  await app.close();
  return { set, done };
}

describe("live set mode", () => {
  it("validates mode and liveSeconds strictly", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    const bad = async (extra: object) => (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 5, ...extra })).statusCode;
    expect(await bad({ mode: "robot" })).toBe(400);
    expect(await bad({ mode: "live", liveSeconds: 0 })).toBe(400);
    expect(await bad({ mode: "live", liveSeconds: 3601 })).toBe(400);
    expect(await bad({ mode: "live", liveSeconds: 12.5 })).toBe(400);
    expect(await bad({ mode: "live", liveSeconds: "30" })).toBe(400);
    expect(await bad({ mode: "live", liveSeconds: 30, elapsedSeconds: 30 })).toBe(400);
    expect(await bad({ mode: "live", liveSeconds: 3600 })).toBe(201);
  });

  it("stores a plausible live set and returns it on the set, session and summary", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    const res = await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10, mode: "live", liveSeconds: 40 });
    expect(res.statusCode).toBe(201);
    expect(res.json().set).toMatchObject({ mode: "live", liveSeconds: 40 });
    expect(res.json().session.exercises[0].loggedSets[0]).toMatchObject({ mode: "live", liveSeconds: 40 });
    const done = (await complete(u.auth, s.id)).json();
    expect(done.sets[0]).toMatchObject({ mode: "live", liveSeconds: 40 });
    expect(u.ctx.db.prepare("SELECT mode, live_seconds AS s FROM workout_sets").get()).toEqual({ mode: "live", s: 40 });
  });

  it("treats a set from an old client (no fields) as manual", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    const set = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10 })).json().set;
    expect(set).toMatchObject({ mode: "manual", liveSeconds: null });
    expect(u.ctx.db.prepare("SELECT mode FROM session_sets").get()).toEqual({ mode: "manual" });
  });

  it("treats an implausible live set (under 1.5 s per rep) as manual and drops the timer", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    const set = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 20, mode: "live", liveSeconds: 5 })).json().set;
    expect(set).toMatchObject({ mode: "manual", liveSeconds: null });
  });

  it("makes a camera-verified set a camera set; a camera claim with no verified reps is manual", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    u.clock.set("2026-09-27T10:20:00Z");
    const cam = (await logSet(u.auth, s.id, { exerciseId: "squat", reps: 5, loadKg: 60, mode: "camera", trace: squatTrace(5) })).json().set;
    const claim = (await logSet(u.auth, s.id, { exerciseId: "squat", reps: 5, loadKg: 60, mode: "camera" })).json().set;
    expect(cam.mode).toBe("camera");
    expect(claim.mode).toBe("manual");
  });

  it("raising a live set's reps afterwards makes it manual; lowering keeps it live", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    const set = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10, mode: "live", liveSeconds: 40 })).json().set;
    const lowered = await patch(u.auth, `/workouts/sessions/${s.id}/sets/${set.id}`, { reps: 8 });
    expect(lowered.json().set).toMatchObject({ mode: "live", liveSeconds: 40, reps: 8 });
    const raised = await patch(u.auth, `/workouts/sessions/${s.id}/sets/${set.id}`, { reps: 12 });
    expect(raised.json().set).toMatchObject({ mode: "manual", liveSeconds: null, reps: 12 });
  });

  it("pays a live set in full and a manual set half the self-logged rep XP; warm-ups earn nothing", async () => {
    const live = await oneSet({ mode: "live", liveSeconds: 40 });
    const manual = await oneSet({});
    const implausible = await oneSet({ mode: "live", liveSeconds: 3 });
    const warm = await oneSet({ warmup: true, mode: "live", liveSeconds: 40 });
    expect(live.done.workout.xp).toBe(25 + 5); // completion bonus + 10 reps x 0.5
    expect(manual.done.workout.xp).toBe(25 + 2); // 10 reps x 0.25 = 2.5, floored with the bonus
    expect(implausible.done.workout.xp).toBe(manual.done.workout.xp);
    expect(live.done.workout.xp).toBeGreaterThan(manual.done.workout.xp);
    expect(warm.done.totals).toMatchObject({ sets: 0, warmupSets: 1 });
    expect(warm.done.sets[0]).toMatchObject({ warmup: true, mode: "live" });
  });

  it("migration 28 backfills verified sets as camera and the rest as manual", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    u.clock.set("2026-09-27T10:20:00Z");
    await logSet(u.auth, s.id, { exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) });
    await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 5 });
    const done = (await complete(u.auth, s.id)).json();
    expect(done.sets.map((x: { mode: string }) => x.mode)).toEqual(["camera", "manual"]);
  });
});
