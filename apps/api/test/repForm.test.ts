import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../src/shared/context";
import { makeApp, onboard, registerUser, TODAY } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const post = (auth: Auth, url: string, payload: object = {}) => app.inject({ method: "POST", url, headers: auth, payload });
const logSet = (auth: Auth, sessionId: string, body: object) => post(auth, `/workouts/sessions/${sessionId}/sets`, { clientSetId: randomUUID(), ...body });

async function user() {
  ({ app, ctx } = await makeApp());
  const u = await registerUser(app);
  await onboard(app, u.auth);
  const s = (await post(u.auth, "/workouts/sessions", { clientSessionId: randomUUID(), source: "empty" })).json().session;
  return { ...u, sessionId: s.id as string };
}

interface Rep {
  bottom: number;
  /** Torso lean at the bottom (squat form feature). */
  lean?: number;
  /** Gate frames in the middle of the rep. */
  gate?: string;
}

/** A squat set trace at 20 fps: angle + form features per frame, gated frames with a reason. */
function trace(reps: Rep[]) {
  const samples: { tMs: number; angleDeg: number; confidence: number; features?: Record<string, number>; gate?: string }[] = [];
  let t = 0;
  const push = (angle: number, lean: number, gate?: string) => {
    samples.push(gate ? { tMs: t, angleDeg: 0, confidence: 0, gate } : { tMs: t, angleDeg: angle, confidence: 0.9, features: { torsoLeanDeg: lean, hipDeg: angle } });
    t += 50;
  };
  for (let i = 0; i < 6; i++) push(172, 8);
  for (const r of reps) {
    const n = 44; // 2.2 s per rep
    for (let i = 0; i <= n; i++) {
      const d = i <= n / 2 ? i / (n / 2) : (n - i) / (n / 2);
      const gated = r.gate && i > n * 0.35 && i < n * 0.6;
      push(172 - (172 - r.bottom) * d, 8 + ((r.lean ?? 35) - 8) * d, gated ? r.gate : undefined);
    }
    for (let i = 0; i < 4; i++) push(172, 8);
  }
  return { poseStatus: "ok", samples };
}

