import { randomUUID } from "node:crypto";
import { addDays, WATER_LIMITS, waterTargetMl } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { assertEntryDate, userClock } from "../../shared/userClock";
import { loadProfile } from "../users/repo";

const MAX_BACKDATE_DAYS = 2;

export function waterDay(ctx: AppContext, userId: string, date: string) {
  const entries = ctx.db
    .prepare("SELECT id, ml, created_at AS createdAt FROM water_logs WHERE user_id = ? AND local_date = ? ORDER BY created_at, rowid")
    .all(userId, date) as { id: string; ml: number; createdAt: string }[];
  const { targetMl, basis } = waterTargetMl(loadProfile(ctx.db, userId)?.weightKg ?? null);
  return { date, totalMl: entries.reduce((a, e) => a + e.ml, 0), targetMl, targetBasis: basis, entries };
}

/** Water logging. Quick-adds carry a client id, so a double tap or a retried request never counts twice. */
export function waterRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/water", async (req, reply) => {
    const body = z
      .object({
        clientLogId: z.string().uuid(),
        ml: z.number().int().min(WATER_LIMITS.perEntryMl.min).max(WATER_LIMITS.perEntryMl.max),
        localDate: dateKey.optional(),
      })
      .strict()
      .parse(req.body);
    const clock = userClock(ctx, req.user.sub);
    const localDate = body.localDate ?? clock.today;
    if (body.localDate) assertEntryDate(ctx, req.user.sub, body.localDate, MAX_BACKDATE_DAYS);

    const result = transaction(ctx.db, () => {
      const existing = ctx.db.prepare("SELECT id, local_date AS localDate, ml FROM water_logs WHERE user_id = ? AND client_log_id = ?").get(req.user.sub, body.clientLogId) as
        | { id: string; localDate: string; ml: number }
        | undefined;
      if (existing) return { duplicate: true, entry: existing };

      const { total } = ctx.db.prepare("SELECT COALESCE(SUM(ml), 0) AS total FROM water_logs WHERE user_id = ? AND local_date = ?").get(req.user.sub, localDate) as { total: number };
      if (total + body.ml > WATER_LIMITS.dailyMaxMl) {
        throw new HttpError(422, "water_daily_limit", "That's a lot of water for one day. Drinking far more than you need can be dangerous — FORM won't log more today.");
      }
      const id = randomUUID();
      ctx.db
        .prepare("INSERT INTO water_logs (id, user_id, client_log_id, local_date, ml, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, req.user.sub, body.clientLogId, localDate, body.ml, ctx.now().toISOString());
      return { duplicate: false, entry: { id, localDate, ml: body.ml } };
    });

    return reply.status(result.duplicate ? 200 : 201).send({ ...result, day: waterDay(ctx, req.user.sub, localDate) });
  });

  app.get("/water/days/:date", async (req) => {
    const { date } = z.object({ date: dateKey }).parse(req.params);
    return waterDay(ctx, req.user.sub, date);
  });

  /** Daily totals for the last `days` days (today included), oldest first, zero-filled. */
  app.get("/water/history", async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    const clock = userClock(ctx, req.user.sub);
    const from = addDays(clock.today, -(days - 1));
    const rows = ctx.db
      .prepare("SELECT local_date AS d, SUM(ml) AS ml, COUNT(*) AS n FROM water_logs WHERE user_id = ? AND local_date BETWEEN ? AND ? GROUP BY local_date")
      .all(req.user.sub, from, clock.today) as { d: string; ml: number; n: number }[];
    const { targetMl } = waterTargetMl(loadProfile(ctx.db, req.user.sub)?.weightKg ?? null);
    const byDate = new Map(rows.map((r) => [r.d, r]));
    const out = Array.from({ length: days }, (_, i) => {
      const date = addDays(from, i);
      const r = byDate.get(date);
      return { date, totalMl: r?.ml ?? 0, entries: r?.n ?? 0, metTarget: (r?.ml ?? 0) >= targetMl };
    });
    const logged = out.filter((d) => d.entries > 0);
    return {
      days: out,
      targetMl,
      averageMl: logged.length ? Math.round(logged.reduce((a, d) => a + d.totalMl, 0) / logged.length) : null,
      daysMetTarget: out.filter((d) => d.metTarget).length,
    };
  });

  app.delete("/water/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const r = ctx.db.prepare("DELETE FROM water_logs WHERE id = ? AND user_id = ?").run(id, req.user.sub);
    if (r.changes === 0) throw new HttpError(404, "not_found", "Entry not found");
    return reply.status(204).send();
  });
}
