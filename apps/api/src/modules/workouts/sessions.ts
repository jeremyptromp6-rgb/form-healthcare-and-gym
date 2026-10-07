import { randomUUID } from "node:crypto";
import {
  activeDurationMinutes,
  EXERCISE_BY_ID,
  evaluateSet,
  summarizeSet,
  restRemainingSeconds,
  sessionIdleMs,
  type PainLevel,
  type PlannedExercise,
  type AssessedRep,
  type RepTrace,
  type SetAnalysisRecord,
} from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { userClock } from "../../shared/userClock";
import { previousPerformance } from "./plans";
import { findByClientId, insertWorkout, minutesTrainedOn } from "./repo";

/**
 * Live workout sessions. All state lives on the server — sets, pauses, rest timers — so a
 * session survives the app closing, the phone dying or switching devices. Completion turns
 * the session into exactly one workout, however many times it is retried.
 */

export interface SessionRow {
  id: string;
  user_id: string;
  client_session_id: string;
  plan_id: string | null;
  local_date: string;
  status: "active" | "paused" | "completed" | "discarded";
  exercises: string;
  started_at: string;
  paused_at: string | null;
  paused_ms: number;
  rest_ends_at: string | null;
  rest_seconds: number | null;
  completed_at: string | null;
  workout_id: string | null;
  pain_level: PainLevel | null;
  updated_at: string;
}

interface SetRow {
  id: string;
  client_set_id: string;
  exercise_id: string;
  set_index: number;
  target_reps: number | null;
  target_load_kg: number | null;
  reps: number;
  load_kg: number;
  verified_reps: number;
  verification_status: string;
  rom_percent: number | null;
  form_score: number | null;
  verified_rep_details: string;
  analysis: string | null;
  created_at: string;
}

/** Loads a session owned by the user. Anyone else's session is indistinguishable from a missing one. */
export function ownSession(db: Db, userId: string, id: string): SessionRow {
  const row = db.prepare("SELECT * FROM workout_sessions WHERE id = ? AND user_id = ?").get(id, userId) as SessionRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "Workout session not found");
  return row;
}

export function openSession(db: Db, userId: string): SessionRow | null {
  return (db.prepare("SELECT * FROM workout_sessions WHERE user_id = ? AND status IN ('active', 'paused')").get(userId) as SessionRow | undefined) ?? null;
}

function sets(db: Db, sessionId: string): SetRow[] {
  return db.prepare("SELECT * FROM session_sets WHERE session_id = ? ORDER BY created_at, rowid").all(sessionId) as unknown as SetRow[];
}

function assertOpen(s: SessionRow, action: string): void {
  if (s.status === "completed" || s.status === "discarded") throw new HttpError(409, "session_closed", `This workout is already ${s.status}`);
  if (s.status === "paused" && action !== "resume") throw new HttpError(409, "session_paused", "Resume the workout first");
}

/** The last time anything happened in the session: the session itself or any of its sets. */
function lastActivity(db: Db, s: SessionRow): Date {
  const set = db.prepare("SELECT MAX(updated_at) AS t FROM session_sets WHERE session_id = ?").get(s.id) as { t: string | null };
  return new Date(set.t && set.t > s.updated_at ? set.t : s.updated_at);
}

/**
 * Before acting on an open session: time it sat untouched past the idle limit (the app was closed,
 * the phone forgotten) becomes paused time, so it can never count as training — not when the user
 * comes back and carries on, and not when they finish it later. Records the activity either way.
 */
function absorbIdle(ctx: AppContext, s: SessionRow): SessionRow {
  const now = ctx.now();
  const idle = sessionIdleMs({ status: s.status, lastActivityAt: lastActivity(ctx.db, s), now });
  ctx.db.prepare("UPDATE workout_sessions SET paused_ms = paused_ms + ?, updated_at = ? WHERE id = ?").run(idle, now.toISOString(), s.id);
  return { ...s, paused_ms: s.paused_ms + idle, updated_at: now.toISOString() };
}

/** Asserts the session accepts `action`, then records the activity (absorbing any idle gap). */
function act(ctx: AppContext, s: SessionRow, action: string): SessionRow {
  assertOpen(s, action);
  return absorbIdle(ctx, s);
}

