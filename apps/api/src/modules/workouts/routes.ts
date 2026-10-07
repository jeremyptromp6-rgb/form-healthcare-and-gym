import { randomUUID } from "node:crypto";
import { EXERCISES, evaluateWorkout } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction } from "../../db";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { assertEntryDate, userClock } from "../../shared/userClock";
import { computeUserProgress } from "../progression/service";
import { syncRecognition } from "../recognition/service";
import { findByClientId, insertWorkout, listWorkouts, minutesTrainedOn } from "./repo";
import { traceSchema } from "./traceSchema";


// Note the absence of any `verifiedReps` or `xp` field: .strict() rejects them, so the
// client cannot assert verification or XP. The Workout Engine decides both.
const setSchema = z
  .object({
    exerciseId: z.string().regex(/^[a-z0-9_]{1,40}$/),
    reps: z.number().int().min(0).max(200),
    loadKg: z.number().min(0).max(1000).default(0),
    trace: traceSchema.optional(),
  })
  .strict();

const workoutSchema = z
  .object({
    clientWorkoutId: z.string().uuid(),
    localDate: dateKey,
    durationMinutes: z.number().int().min(1).max(600),
    painLevel: z.enum(["none", "mild", "serious"]),
    sets: z.array(setSchema).max(100),
  })
  .strict();

export function workoutRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/exercises", async () => ({ exercises: EXERCISES }));

  app.post("/workouts", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const userId = req.user.sub;
    const body = workoutSchema.parse(req.body);
    const now = ctx.now();

    // A retry is answered first: a workout saved before midnight and retried after it is still the same workout.
    const existing = findByClientId(ctx.db, userId, body.clientWorkoutId);
    if (existing) {
      // Idempotent retry: never award XP twice for the same workout.
      return reply.status(200).send({
        duplicate: true,
        workout: { id: existing.id, xp: existing.xp, flags: JSON.parse(existing.flags) },
        progress: computeUserProgress(ctx.db, userId, body.localDate, now),
      });
    }
    assertEntryDate(ctx, userId, body.localDate);

    const { sets } = evaluateWorkout({
      sets: body.sets,
      durationMinutes: body.durationMinutes,
      priorTrainingMinutesToday: minutesTrainedOn(ctx.db, userId, body.localDate),
      painLevel: body.painLevel,
    });

    const id = randomUUID();
    const { prs, award } = transaction(ctx.db, () =>
      insertWorkout(ctx.db, {
        id,
        userId,
        clientWorkoutId: body.clientWorkoutId,
        localDate: body.localDate,
        durationMinutes: body.durationMinutes,
        painLevel: body.painLevel,
        sets,
        priorTrainingMinutesToday: minutesTrainedOn(ctx.db, userId, body.localDate),
        now,
      }),
    );

    syncRecognition(ctx, userId, userClock(ctx, userId, body.localDate));
    return reply.status(201).send({
      duplicate: false,
      workout: {
        id,
        xp: award.xp,
        flags: award.flags,
        breakdown: award.breakdown,
        sets: sets.map(({ verifiedRepDetails, ...s }) => ({ ...s, verifiedRepCount: verifiedRepDetails.length })),
      },
      prs,
      progress: computeUserProgress(ctx.db, userId, body.localDate, now),
    });
  });

  app.get("/workouts", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    return { workouts: listWorkouts(ctx.db, req.user.sub, limit) };
  });
}
