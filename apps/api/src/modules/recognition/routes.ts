import { bodyQuestInsights } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { can } from "../billing/entitlements";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { bodyQuestView, computeStreaks, markCelebrationsSeen, pendingCelebrations, syncAchievements, syncRecognition } from "./service";

/** Recognition: achievements, streaks, Body Quest and the celebration feed. Read-only for clients, except marking a celebration seen. */
export function recognitionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const clockFor = (req: { user: { sub: string }; query: unknown }) => {
    const { today } = z.object({ today: dateKey.optional() }).parse(req.query);
    const clock = userClock(ctx, req.user.sub, today);
    syncRecognition(ctx, req.user.sub, clock);
    return clock;
  };

  app.get("/achievements", async (req) => {
    const clock = clockFor(req);
    return { achievements: syncAchievements(ctx.db, req.user.sub, clock.today, ctx.now()) };
  });

  app.get("/streaks", async (req) => {
    const clock = clockFor(req);
    return { today: clock.today, timezone: clock.timezone, streaks: computeStreaks(ctx.db, req.user.sub, clock.today) };
  });

  app.get("/body-quest", async (req) => {
    const clock = clockFor(req);
    const bq = bodyQuestView(ctx.db, req.user.sub, clock.today, ctx.now());
    const pro = can(ctx, req.user.sub, "ADVANCED_BODY_QUEST");
    return { bodyQuest: bq, insights: pro ? bodyQuestInsights(bq, bq.snapshots) : null, insightsLocked: !pro };
  });

  app.get("/celebrations", async (req) => {
    clockFor(req);
    return { celebrations: pendingCelebrations(ctx.db, req.user.sub, ctx.now()) };
  });

  app.post("/celebrations/seen", async (req) => {
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1).max(50) }).strict().parse(req.body);
    return { marked: markCelebrationsSeen(ctx.db, req.user.sub, ids, ctx.now()) };
  });
}
