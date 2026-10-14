import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";
import { scrub } from "./clientErrors";

/**
 * Why the native camera engine handed over to the WebView engine on a phone: one short technical
 * line per handover, so the operator can read it on /status. Anonymous by construction: the route
 * needs a signed-in user only to keep random traffic out, and the stored report has no user id, no
 * address and no images. Kept in memory (the last 20); a restart clears them, which is fine for a
 * diagnostic.
 */
const MAX_REPORTS = 20;

const body = z
  .object({
    reason: z.string().max(200),
    build: z.string().max(40),
    os: z.string().max(40),
    device: z.string().max(60),
    engine: z.literal("native"),
  })
  .strict();

export interface CameraReport {
  at: string;
  reason: string;
  build: string;
  os: string;
  device: string;
}

// One buffer per running app (tests build many), newest first.
const buffers = new WeakMap<object, CameraReport[]>();

/** Control characters out, anything that looks personal scrubbed, trimmed and capped. */
function clean(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return scrub(text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " "), max).trim();
}

/** The stored reports, newest first. Safe to publish: see the file comment. */
export function recentCameraReports(ctx: AppContext): CameraReport[] {
  return [...(buffers.get(ctx) ?? [])];
}

export function cameraReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    "/diagnostics/camera",
    {
      bodyLimit: 4 * 1024,
      // Per signed-in user (the authentication hook has already run), not per address.
      config: { rateLimit: { max: 5, timeWindow: "1 hour", keyGenerator: (req: { user?: { sub?: string }; ip: string }) => req.user?.sub ?? req.ip } },
    },
    async (req, reply) => {
      const r = body.parse(req.body);
      const list = buffers.get(ctx) ?? [];
      list.unshift({ at: ctx.now().toISOString(), reason: clean(r.reason, 200), build: clean(r.build, 40), os: clean(r.os, 40), device: clean(r.device, 60) });
      list.length = Math.min(list.length, MAX_REPORTS);
      buffers.set(ctx, list);
      return reply.status(204).send();
    },
  );
}
