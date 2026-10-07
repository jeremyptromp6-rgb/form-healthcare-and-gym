import { addDays, EXERCISE_BY_ID, formIntelligence, SESSION_LIMITS, type FormIssueCode } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { requireFeature } from "../billing/entitlements";
import { userClock } from "../../shared/userClock";
import { computeUserProgress } from "../progression/service";
import { syncRecognition } from "../recognition/service";
import { previousPerformance, todayPlan } from "./plans";
import { traceSchema } from "./traceSchema";
import {
  clearRest,
  completeSession,
  completionSummary,
  deleteSet,
  discardSession,
  editSet,
  logSet,
  openSession,
  ownSession,
  pauseSession,
  resumeSession,
  sessionView,
  startRest,
  startSession,
} from "./sessions";

const id = z.object({ id: z.string().uuid() });
const restSeconds = z.number().int().min(SESSION_LIMITS.restSeconds.min).max(SESSION_LIMITS.restSeconds.max);

// No verifiedReps, romPercent or formScore fields: .strict() rejects them. Only the engine sets those,
// from the trace (see traceSchema).
const setBody = z
  .object({
    clientSetId: z.string().uuid(),
    exerciseId: z.string().regex(/^[a-z0-9_]{1,40}$/),
    reps: z.number().int().min(0).max(200),
    loadKg: z.number().min(0).max(1000).default(0),
    targetReps: z.number().int().min(1).max(200).optional(),
    targetLoadKg: z.number().min(0).max(1000).optional(),
    trace: traceSchema.optional(),
    restSeconds: restSeconds.optional(),
  })
  .strict();

