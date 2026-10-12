import { POST_WORKOUT_AD_EVENTS, requestAd } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { entitlementsFor } from "../billing/entitlements";
import { loadSettings } from "../users/repo";
import { decidePostWorkoutAd, recordPostWorkoutAdEvent } from "./postWorkout";

/** Ads boundary: the AdService decides; personalization follows the user's stored consent (off by default). */
export function adRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/ads/decision", async (req) => {
    const { placement } = z.object({ placement: z.string().max(40) }).parse(req.query);
    return requestAd({
      entitlements: entitlementsFor(ctx, req.user.sub),
      placement,
      personalizedConsent: loadSettings(ctx.db, req.user.sub).personalizedAdsConsent,
      provider: ctx.providers.ads,
    });
  });

  // Post-workout ad (Prompt S): asked only after the workout is committed; the server owns the daily cap.
  app.post("/ads/post-workout", async (req) => {
    const { workoutId } = z.object({ workoutId: z.string().uuid() }).parse(req.body);
    return decidePostWorkoutAd(ctx, req.user.sub, workoutId);
  });

  app.post("/ads/post-workout/:adId/events", async (req) => {
    const { adId } = z.object({ adId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ event: z.enum(POST_WORKOUT_AD_EVENTS), reason: z.string().regex(/^[a-z0-9_]{1,40}$/).optional() })
      .parse(req.body);
    return recordPostWorkoutAdEvent(ctx, req.user.sub, adId, body.event, body.reason);
  });
}
