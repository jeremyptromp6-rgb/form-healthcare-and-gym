import { ANALYTICS_RANGES, hasFeature } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { entitlementsFor, proRequired } from "../billing/entitlements";
import { lockForTier, progressAnalytics } from "./service";

export function analyticsRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Progress analytics for 7, 30 or 90 local days, optionally focused on one exercise. */
  app.get("/analytics/progress", async (req) => {
    const q = z
      .object({
        range: z.coerce.number().refine((n): n is (typeof ANALYTICS_RANGES)[number] => (ANALYTICS_RANGES as readonly number[]).includes(n), "range must be 7, 30 or 90").default(30),
        exercise: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
        today: dateKey.optional(),
      })
      .strict()
      .parse(req.query);
    const e = entitlementsFor(ctx, req.user.sub);
    if (q.range > 30 && !hasFeature(e, "ADVANCED_PROGRESS")) throw proRequired("ADVANCED_PROGRESS", "90-day analysis is part of FORM Pro. 7- and 30-day progress is free.");
    const clock = userClock(ctx, req.user.sub, q.today);
    const analytics = progressAnalytics(ctx, req.user.sub, clock, { range: q.range as (typeof ANALYTICS_RANGES)[number], exerciseId: q.exercise });
    return { analytics: lockForTier(analytics, e) };
  });
}