const setView = (r: SetRow) => ({
  id: r.id,
  clientSetId: r.client_set_id,
  exerciseId: r.exercise_id,
  setIndex: r.set_index,
  targetReps: r.target_reps,
  targetLoadKg: r.target_load_kg,
  reps: r.reps,
  loadKg: r.load_kg,
  verifiedReps: r.verified_reps,
  verificationStatus: r.verification_status,
  romPercent: r.rom_percent,
  formScore: r.form_score,
  quality: r.analysis ? (JSON.parse(r.analysis) as SetAnalysisRecord).quality : null,
  createdAt: r.created_at,
});

export function sessionView(ctx: AppContext, s: SessionRow) {
  const now = ctx.now();
  const logged = sets(ctx.db, s.id);
  const open = s.status === "active" || s.status === "paused";
  const lastActivityAt = lastActivity(ctx.db, s);
  const idleMs = sessionIdleMs({ status: s.status, lastActivityAt, now });
  const planned = JSON.parse(s.exercises) as PlannedExercise[];
  const previous = previousPerformance(ctx.db, s.user_id, { excludeWorkoutId: s.workout_id ?? undefined });
  const ids = [...planned.map((p) => p.exerciseId), ...logged.map((l) => l.exercise_id).filter((id) => !planned.some((p) => p.exerciseId === id))];
  const unique = [...new Set(ids)];

  return {
    id: s.id,
    clientSessionId: s.client_session_id,
    status: s.status,
    localDate: s.local_date,
    startedAt: s.started_at,
    pausedAt: s.paused_at,
    pausedMs: s.paused_ms,
    activeMinutes: activeDurationMinutes({
      startedAt: new Date(s.started_at),
      end: s.completed_at ? new Date(s.completed_at) : now,
      pausedMs: s.paused_ms + idleMs,
      pausedAt: s.paused_at ? new Date(s.paused_at) : null,
    }),
    lastActivityAt: lastActivityAt.toISOString(),
    // Set while the session sits idle past the limit: the clock stops here until the user acts again.
    idleSince: idleMs > 0 ? lastActivityAt.toISOString() : null,
    // Left open: untouched past the idle limit, or started on an earlier day. The app asks the user
    // to finish it with what they logged (idle time excluded) or discard it.
    leftOpen: open && (idleMs > 0 || s.local_date < userClock(ctx, s.user_id).today),
    rest: s.rest_ends_at ? { endsAt: s.rest_ends_at, seconds: s.rest_seconds, remainingSeconds: restRemainingSeconds(new Date(s.rest_ends_at), now) } : null,
    workoutId: s.workout_id,
    completedAt: s.completed_at,
    exercises: unique.map((id) => {
      const plan = planned.find((p) => p.exerciseId === id) ?? null;
      const prev = previous[id];
      return {
        exerciseId: id,
        name: EXERCISE_BY_ID.get(id)?.name ?? id,
        planned: plan !== null,
        sets: plan?.sets ?? null,
        targetReps: plan?.targetReps ?? null,
        targetLoadKg: plan?.targetLoadKg ?? null,
        restSeconds: plan?.restSeconds ?? 90,
        note: plan?.note ?? null,
        cameraVerifiable: EXERCISE_BY_ID.get(id)?.cameraVerifiable ?? false,
        loadable: EXERCISE_BY_ID.get(id)?.loadable ?? false,
        previous: prev ? { localDate: prev.localDate, sets: prev.sets } : null,
        loggedSets: logged.filter((l) => l.exercise_id === id).map(setView),
      };
    }),
  };
}