/** Today's workout, live sessions, history and exercise detail. Every route is scoped to the caller. */
export function trainingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/workouts/today", async (req) => {
    const clock = userClock(ctx, req.user.sub);
    const stored = todayPlan(ctx, req.user.sub, clock);
    const open = openSession(ctx.db, req.user.sub);
    const completedToday = (ctx.db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id = ? AND local_date = ?").get(req.user.sub, clock.today) as { n: number }).n;
    return {
      date: clock.today,
      planId: stored.id,
      plan: stored.plan,
      completedToday,
      activeSession: open ? { id: open.id, status: open.status, localDate: open.local_date } : null,
    };
  });

  app.post("/workouts/today/regenerate", async (req) => {
    const clock = userClock(ctx, req.user.sub);
    const stored = todayPlan(ctx, req.user.sub, clock, { regenerate: true });
    return { date: clock.today, planId: stored.id, plan: stored.plan };
  });

  // ---- Sessions ----------------------------------------------------------------------

  app.post("/workouts/sessions", async (req, reply) => {
    const body = z.object({ clientSessionId: z.string().uuid(), source: z.enum(["plan", "empty"]).default("plan") }).strict().parse(req.body);
    const clock = userClock(ctx, req.user.sub);
    const plan = body.source === "plan" ? todayPlan(ctx, req.user.sub, clock) : null;
    const { created, session } = startSession(ctx, req.user.sub, {
      clientSessionId: body.clientSessionId,
      localDate: clock.today,
      planId: plan?.id ?? null,
      exercises: plan?.plan.exercises ?? [],
    });
    return reply.status(created ? 201 : 200).send({ session: sessionView(ctx, session) });
  });

  app.get("/workouts/sessions/active", async (req) => {
    const open = openSession(ctx.db, req.user.sub);
    return { session: open ? sessionView(ctx, open) : null };
  });

  app.get("/workouts/sessions/:id", async (req) => {
    const { id: sessionId } = id.parse(req.params);
    return { session: sessionView(ctx, ownSession(ctx.db, req.user.sub, sessionId)) };
  });

  app.post("/workouts/sessions/:id/sets", { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const { id: sessionId } = id.parse(req.params);
    const body = setBody.parse(req.body);
    if (!EXERCISE_BY_ID.has(body.exerciseId)) throw new HttpError(422, "unknown_exercise", "That exercise isn't in the library");
    const result = logSet(ctx, req.user.sub, sessionId, body);
    return reply.status(result.created ? 201 : 200).send({ set: result.set, session: sessionView(ctx, ownSession(ctx.db, req.user.sub, sessionId)) });
  });

  app.patch("/workouts/sessions/:id/sets/:setId", async (req) => {
    const { id: sessionId, setId } = z.object({ id: z.string().uuid(), setId: z.string().uuid() }).parse(req.params);
    const patch = z.object({ reps: z.number().int().min(0).max(200), loadKg: z.number().min(0).max(1000) }).partial().strict().parse(req.body);
    const set = editSet(ctx, req.user.sub, sessionId, setId, patch);
    return { set, session: sessionView(ctx, ownSession(ctx.db, req.user.sub, sessionId)) };
  });

  app.delete("/workouts/sessions/:id/sets/:setId", async (req) => {
    const { id: sessionId, setId } = z.object({ id: z.string().uuid(), setId: z.string().uuid() }).parse(req.params);
    deleteSet(ctx, req.user.sub, sessionId, setId);
    return { session: sessionView(ctx, ownSession(ctx.db, req.user.sub, sessionId)) };
  });

  const action = (path: string, fn: (userId: string, sessionId: string, body: unknown) => void) =>
    app.post(`/workouts/sessions/:id/${path}`, async (req) => {
      const { id: sessionId } = id.parse(req.params);
      fn(req.user.sub, sessionId, req.body);
      return { session: sessionView(ctx, ownSession(ctx.db, req.user.sub, sessionId)) };
    });

  action("pause", (u, s) => pauseSession(ctx, u, s));
  action("resume", (u, s) => resumeSession(ctx, u, s));
  action("discard", (u, s) => discardSession(ctx, u, s));
  action("rest", (u, s, body) => startRest(ctx, u, s, z.object({ seconds: restSeconds }).strict().parse(body).seconds));
  action("rest/skip", (u, s) => clearRest(ctx, u, s));

  app.post("/workouts/sessions/:id/complete", async (req, reply) => {
    const { id: sessionId } = id.parse(req.params);
    const { painLevel } = z.object({ painLevel: z.enum(["none", "mild", "serious"]) }).strict().parse(req.body);
    const { duplicate, workoutId } = completeSession(ctx, req.user.sub, sessionId, painLevel);
    const clock = userClock(ctx, req.user.sub);
    // Quests, achievements, streaks and Body Quest derive from the workouts table, so a retry can't double-count them.
    syncRecognition(ctx, req.user.sub, clock);
    return reply.status(duplicate ? 200 : 201).send({
      duplicate,
      ...completionSummary(ctx.db, req.user.sub, workoutId),
      progress: computeUserProgress(ctx.db, req.user.sub, clock.today, ctx.now()),
    });
  });

  // ---- History & exercises -------------------------------------------------------------

  app.get("/workouts/:id", async (req) => {
    const { id: workoutId } = id.parse(req.params);
    return completionSummary(ctx.db, req.user.sub, workoutId);
  });

  /** FORM Pro: form and range-of-motion history, technique trends and form by load, for one exercise. */
  app.get("/exercises/:exerciseId/form-intelligence", async (req) => {
    const { exerciseId } = z.object({ exerciseId: z.string().regex(/^[a-z0-9_]{1,40}$/) }).parse(req.params);
    const { range } = z.object({ range: z.enum(["30", "90"]).default("90") }).strict().parse(req.query);
    requireFeature(ctx, req.user.sub, "ADVANCED_FORM_ANALYSIS", "Form history and technique trends are part of FORM Pro.");
    const exercise = EXERCISE_BY_ID.get(exerciseId);
    if (!exercise) throw new HttpError(404, "not_found", "Exercise not found");
    const clock = userClock(ctx, req.user.sub);
    const from = addDays(clock.today, -(Number(range) - 1));
    const rows = ctx.db
      .prepare(
        `SELECT w.id AS workoutId, w.local_date AS localDate, ws.load_kg AS loadKg, r.form_score AS formScore, r.rom_percent AS romPercent, r.issues
         FROM verified_reps r JOIN workout_sets ws ON ws.id = r.set_id JOIN workouts w ON w.id = ws.workout_id
         WHERE w.user_id = ? AND ws.exercise_id = ? AND w.local_date >= ? AND w.pain_level <> 'serious'
         ORDER BY w.local_date`,
      )
      .all(req.user.sub, exerciseId, from) as { workoutId: string; localDate: string; loadKg: number; formScore: number | null; romPercent: number | null; issues: string | null }[];
    const parsed = rows.map((r) => ({
      ...r,
      issues: ((): FormIssueCode[] => {
        try {
          return (JSON.parse(r.issues ?? "[]") as (string | { code: string })[]).map((i) => (typeof i === "string" ? i : i.code)) as FormIssueCode[];
        } catch {
          return [];
        }
      })(),
    }));
    return { exercise: { id: exercise.id, name: exercise.name, cameraVerifiable: exercise.cameraVerifiable }, range: Number(range), from, to: clock.today, intelligence: formIntelligence(parsed, { from, to: clock.today }) };
  });

  app.get("/exercises/:exerciseId", async (req) => {
    const { exerciseId } = z.object({ exerciseId: z.string().regex(/^[a-z0-9_]{1,40}$/) }).parse(req.params);
    const exercise = EXERCISE_BY_ID.get(exerciseId);
    if (!exercise) throw new HttpError(404, "not_found", "Exercise not found");
    const history = ctx.db
      .prepare(
        `SELECT w.id AS workoutId, w.local_date AS localDate, ws.reps, ws.verified_reps AS verifiedReps, ws.load_kg AS loadKg, ws.rom_percent AS romPercent
         FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id
         WHERE w.user_id = ? AND ws.exercise_id = ? ORDER BY w.local_date DESC, w.created_at DESC, ws.set_index LIMIT 60`,
      )
      .all(req.user.sub, exerciseId) as { workoutId: string; localDate: string; reps: number; verifiedReps: number; loadKg: number; romPercent: number | null }[];
    const sessions: { workoutId: string; localDate: string; sets: { reps: number; verifiedReps: number; loadKg: number; romPercent: number | null }[] }[] = [];
    for (const { workoutId, localDate, ...set } of history) {
      let s = sessions.find((x) => x.workoutId === workoutId);
      if (!s) {
        if (sessions.length === 5) break;
        s = { workoutId, localDate, sets: [] };
        sessions.push(s);
      }
      s.sets.push(set);
    }
    const bests = ctx.db
      .prepare("SELECT kind, MAX(value) AS value FROM personal_records WHERE user_id = ? AND exercise_id = ? AND status = 'awarded' GROUP BY kind")
      .all(req.user.sub, exerciseId);
    return { exercise, history: sessions, records: bests, previous: previousPerformance(ctx.db, req.user.sub)[exerciseId] ?? null };
  });
}
