import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { listRecords } from "../records/service";
import { syncRecognition } from "../recognition/service";
import { computeUserProgress, recentLedger, settleProgression } from "./service";

export function progressionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/progress", async (req) => {
    const { today } = z.object({ today: dateKey.optional() }).parse(req.query);
    const clock = userClock(ctx, req.user.sub, today);
    // Settle quests, achievements and the rest first so the XP total includes them.
    syncRecognition(ctx, req.user.sub, clock);
    return computeUserProgress(ctx.db, req.user.sub, clock.today, ctx.now());
  });

  /** Current best for every metric, compared in each metric's own direction. */
  app.get("/records", async (req) => ({ records: listRecords(ctx.db, req.user.sub, userClock(ctx, req.user.sub).today) }));

  /** The XP ledger, newest first — every award, adjustment, decay and reset, for transparency. */
  app.get("/xp/events", async (req) => {
    const { limit, before } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.coerce.number().int().positive().optional() }).parse(req.query);
    // Apply any finished days first, so the history is complete.
    settleProgression(ctx.db, req.user.sub, userClock(ctx, req.user.sub).today, ctx.now());
    return { events: recentLedger(ctx.db, req.user.sub, limit, before) };
  });
}
