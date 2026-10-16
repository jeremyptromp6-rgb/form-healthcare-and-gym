import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { leaderboard, LEADERBOARD_PERIODS } from "./service";

export function leaderboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Top 50 by XP earned in the period, plus the caller's own place. People appear by name only if they opted in;
   * everyone else is "Athlete #code". Only a name, a place, points and a rank leave the server for anyone else.
   */
  app.get("/leaderboard", async (req) => {
    const q = z
      .object({ period: z.enum(LEADERBOARD_PERIODS).default("week"), today: dateKey.optional() })
      .strict()
      .parse(req.query);
    return leaderboard(ctx, req.user.sub, q.period, userClock(ctx, req.user.sub, q.today));
  });
}
