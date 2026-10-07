import type { Db } from "../../db";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { entitlementsFor } from "../billing/entitlements";
import { errorKind } from "../../shared/observability";
import { verifyPassword } from "../auth/passwords";
import { forgetUserAnalytics } from "../analytics/service";

/**
 * Privacy center: export and deletion.
 *
 * Export is a structured JSON document of everything FORM stores about the user — every table that
 * holds their data, found from the schema itself (any table with a user_id column, plus the child
 * tables that hang off them), so a new table can't be silently left out. Credentials and internal
 * session counters are never included. Deletion removes the account and every row it owns in one
 * transaction, then checks that nothing is left before reporting success.
 */

/** Tables whose rows belong to a user through a parent table rather than a user_id column. */
const CHILD_TABLES: Record<string, { parent: string; key: string }> = {
  workout_sets: { parent: "workouts", key: "workout_id" },
  verified_reps: { parent: "workout_sets", key: "set_id" },
  session_sets: { parent: "workout_sessions", key: "session_id" },
  planned_meals: { parent: "meal_plans", key: "plan_id" },
};
/** Tables that hold no user data. */
// dev_store_transactions is the development store's own (store-side) ledger: no FORM user ids.
const SYSTEM_TABLES = new Set(["schema_migrations", "sqlite_sequence", "provider_usage", "dev_store_transactions"]);
/** Columns that are never exported. */
const REDACTED: Record<string, string[]> = { users: ["password_hash", "token_version"] };

function tables(db: Db): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

function columns(db: Db, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/** Every table that holds a user's rows, how to find them, and which are deliberately excluded. */
export function dataMap(db: Db): { userTables: string[]; childTables: string[]; system: string[]; unaccounted: string[] } {
  const all = tables(db);
  const userTables = all.filter((t) => t !== "users" && columns(db, t).includes("user_id"));
  const childTables = all.filter((t) => t in CHILD_TABLES);
  const system = all.filter((t) => SYSTEM_TABLES.has(t));
  const unaccounted = all.filter((t) => t !== "users" && !userTables.includes(t) && !childTables.includes(t) && !system.includes(t));
  return { userTables, childTables, system, unaccounted };
}

function serialize(row: Record<string, unknown>, table: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (REDACTED[table]?.includes(k)) continue;
    out[k] = v instanceof Uint8Array ? { encoding: "base64", data: Buffer.from(v).toString("base64") } : typeof v === "string" && /^[[{]/.test(v) ? tryJson(v) : v;
  }
  return out;
}
const tryJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

function childRows(db: Db, table: string, userId: string): Record<string, unknown>[] {
  // Walk up to the table that carries user_id.
  const chain: { table: string; key: string; parent: string }[] = [];
  let t = table;
  while (CHILD_TABLES[t]) {
    chain.push({ table: t, ...CHILD_TABLES[t]! });
    t = CHILD_TABLES[t]!.parent;
  }
  let sql = `SELECT c0.* FROM ${chain[0]!.table} c0`;
  chain.forEach((c, i) => {
    sql += ` JOIN ${c.parent} c${i + 1} ON c${i + 1}.id = c${i}.${c.key}`;
  });
  sql += ` WHERE c${chain.length}.user_id = ? ORDER BY c0.rowid`;
  return db.prepare(sql).all(userId) as Record<string, unknown>[];
}

export function exportUserData(ctx: AppContext, userId: string) {
  const { db } = ctx;
  const map = dataMap(db);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Record<string, unknown>;
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const t of map.userTables) data[t] = (db.prepare(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY rowid`).all(userId) as Record<string, unknown>[]).map((r) => serialize(r, t));
  for (const t of map.childTables) data[t] = childRows(db, t, userId).map((r) => serialize(r, t));
  return {
    format: "form-data-export",
    version: 1,
    exportedAt: ctx.now().toISOString(),
    user: serialize(user, "users"),
    notes: [
      "All measurements are stored in metric units (kg, cm, g, ml); dates are your local calendar dates.",
      "Your password is never exported. Photos are included as base64.",
      "Meal photos sent for recognition are not stored by FORM, so they are not part of this export.",
    ],
    data,
  };
}

// ---- Deletion ----------------------------------------------------------------------------------

export const DELETE_CONFIRMATION = "DELETE";

/** Rows still held for a user: by user_id, plus any child rows left without a parent. */
export function remainingData(db: Db, userId: string): Record<string, number> {
  const map = dataMap(db);
  const left: Record<string, number> = {};
  const user = db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(userId) as { n: number };
  if (user.n) left.users = user.n;
  for (const t of map.userTables) {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(userId) as { n: number }).n;
    if (n) left[t] = n;
  }
  for (const t of map.childTables) {
    const c = CHILD_TABLES[t]!;
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c.key} NOT IN (SELECT id FROM ${c.parent})`).get() as { n: number }).n;
    if (n) left[`${t} (orphaned)`] = n;
  }
  return left;
}

export async function deleteAccount(
  ctx: AppContext,
  userId: string,
  body: { password: string; confirm: string; acknowledgeSubscription?: boolean },
): Promise<void> {
  const { db } = ctx;
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined;
  if (!row) throw new HttpError(404, "not_found", "Account not found");
  // 403, not 401: the session is valid, only the confirmation failed. (A 401 would sign the user out.)
  if (!(await verifyPassword(body.password, row.password_hash))) throw new HttpError(403, "password_incorrect", "Password is incorrect");
  if (body.confirm !== DELETE_CONFIRMATION) throw new HttpError(400, "confirmation_required", `Type ${DELETE_CONFIRMATION} to confirm`);

  // A store subscription keeps billing until it's cancelled in the store; FORM can't cancel it.
  // Only a subscription that will renew keeps charging; a cancelled one just runs out.
  const e = entitlementsFor(ctx, userId);
  const renewingStore = e.tier === "pro" && e.willRenew && e.source === "store";
  if (renewingStore && !body.acknowledgeSubscription) {
    throw new HttpError(409, "subscription_active", "You have an active subscription. Cancel it in the App Store or Google Play (wherever you subscribed) — deleting your FORM account doesn't stop store billing.", { source: e.source, expiresAt: e.accessUntil?.toISOString() ?? null });
  }

  try {
    transaction(db, () => {
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
      const left = remainingData(db, userId);
      // Never report success while anything remains: roll the whole deletion back instead.
      if (Object.keys(left).length) throw new HttpError(500, "deletion_incomplete", "Your account couldn't be fully deleted, so nothing was deleted. Please try again.", { remaining: left });
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    ctx.log.error({ userId, ...errorKind(err) }, "account deletion failed and was rolled back");
    throw new HttpError(500, "deletion_failed", "Your account couldn't be deleted, so nothing was deleted. Please try again.");
  }
  forgetUserAnalytics(userId);
}
