import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./passwords";
import { authenticate, issueToken } from "./session";

const credentials = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(10, "Password must be at least 10 characters").max(128),
  })
  .strict();

const AUTH_RATE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

/** Public auth routes (register, login) and the configured legal links. */
export function authRoutes(app: FastifyInstance, ctx: AppContext): void {
  const logins = new LoginThrottle();
  /** Terms and privacy policy links, if the operator has published them (null otherwise). */
  app.get("/legal", async () => ctx.config.legal);

  app.post("/auth/register", AUTH_RATE_LIMIT, async (req, reply) => {
    const { email, password } = credentials.parse(req.body);
    if (ctx.db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
      throw new HttpError(409, "email_taken", "An account with this email already exists");
    }
    const id = randomUUID();
    const hash = await hashPassword(password);
    try {
      ctx.db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)").run(id, email, hash, ctx.now().toISOString());
    } catch (err) {
      // Two sign-ups for one email at once: the second loses the race on the unique index.
      if (/UNIQUE/.test(String((err as Error).message))) throw new HttpError(409, "email_taken", "An account with this email already exists");
      throw err;
    }
    return reply.status(201).send({ token: issueToken(app, { id, token_version: 0 }), user: { id, email } });
  });

  app.post("/auth/login", AUTH_RATE_LIMIT, async (req) => {
    const { email, password } = credentials.extend({ password: z.string().min(1).max(128) }).parse(req.body);
    // Per account, whatever the caller's IP: slows password guessing spread across many addresses.
    // Applies to unknown emails too, so the throttle doesn't reveal which accounts exist.
    if (logins.blocked(email, ctx.now())) throw new HttpError(429, "too_many_attempts", "Too many sign-in attempts for this account. Wait a few minutes and try again.");
    const user = ctx.db.prepare("SELECT id, email, password_hash, token_version FROM users WHERE email = ?").get(email) as
      | { id: string; email: string; password_hash: string; token_version: number }
      | undefined;
    // Always run a hash comparison so response timing doesn't reveal which emails exist.
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      logins.failed(email, ctx.now());
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    }
    logins.succeeded(email);
    return { token: issueToken(app, user), user: { id: user.id, email: user.email } };
  });
}

/** Authenticated session routes. */
export function sessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Changes the password. Needs the current one; signs out every other device (their tokens stop
   * working) and returns a fresh token for this one.
   */
  app.post("/auth/password", AUTH_RATE_LIMIT, async (req) => {
    const { currentPassword, newPassword } = z
      .object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10, "Password must be at least 10 characters").max(128) })
      .strict()
      .parse(req.body);
    const user = ctx.db.prepare("SELECT id, password_hash, token_version FROM users WHERE id = ?").get(req.user.sub) as { id: string; password_hash: string; token_version: number };
    if (!(await verifyPassword(currentPassword, user.password_hash))) throw new HttpError(403, "password_incorrect", "Current password is incorrect");
    if (currentPassword === newPassword) throw new HttpError(400, "password_unchanged", "Choose a different password");
    ctx.db.prepare("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?").run(await hashPassword(newPassword), user.id);
    return { token: issueToken(app, { id: user.id, token_version: user.token_version + 1 }) };
  });

  /** Revokes every token issued to this user, on every device. */
  app.post("/auth/logout-all", async (req, reply) => {
    ctx.db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(req.user.sub);
    return reply.status(204).send();
  });
}

export { authenticate };

/**
 * Failed sign-ins per email in a sliding window (in memory: per server process). After
 * LOGIN_THROTTLE.maxFailures, the account refuses attempts until the window passes; a success clears it.
 */
export const LOGIN_THROTTLE = { maxFailures: 10, windowMs: 15 * 60_000 } as const;

class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  private recent(email: string, now: Date): number[] {
    const since = now.getTime() - LOGIN_THROTTLE.windowMs;
    const list = (this.failures.get(email) ?? []).filter((t) => t > since);
    if (list.length) this.failures.set(email, list);
    else this.failures.delete(email);
    return list;
  }

  blocked(email: string, now: Date): boolean {
    return this.recent(email, now).length >= LOGIN_THROTTLE.maxFailures;
  }

  failed(email: string, now: Date): void {
    this.failures.set(email, [...this.recent(email, now), now.getTime()]);
    // Bound memory under a spray of random emails: forget the oldest entries.
    if (this.failures.size > 50_000) for (const k of [...this.failures.keys()].slice(0, 10_000)) this.failures.delete(k);
  }

  succeeded(email: string): void {
    this.failures.delete(email);
  }
}