describe("rep verification + form analysis (server-side, authoritative)", () => {
  it("verifies reps, scores form and ROM from the trace; attempts, rejections and quality are reported", async () => {
    const u = await user();
    const res = await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 3, trace: trace([{ bottom: 88 }, { bottom: 125 }, { bottom: 88, lean: 75 }]) });
    expect(res.statusCode).toBe(201);
    const set = res.json().set;
    expect(set).toMatchObject({ reps: 3, verifiedReps: 2, verificationStatus: "verified" });
    expect(set.formScore).toBeLessThan(100); // one rep leaned too far
    expect(set.romPercent).toBe(100);
    expect(set.quality).toMatchObject({
      attemptedReps: 3,
      verifiedReps: 2,
      rejectedReps: { insufficient_rom: 1 },
      perfectReps: 1,
      topIssue: { code: "torso_lean", message: "Keep your back neutral" },
    });
  });

  it("a second person mid-rep makes it ambiguous: that rep isn't verified", async () => {
    const u = await user();
    const set = (await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 2, trace: trace([{ bottom: 88, gate: "multiple_people" }, { bottom: 88 }]) })).json().set;
    expect(set.verifiedReps).toBe(1);
    expect(set.quality.rejectedReps).toEqual({ tracking_lost: 1 });
  });

  it("rejects malformed traces and anything the client tries to assert", async () => {
    const u = await user();
    const bad = trace([{ bottom: 88 }]);
    const withUnknownFeature = { ...bad, samples: bad.samples.map((s, i) => (i === 3 ? { ...s, features: { romPercent: 100 } } : s)) };
    expect((await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 1, trace: withUnknownFeature })).statusCode).toBe(400);
    const badGate = { ...bad, samples: [...bad.samples, { tMs: 99_999, angleDeg: 0, confidence: 0, gate: "DROP TABLE" }] };
    expect((await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 1, trace: badGate })).statusCode).toBe(400);
    const verifiedSample = { ...bad, samples: bad.samples.map((s, i) => (i === 0 ? { ...s, verified: true } : s)) };
    expect((await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 1, trace: verifiedSample })).statusCode).toBe(400);
    const backwards = { ...bad, samples: [...bad.samples].reverse() };
    expect((await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 1, trace: backwards })).statusCode).toBeGreaterThanOrEqual(400);
    for (const field of ["romPercent", "formScore", "quality"]) {
      expect((await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 1, [field]: 100 })).statusCode, field).toBe(400);
    }
  });

  it("lowering recorded reps drops verified reps and recomputes form, ROM and quality", async () => {
    const u = await user();
    const set = (await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 3, trace: trace([{ bottom: 88 }, { bottom: 88 }, { bottom: 99, lean: 75 }]) })).json().set;
    expect(set.verifiedReps).toBe(3);
    expect(set.formScore).toBeLessThan(100);
    const edited = (await app.inject({ method: "PATCH", url: `/workouts/sessions/${u.sessionId}/sets/${set.id}`, headers: u.auth, payload: { reps: 2 } })).json().set;
    expect(edited).toMatchObject({ reps: 2, verifiedReps: 2, formScore: 100, romPercent: 100 });
    expect(edited.quality).toMatchObject({ attemptedReps: 3, verifiedReps: 2, perfectReps: 2, topIssue: null });
    // Raising reps again never restores verification.
    const raised = (await app.inject({ method: "PATCH", url: `/workouts/sessions/${u.sessionId}/sets/${set.id}`, headers: u.auth, payload: { reps: 5 } })).json().set;
    expect(raised).toMatchObject({ reps: 5, verifiedReps: 2 });
  });

  it("completion persists per-rep audit metadata and emits one domain event per analyzed set, idempotently", async () => {
    const u = await user();
    await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 2, trace: trace([{ bottom: 88 }, { bottom: 88, lean: 75 }]) });
    await logSet(u.auth, u.sessionId, { exerciseId: "push_up", reps: 10 }); // manual: no analysis, no event
    const first = await post(u.auth, `/workouts/sessions/${u.sessionId}/complete`, { painLevel: "none" });
    const done = first.json();
    expect(done.totals).toMatchObject({ verifiedReps: 2, perfectReps: 1 });
    expect(done.totals.averageFormScore).toBeLessThan(100);
    expect(done.sets[0].quality).toMatchObject({ attemptedReps: 2, verifiedReps: 2 });
    expect(done.sets[1].quality).toBeNull();
    // Verified reps, recorded reps and completion — plus form/ROM bonuses from the server's own analysis.
    const award = ctx.db.prepare("SELECT xp, detail FROM xp_events WHERE user_id = ? AND source = 'workout'").get(u.id) as { xp: number; detail: string };
    const b = JSON.parse(award.detail).breakdown;
    expect(b).toMatchObject({ verifiedRepXp: 4, unverifiedRepXp: 5, completionBonus: 25 });
    expect(done.workout.xp).toBe(Math.floor(4 + 5 + 25 + b.formXp + b.romXp));

    await post(u.auth, `/workouts/sessions/${u.sessionId}/complete`, { painLevel: "none" }); // retry
    const events = ctx.db.prepare("SELECT type, key, payload FROM domain_events WHERE user_id = ? AND type = 'exercise.set_verified'").all(u.id) as { type: string; key: string; payload: string }[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "exercise.set_verified", key: `${done.workout.id}:0` });
    const payload = JSON.parse(events[0]!.payload);
    expect(payload).toMatchObject({ exerciseId: "bodyweight_squat", recordedReps: 2, attemptedReps: 2, verifiedReps: 2, perfectReps: 1, analyzerVersion: "rep-form/1" });
    expect(events[0]!.payload).not.toMatch(/xp/i);

    const reps = ctx.db
      .prepare(
        `SELECT r.rep_index, r.form_score, r.issues, r.start_ms, r.end_ms, r.peak_angle_deg, r.rom_percent FROM verified_reps r
         JOIN workout_sets s ON s.id = r.set_id WHERE s.workout_id = ? ORDER BY r.rep_index`,
      )
      .all(done.workout.id) as { form_score: number; issues: string; start_ms: number; end_ms: number; peak_angle_deg: number }[];
    expect(reps).toHaveLength(2);
    expect(reps[0]).toMatchObject({ form_score: 100, issues: "[]", peak_angle_deg: 172 });
    expect(reps[1]!.form_score).toBeLessThan(100);
    expect(JSON.parse(reps[1]!.issues)).toContain("torso_lean");
    expect(reps[1]!.end_ms).toBeGreaterThan(reps[1]!.start_ms);
    const analysis = JSON.parse((ctx.db.prepare("SELECT analysis FROM workout_sets WHERE workout_id = ? AND set_index = 0").get(done.workout.id) as { analysis: string }).analysis);
    expect(analysis).toMatchObject({ analyzerVersion: "rep-form/1", status: "verified", quality: { verifiedReps: 2 } });
    expect(analysis).not.toHaveProperty("reps"); // per-rep rows live in verified_reps
    expect(JSON.stringify(analysis)).not.toMatch(/features|angleDeg/); // no raw trace stored
  });

  it("offers the camera quest only after the user's device has verified reps", async () => {
    const u = await user();
    const questIds = async () => ((await app.inject({ method: "GET", url: "/quests", headers: u.auth })).json().weekly as { id: string }[]).map((q) => q.id);
    expect(await questIds()).not.toContain("weekly_verified_reps");
    await logSet(u.auth, u.sessionId, { exerciseId: "bodyweight_squat", reps: 1, trace: trace([{ bottom: 88 }]) });
    await post(u.auth, `/workouts/sessions/${u.sessionId}/complete`, { painLevel: "none" });
    expect(await questIds()).toContain("weekly_verified_reps");
  });

  it("the one-shot workout log emits the same event", async () => {
    const u = await user();
    const res = await post(u.auth, "/workouts", {
      clientWorkoutId: randomUUID(),
      localDate: TODAY,
      durationMinutes: 10,
      painLevel: "none",
      sets: [{ exerciseId: "bodyweight_squat", reps: 1, trace: trace([{ bottom: 88 }]) }],
    });
    expect(res.statusCode).toBe(201);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM domain_events WHERE user_id = ? AND type = 'exercise.set_verified'").get(u.id)).toEqual({ n: 1 });
  });
});
