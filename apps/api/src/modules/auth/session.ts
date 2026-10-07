import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    /** sub: user id. tv: the user's token_version when the token was issued. */
    payload: { sub: string; tv: number };
    user: { sub: string; tv: number };
  }
}

export function issueToken(app: FastifyInstance, user: { id: string; token_version: number }): string {
  return app.jwt.sign({ sub: user.id, tv: user.token_version });
}

/**
 * onRequest hook for every authenticated route: the token must verify, the user must
 * still exist, and the token must not have been revoked (token_version bumped).
 */
export function authenticate(ctx: AppContext) {
  return async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, "unauthorized", "Sign in required");
    }
    const row = ctx.db.prepare("SELECT token_version FROM users WHERE id = ?").get(req.user.sub) as { token_version: number } | undefined;
    if (!row || row.token_version !== req.user.tv) {
      throw new HttpError(401, "unauthorized", "Session expired. Sign in again.");
    }
  };
}
