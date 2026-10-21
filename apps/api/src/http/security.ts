import type { FastifyInstance } from "fastify";

/** Baseline security headers for a JSON API. Responses carry personal data, so nothing is cached unless a route says otherwise. */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-resource-policy", "same-site");
    // The public legal pages (modules/legal) set their own, still strict, CSP and a cacheable policy.
    if (!reply.hasHeader("content-security-policy")) reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });
}