export function startSession(ctx: AppContext, userId: string, input: { clientSessionId: string; localDate: string; planId: string | null; exercises: PlannedExercise[] }) {
  const { db } = ctx;
  return transaction(db, () => {
    const retry = db.prepare("SELECT * FROM workout_sessions WHERE user_id = ? AND client_session_id = ?").get(userId, input.clientSessionId) as SessionRow | undefined;
    if (retry) return { created: false, session: retry };
    const open = openSession(db, userId);
    if (open) throw new HttpError(409, "session_open", "Finish or discard your current workout first", { sessionId: open.id });
    const id = randomUUID();
    const now = ctx.now().toISOString();
    db.prepare(
      `INSERT INTO workout_sessions (id, user_id, client_session_id, plan_id, local_date, status, exercises, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).run(id, userId, input.clientSessionId, input.planId, input.localDate, JSON.stringify(input.exercises), now, now);
    return { created: true, session: ownSession(db, userId, id) };
  });
}

export function logSet(
  ctx: AppContext,
  userId: string,
  sessionId: string,
  body: { clientSetId: string; exerciseId: string; reps: number; loadKg: number; targetReps?: number; targetLoadKg?: number; trace?: RepTrace; restSeconds?: number },
) {
  const { db } = ctx;
  return transaction(db, () => {
    const s = ownSession(db, userId, sessionId);
    const existing = db.prepare("SELECT * FROM session_sets WHERE session_id = ? AND client_set_id = ?").get(sessionId, body.clientSetId) as SetRow | undefined;
    if (existing) return { created: false, set: setView(existing) }; // retried request: same set, never a second one
    act(ctx, s, "log");
    const count = (db.prepare("SELECT COUNT(*) AS n FROM session_sets WHERE session_id = ?").get(sessionId) as { n: number }).n;
    if (count >= 100) throw new HttpError(422, "too_many_sets", "A workout can have at most 100 sets");
    const setIndex = (db.prepare("SELECT COUNT(*) AS n FROM session_sets WHERE session_id = ? AND exercise_id = ?").get(sessionId, body.exerciseId) as { n: number }).n;

    // Server-side verification: the client reports reps; only the engine decides verified reps.
    const evaluated = evaluateSet({ exerciseId: body.exerciseId, reps: body.reps, loadKg: body.loadKg, trace: body.trace }, setIndex);
    const id = randomUUID();
    const now = ctx.now();
    db.prepare(
      `INSERT INTO session_sets (id, session_id, client_set_id, exercise_id, set_index, target_reps, target_load_kg, reps, load_kg, verified_reps,
         verification_status, rom_percent, form_score, verified_rep_details, analysis, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      sessionId,
      body.clientSetId,
      body.exerciseId,
      setIndex,
      body.targetReps ?? null,
      body.targetLoadKg ?? null,
      body.reps,
      body.loadKg,
      evaluated.verifiedReps,
      evaluated.verificationStatus,
      evaluated.romPercent,
      evaluated.formScore,
      JSON.stringify(evaluated.verifiedRepDetails),
      evaluated.analysis ? JSON.stringify(evaluated.analysis) : null,
      now.toISOString(),
      now.toISOString(),
    );
    if (body.restSeconds) setRest(db, sessionId, body.restSeconds, now);
    return { created: true, set: setView(db.prepare("SELECT * FROM session_sets WHERE id = ?").get(id) as unknown as SetRow) };
  });
}

export function editSet(ctx: AppContext, userId: string, sessionId: string, setId: string, patch: { reps?: number; loadKg?: number }) {
  const { db } = ctx;
  return transaction(db, () => {
    act(ctx, ownSession(db, userId, sessionId), "edit");
    const row = db.prepare("SELECT * FROM session_sets WHERE id = ? AND session_id = ?").get(setId, sessionId) as SetRow | undefined;
    if (!row) throw new HttpError(404, "not_found", "Set not found");
    const reps = patch.reps ?? row.reps;
    // Lowering reps can lower verified reps; raising them never adds verification. Form, ROM and
    // the quality summary follow the verified reps that are kept.
    const details = (JSON.parse(row.verified_rep_details) as AssessedRep[]).slice(0, reps);
    let analysis = row.analysis ? (JSON.parse(row.analysis) as SetAnalysisRecord) : null;
    if (analysis) {
      const quality = summarizeSet(row.exercise_id, details, analysis.rejected, analysis.quality.incomplete);
      analysis = { ...analysis, quality: { ...quality, attemptedReps: analysis.quality.attemptedReps } };
    }
    db.prepare(
      "UPDATE session_sets SET reps = ?, load_kg = ?, verified_reps = ?, verified_rep_details = ?, rom_percent = ?, form_score = ?, analysis = ?, updated_at = ? WHERE id = ?",
    ).run(
      reps,
      patch.loadKg ?? row.load_kg,
      details.length,
      JSON.stringify(details),
      analysis ? analysis.quality.averageRomPercent : row.rom_percent,
      analysis ? analysis.quality.averageFormScore : row.form_score,
      analysis ? JSON.stringify(analysis) : null,
      ctx.now().toISOString(),
      setId,
    );
    return setView(db.prepare("SELECT * FROM session_sets WHERE id = ?").get(setId) as unknown as SetRow);
  });
}

export function deleteSet(ctx: AppContext, userId: string, sessionId: string, setId: string) {
  const { db } = ctx;
  transaction(db, () => {
    act(ctx, ownSession(db, userId, sessionId), "edit");
    const r = db.prepare("DELETE FROM session_sets WHERE id = ? AND session_id = ?").run(setId, sessionId);
    if (r.changes === 0) throw new HttpError(404, "not_found", "Set not found");
  });
}

function setRest(db: Db, sessionId: string, seconds: number, now: Date) {
  db.prepare("UPDATE workout_sessions SET rest_ends_at = ?, rest_seconds = ?, updated_at = ? WHERE id = ?").run(
    new Date(now.getTime() + seconds * 1000).toISOString(),
    seconds,
    now.toISOString(),
    sessionId,
  );
}

export function startRest(ctx: AppContext, userId: string, sessionId: string, seconds: number) {
  transaction(ctx.db, () => {
    act(ctx, ownSession(ctx.db, userId, sessionId), "rest");
    setRest(ctx.db, sessionId, seconds, ctx.now());
  });
}

export function clearRest(ctx: AppContext, userId: string, sessionId: string) {
  const s = ownSession(ctx.db, userId, sessionId);
  if (s.status === "active") absorbIdle(ctx, s);
  ctx.db.prepare("UPDATE workout_sessions SET rest_ends_at = NULL, rest_seconds = NULL, updated_at = ? WHERE id = ?").run(ctx.now().toISOString(), sessionId);
}

export function pauseSession(ctx: AppContext, userId: string, sessionId: string) {
  transaction(ctx.db, () => {
    const s = ownSession(ctx.db, userId, sessionId);
    if (s.status === "paused") return; // already paused: idempotent
    act(ctx, s, "pause");
    // Pausing also stops any rest timer: rest restarts when training does.
    ctx.db
      .prepare("UPDATE workout_sessions SET status = 'paused', paused_at = ?, rest_ends_at = NULL, rest_seconds = NULL, updated_at = ? WHERE id = ?")
      .run(ctx.now().toISOString(), ctx.now().toISOString(), sessionId);
  });
}

export function resumeSession(ctx: AppContext, userId: string, sessionId: string) {
  transaction(ctx.db, () => {
    const s = ownSession(ctx.db, userId, sessionId);
    if (s.status === "active") return; // already running: idempotent
    assertOpen(s, "resume");
    const pausedFor = Math.max(0, ctx.now().getTime() - new Date(s.paused_at!).getTime());
    ctx.db
      .prepare("UPDATE workout_sessions SET status = 'active', paused_at = NULL, paused_ms = paused_ms + ?, updated_at = ? WHERE id = ?")
      .run(pausedFor, ctx.now().toISOString(), sessionId);
  });
}

export function discardSession(ctx: AppContext, userId: string, sessionId: string) {
  transaction(ctx.db, () => {
    const s = ownSession(ctx.db, userId, sessionId);
    if (s.status === "discarded") return;
    if (s.status === "completed") throw new HttpError(409, "session_closed", "A completed workout can't be discarded");
    ctx.db.prepare("UPDATE workout_sessions SET status = 'discarded', rest_ends_at = NULL, updated_at = ? WHERE id = ?").run(ctx.now().toISOString(), sessionId);
  });
}

/** The summary of a completed workout — identical for the first completion and every retry. */
export function completionSummary(db: Db, userId: string, workoutId: string) {
  const w = db
    .prepare(
      `SELECT w.id, w.local_date AS localDate, w.duration_minutes AS durationMinutes, w.pain_level AS painLevel, w.xp_flags AS flags, (SELECT COALESCE(SUM(e.xp), 0) FROM xp_events e WHERE e.user_id = w.user_id AND e.source = 'workout' AND e.source_key = w.id) AS xp
       FROM workouts w
       WHERE w.id = ? AND w.user_id = ?`,
    )
    .get(workoutId, userId) as { id: string; localDate: string; durationMinutes: number; painLevel: string; flags: string; xp: number } | undefined;
  if (!w) throw new HttpError(404, "not_found", "Workout not found");
  const setRows = db
    .prepare(
      `SELECT exercise_id AS exerciseId, set_index AS setIndex, target_reps AS targetReps, reps, verified_reps AS verifiedReps, load_kg AS loadKg,
              verification_status AS verificationStatus, rom_percent AS romPercent, form_score AS formScore, analysis
       FROM workout_sets WHERE workout_id = ? ORDER BY id`,
    )
    .all(workoutId) as { exerciseId: string; reps: number; verifiedReps: number; loadKg: number; formScore: number | null; analysis: string | null }[];
  const sets = setRows.map(({ analysis, ...s }) => ({
    ...s,
    name: EXERCISE_BY_ID.get(s.exerciseId)?.name ?? s.exerciseId,
    quality: analysis ? (JSON.parse(analysis) as SetAnalysisRecord).quality : null,
  }));
  const scored = sets.filter((s) => s.formScore !== null && s.verifiedReps > 0);
  const prs = db.prepare("SELECT exercise_id AS exerciseId, kind, value, previous, status FROM personal_records WHERE workout_id = ? ORDER BY id").all(workoutId);
  return {
    workout: { id: w.id, localDate: w.localDate, durationMinutes: w.durationMinutes, painLevel: w.painLevel, xp: w.xp, flags: JSON.parse(w.flags) as string[] },
    totals: {
      sets: setRows.length,
      reps: setRows.reduce((a, s) => a + s.reps, 0),
      verifiedReps: setRows.reduce((a, s) => a + s.verifiedReps, 0),
      volumeKg: Math.round(setRows.reduce((a, s) => a + s.reps * s.loadKg, 0)),
      perfectReps: sets.reduce((a, s) => a + (s.quality?.perfectReps ?? 0), 0),
      // Rep-weighted average form over camera-verified sets.
      averageFormScore: scored.length
        ? Math.round(scored.reduce((a, s) => a + s.formScore! * s.verifiedReps, 0) / scored.reduce((a, s) => a + s.verifiedReps, 0))
        : null,
    },
    sets,
    prs,
  };
}

/**
 * Completes a session exactly once. The first call creates the workout, its XP, PRs and (via the
 * workouts table) its streak and quest effects; any retry returns the same summary and changes
 * nothing. The workout's idempotency key is the session's client id, so the one-shot log endpoint
 * can't create a second copy either.
 */
export function completeSession(ctx: AppContext, userId: string, sessionId: string, painLevel: PainLevel) {
  const { db } = ctx;
  return transaction(db, () => {
    const found = ownSession(db, userId, sessionId);
    if (found.status === "completed") return { duplicate: true, workoutId: found.workout_id! };
    if (found.status === "discarded") throw new HttpError(409, "session_closed", "This workout was discarded");
    const s = absorbIdle(ctx, found);

    const rows = sets(db, sessionId);
    if (rows.length === 0) throw new HttpError(422, "no_sets", "Log at least one set, or discard the workout");

    const now = ctx.now();
    const existing = findByClientId(db, userId, s.client_session_id);
    let workoutId = existing?.id;
    if (!workoutId) {
      const durationMinutes = activeDurationMinutes({
        startedAt: new Date(s.started_at),
        end: now,
        pausedMs: s.paused_ms,
        pausedAt: s.paused_at ? new Date(s.paused_at) : null,
      });
      workoutId = randomUUID();
      insertWorkout(db, {
        id: workoutId,
        userId,
        clientWorkoutId: s.client_session_id,
        localDate: s.local_date,
        durationMinutes,
        painLevel,
        priorTrainingMinutesToday: minutesTrainedOn(db, userId, s.local_date),
        now,
        sets: rows.map((r, i) => ({
          setIndex: i,
          exerciseId: r.exercise_id,
          reps: r.reps,
          loadKg: r.load_kg,
          verifiedReps: r.verified_reps,
          verificationStatus: r.verification_status as never,
          romPercent: r.rom_percent,
          formScore: r.form_score,
          verifiedRepDetails: JSON.parse(r.verified_rep_details),
          analysis: r.analysis ? JSON.parse(r.analysis) : null,
          targetReps: r.target_reps,
        })),
      });
    }
    db.prepare(
      `UPDATE workout_sessions SET status = 'completed', completed_at = ?, workout_id = ?, pain_level = ?, paused_at = NULL,
         rest_ends_at = NULL, rest_seconds = NULL, updated_at = ? WHERE id = ?`,
    ).run(now.toISOString(), workoutId, painLevel, now.toISOString(), sessionId);
    return { duplicate: false, workoutId };
  });
}
