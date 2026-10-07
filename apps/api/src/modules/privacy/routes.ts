import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { verifyPassword } from "../auth/passwords";
import { dataMap, deleteAccount, exportUserData } from "./service";

const reauth = z.object({ password: z.string().min(1).max(128) });

/** Privacy center: what FORM stores, a full export, and account deletion. All re-authenticated where it matters. */
export function privacyRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** How many records FORM holds for the user, by table — the privacy center's "what we store". */
  app.get("/me/data-summary", async (req) => {
    const map = dataMap(ctx.db);
    const counts: Record<string, number> = {};
    for (const t of map.userTables) counts[t] = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(req.user.sub) as { n: number }).n;
    return { counts };
  });

  /** A full, structured export. Needs the password again, is rate limited, and is never cached. */
  app.post("/me/export", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { password } = reauth.strict().parse(req.body);
    const row = ctx.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.sub) as { password_hash: string } | undefined;
    if (!row || !(await verifyPassword(password, row.password_hash))) throw new HttpError(403, "password_incorrect", "Password is incorrect");
    const date = ctx.now().toISOString().slice(0, 10);
    return reply
      .header("content-disposition", `attachment; filename="form-export-${date}.json"`)
      .header("cache-control", "no-store")
      .send(exportUserData(ctx, req.user.sub));
  });

  /** Permanently deletes the account and everything it owns — only after re-authentication and an explicit confirmation. */
  app.delete("/me", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const body = reauth.extend({ confirm: z.string().max(20), acknowledgeSubscription: z.boolean().optional() }).strict().parse(req.body);
    await deleteAccount(ctx, req.user.sub, body);
    return reply.status(204).send();
  });
}
