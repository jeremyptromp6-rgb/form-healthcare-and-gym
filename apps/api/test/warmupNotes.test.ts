import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, onboard, registerUser, squatTrace, TestClock } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
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

describe("warm-up sets", () => {
  it("are flagged on the set, can be toggled by an edit, and default to working sets", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    const work = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10 })).json().set;
    const warm = (await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 5, warmup: true })).json().set;
    expect(work.warmup).toBe(false);
    expect(warm.warmup).toBe(true);
    const edited = await patch(u.auth, `/workouts/sessions/${s.id}/sets/${warm.id}`, { warmup: false });
    expect(edited.json().set.warmup).toBe(false);
    expect((await patch(u.auth, `/workouts/sessions/${s.id}/sets/${warm.id}`, { warmup: "yes" })).statusCode).toBe(400);
  });

  it("earn nothing: same XP, verified reps, volume, records and daily minutes as the workout without them", async () => {
    const a = await setup();
    const withWarm = (await start(a.auth)).json().session;
    a.clock.set("2026-09-27T10:20:00Z"); // real time for the camera traces to fit
    // A heavier, camera-verified warm-up that would otherwise set every record and add volume.
    await logSet(a.auth, withWarm.id, { exerciseId: "squat", reps: 10, loadKg: 200, warmup: true, trace: squatTrace(10) });
    await logSet(a.auth, withWarm.id, { exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) });
    const doneWith = (await complete(a.auth, withWarm.id)).json();
    const withRecords = a.ctx.db.prepare("SELECT kind, value FROM personal_records WHERE user_id = ? ORDER BY kind").all(a.id);
    const dbWith = a.ctx.db.prepare("SELECT COUNT(*) AS n FROM verified_reps r JOIN workout_sets s ON s.id = r.set_id WHERE s.workout_id = ?").get(doneWith.workout.id) as { n: number };
    await app.close();

    const b = await setup();
    const without = (await start(b.auth)).json().session;
    b.clock.set("2026-09-27T10:20:00Z");
    await logSet(b.auth, without.id, { exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) });
    const doneWithout = (await complete(b.auth, without.id)).json();
    const withoutRecords = b.ctx.db.prepare("SELECT kind, value FROM personal_records WHERE user_id = ? ORDER BY kind").all(b.id);

    expect(doneWith.workout.xp).toBe(doneWithout.workout.xp);
    expect(doneWith.totals).toMatchObject({ sets: 1, warmupSets: 1, reps: 5, verifiedReps: 5, volumeKg: 300 });
    expect(doneWithout.totals).toMatchObject({ sets: 1, warmupSets: 0, reps: 5, verifiedReps: 5, volumeKg: 300 });
    expect(doneWith.totals.averageFormScore).toBe(doneWithout.totals.averageFormScore);
    expect(doneWith.sets).toHaveLength(2); // still listed on the summary
    expect(doneWith.sets.filter((x: { warmup: boolean }) => x.warmup)).toHaveLength(1);
    expect(withRecords).toEqual(withoutRecords);
    expect(withRecords.length).toBeGreaterThan(0);
    expect(dbWith.n).toBe(5); // the warm-up's verified reps are not stored
  });

  it("are stored unverified and are left out of history and 'previous'", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    await logSet(u.auth, s.id, { exerciseId: "squat", reps: 10, loadKg: 20, warmup: true, trace: squatTrace(10) });
    await logSet(u.auth, s.id, { exerciseId: "squat", reps: 4, loadKg: 60 });
    await complete(u.auth, s.id);
    const row = u.ctx.db.prepare("SELECT warmup, verified_reps AS v FROM workout_sets WHERE warmup = 1").get() as { warmup: number; v: number };
    expect(row).toEqual({ warmup: 1, v: 0 });
    const exercise = await get(u.auth, "/exercises/squat");
    expect(exercise.history[0].sets).toEqual([expect.objectContaining({ reps: 4, loadKg: 60 })]);
    expect(exercise.previous.sets).toEqual([{ reps: 4, loadKg: 60 }]);
  });

  it("do not count toward the daily training cap", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 200, warmup: true });
    await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 3 });
    await complete(u.auth, s.id);
    const { minutesTrainedOn } = await import("../src/modules/workouts/repo");
    // 3 working reps at 3 s each is under a minute; only the (1 minute) real duration can count.
    expect(minutesTrainedOn(u.ctx.db, u.id, "2026-09-27")).toBeLessThanOrEqual(1);
  });

  it("are accepted by the one-shot log and ignored for XP there too", async () => {
    const u = await setup();
    const base = { clientWorkoutId: randomUUID(), localDate: "2026-09-27", durationMinutes: 20, painLevel: "none" };
    const withWarm = await post(u.auth, "/workouts", { ...base, sets: [{ exerciseId: "push_up", reps: 100, warmup: true }, { exerciseId: "push_up", reps: 10 }] });
    expect(withWarm.statusCode).toBe(201);
    const other = await registerUser(app);
    await onboard(app, other.auth);
    const plain = await post(other.auth, "/workouts", { ...base, clientWorkoutId: randomUUID(), sets: [{ exerciseId: "push_up", reps: 10 }] });
    expect(withWarm.json().workout.xp).toBe(plain.json().workout.xp);
  });
});

describe("workout notes", () => {
  it("are saved on the session, sanitized, capped at 500 characters, and copied to the workout and its summary", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    expect(s.notes).toBeNull();
    const dirty = "  Felt strong\r\n\r\n\r\n\r\ntop set was easy\u0000​  ";
    const saved = await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: dirty });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().session.notes).toBe("Felt strong\n\ntop set was easy");
    expect((await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: "x".repeat(501) })).statusCode).toBe(400);
    expect((await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: "x".repeat(500) })).statusCode).toBe(200);
    expect((await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: "Felt strong" })).statusCode).toBe(200);
    expect((await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: "ok", extra: 1 })).statusCode).toBe(400);
    await logSet(u.auth, s.id, { exerciseId: "push_up", reps: 10 });
    const done = (await complete(u.auth, s.id)).json();
    expect(done.workout.notes).toBe("Felt strong");
    expect((await get(u.auth, `/workouts/${done.workout.id}`)).workout.notes).toBe("Felt strong");
    expect((await get(u.auth, "/workouts")).workouts[0].notes).toBe("Felt strong");
    expect((await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: "late" })).statusCode).toBe(409); // closed
  });

  it("clear with an empty string or null, and can't be set on someone else's session", async () => {
    const u = await setup();
    const s = (await start(u.auth)).json().session;
    await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: "hello" });
    expect((await patch(u.auth, `/workouts/sessions/${s.id}`, { notes: "   " })).json().session.notes).toBeNull();
    const other = await registerUser(app);
    expect((await patch(other.auth, `/workouts/sessions/${s.id}`, { notes: "hi" })).statusCode).toBe(404);
  });
});
