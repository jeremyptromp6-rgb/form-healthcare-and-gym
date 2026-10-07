import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../shared/context";

/**
 * Crash reporting, first-party: the app reports an unexpected render error (its last-resort error
 * boundary) and it lands in the structured logs with a request id. No third-party SDK, nothing
 * stored in the database. Reports are scrubbed of anything that looks personal (emails, tokens,
 * long numbers) and capped in size; the endpoint is public (a crash can happen before sign-in) and
 * rate limited.
 */
const report = z
  .object({
    name: z.string().max(80),
    message: z.string().max(1000),
    stack: z.string().max(8000).optional(),
    route: z.string().max(200).optional(),
    platform: z.enum(["ios", "android", "web"]),
    appVersion: z.string().max(40),
  })
  .strict();

/** Removes what could identify a person from free text that came from a crash. */
export function scrub(text: string, max: number): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [token]")
    .replace(/\d{6,}/g, "[number]")
    .slice(0, max);
}

export function clientErrorRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.post("/client-errors", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    const r = report.parse(req.body);
    req.log.error(
      {
        clientError: {
          name: scrub(r.name, 80),
          message: scrub(r.message, 300),
          stack: r.stack ? scrub(r.stack, 2000) : undefined,
          // Route patterns only: ids in paths are replaced.
          route: r.route ? scrub(r.route.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id"), 200) : undefined,
          platform: r.platform,
          appVersion: r.appVersion,
        },
      },
      "client error",
    );
    return reply.status(204).send();
  });
}
