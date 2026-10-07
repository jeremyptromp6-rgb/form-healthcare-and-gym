import { featureAvailability, providerStatuses } from "@form/domain";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../shared/context";

export function systemRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Provider status. Outside development, the names of missing secrets are not disclosed. */
  app.get("/system/providers", async () => {
    const statuses = providerStatuses(ctx.providers);
    return {
      providers: ctx.config.env === "production" ? statuses.map((s) => (s.state === "unconfigured" ? { kind: s.kind, state: s.state, provider: s.provider } : s)) : statuses,
    };
  });

  /** Which product features are live, so the app never offers one that cannot work. */
  app.get("/system/features", async () => ({ features: featureAvailability(providerStatuses(ctx.providers)) }));
}
