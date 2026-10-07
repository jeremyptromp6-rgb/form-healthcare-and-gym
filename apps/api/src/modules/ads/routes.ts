import { requestAd } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { entitlementsFor } from "../billing/entitlements";
import { loadSettings } from "../users/repo";

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
}
