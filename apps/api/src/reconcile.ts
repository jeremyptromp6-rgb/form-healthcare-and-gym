/**
 * Reconciliation CLI (operations). Audits every user — or one — for derived state that disagrees
 * with its source records, and with --repair applies only the safe, append-only repairs (see
 * modules/integrity/service.ts). Prints one JSON report; never prints personal content.
 *
 *   node dist/reconcile.js [--repair] [--user <id>]
 *   npm run reconcile -w @form/api -- [--repair] [--user <id>]
 *
 * Exit code: 0 when no errors remain, 1 when some do (for scheduled checks and alerting).
 */
import { existsSync } from "node:fs";
import { localDateIn } from "@form/domain";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { auditDatabase, auditUser, repairUser, type Finding } from "./modules/integrity/service";

if (existsSync(".env")) process.loadEnvFile(".env");

const args = process.argv.slice(2);
const repair = args.includes("--repair");
const only = args.includes("--user") ? args[args.indexOf("--user") + 1] : undefined;

const config = loadConfig();
const db = openDb(config.databasePath);
const now = new Date();
try {
  const users = (only ? [{ id: only }] : db.prepare("SELECT id FROM users ORDER BY created_at").all()) as { id: string }[];
  const results: { userId: string; repaired: Finding[]; findings: Finding[] }[] = [];
  for (const { id } of users) {
    const tz = (db.prepare("SELECT timezone FROM user_settings WHERE user_id = ?").get(id) as { timezone: string | null } | undefined)?.timezone;
    const today = tz ? localDateIn(tz, now) : now.toISOString().slice(0, 10);
    const r = repair ? repairUser(db, id, today, now) : { repaired: [], remaining: auditUser(db, id, today, now) };
    if (r.repaired.length || r.remaining.length) results.push({ userId: id, repaired: r.repaired, findings: r.remaining });
  }
  const database = auditDatabase(db);
  const all = [...database, ...results.flatMap((r) => r.findings)];
  const count = (s: Finding["severity"]) => all.filter((f) => f.severity === s).length;
  const report = {
    at: now.toISOString(),
    mode: repair ? "repair" : "audit",
    usersChecked: users.length,
    errors: count("error"),
    warnings: count("warning"),
    info: count("info"),
    repaired: results.reduce((a, r) => a + r.repaired.length, 0),
    database,
    users: results,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.errors > 0 ? 1 : 0;
} finally {
  db.close();
}
