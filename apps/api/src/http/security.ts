import type { FastifyInstance } from "fastify";

/** Baseline security headers for a JSON API. Responses carry personal data, so nothing is cached. */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-resource-policy", "same-site");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("cache-control", "no-store");
    return payload;
  });
}
