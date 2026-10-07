import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db";

/**
 * Operational visibility without personal data.
 *
 * - Logs are structured (pino via Fastify), one JSON line per event, with the request id.
 * - Never logged: request or response bodies, auth headers, passwords, tokens, food names, chat
 *   text, photos, body measurements or email addresses. User ids are opaque UUIDs.
 * - Domain events (workout completed, record set, level up, quest completed…) are logged by type
 *   and key when they are first written, so the product's important moments are visible in
 *   operations without reading the database.
 */

/** Paths pino replaces with "[redacted]" wherever they appear in a logged object. */
export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "*.password",
  "*.currentPassword",
  "*.newPassword",
  "*.token",
  "*.email",
];

export interface DomainEventNotice {
  userId: string;
  type: string;
  key: string;
}

// One sink per database, so several apps in one process (tests) never cross streams.
const sinks = new WeakMap<Db, (e: DomainEventNotice) => void>();

export function observeDomainEvents(db: Db, sink: (e: DomainEventNotice) => void): void {
  sinks.set(db, sink);
}

/** Called wherever a domain event row is first inserted. */
export function domainEventWritten(db: Db, e: DomainEventNotice): void {
  sinks.get(db)?.(e);
}

/** The structured line for a domain event: type and key only — the payload stays in the database. */
export function logDomainEvent(log: FastifyBaseLogger, e: DomainEventNotice): void {
  log.info({ domainEvent: e.type, key: e.key, userId: e.userId }, "domain event");
}

/** An error's class and code, never its message (messages can carry user data from lower layers). */
export function errorKind(err: unknown): { error: string; code?: string } {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { error: err.name, ...(typeof code === "string" ? { code } : {}) };
  }
  return { error: typeof err };
}
