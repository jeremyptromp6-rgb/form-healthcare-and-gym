import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Backups of the SQLite database. `VACUUM INTO` writes a consistent, compacted snapshot while the
 * server keeps running (WAL readers don't block it). Every backup is reopened and verified —
 * SQLite's integrity check, the schema version, and table row counts — before older ones are
 * rotated out, so a bad backup never replaces good ones.
 *
 * Restore: stop the API, copy a verified backup over DATABASE_PATH, delete any leftover
 * DATABASE_PATH-wal / -shm files, start the API (migrations bring an older backup forward).
 */

export const BACKUP_PATTERN = /^form-\d{8}T\d{6}Z\.db$/;

export interface BackupResult {
  file: string;
  bytes: number;
  schemaVersion: number;
  users: number;
  integrity: "ok";
  removed: string[];
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Opens a backup read-only and proves it's usable. Throws if it isn't. */
export function verifyBackup(file: string): { schemaVersion: number; users: number } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    if (check.length !== 1 || check[0]!.integrity_check !== "ok") throw new Error(`integrity check failed: ${JSON.stringify(check.slice(0, 3))}`);
    const v = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
    const users = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
    return { schemaVersion: v.v ?? 0, users: users.n };
  } finally {
    db.close();
  }
}

export function backupDatabase(databasePath: string, dir: string, opts: { now?: Date; keep?: number } = {}): BackupResult {
  const now = opts.now ?? new Date();
  const keep = Math.max(1, opts.keep ?? 14);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `form-${stamp(now)}.db`);

  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    source.exec("PRAGMA busy_timeout = 10000;");
    source.prepare("VACUUM INTO ?").run(file);
  } finally {
    source.close();
  }

  let verified: { schemaVersion: number; users: number };
  try {
    verified = verifyBackup(file);
  } catch (err) {
    rmSync(file, { force: true }); // never keep (or rotate in favour of) a bad copy
    throw err;
  }

  const backups = readdirSync(dir).filter((f) => BACKUP_PATTERN.test(f)).sort();
  const removed = backups.slice(0, Math.max(0, backups.length - keep));
  for (const f of removed) rmSync(join(dir, f), { force: true });
  return { file, bytes: statSync(file).size, ...verified, integrity: "ok", removed };
}
