import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { buildHome } from "./service";

export function homeRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * The Home view model. The server decides the date from the user's stored time zone;
   * `today` is only a fallback for users who haven't saved a time zone yet.
   */
  app.get("/home", async (req) => {
    const { today } = z.object({ today: dateKey.optional() }).parse(req.query);
    return buildHome(ctx, req.user.sub, userClock(ctx, req.user.sub, today));
  });
}
