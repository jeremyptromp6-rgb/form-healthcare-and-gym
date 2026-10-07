import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../shared/context";
import { userClock } from "../../shared/userClock";
import { syncQuests } from "./service";

export function questRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/quests", async (req) => {
    const clock = userClock(ctx, req.user.sub);
    return { date: clock.today, weekStart: clock.weekStart, ...syncQuests(ctx, req.user.sub, clock) };
  });
}
