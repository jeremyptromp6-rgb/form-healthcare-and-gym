import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations";

export type Db = DatabaseSync;

export function openDb(path: string, migrations: readonly Migration[] = MIGRATIONS): Db {
  const db = new DatabaseSync(path);
  // Wait for a briefly-held lock (e.g. a previous process shutting down) instead of failing.
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db, migrations);
  return db;
}

export function schemaVersion(db: Db): number {
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  return row.v ?? 0;
}

export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);");
  const current = schemaVersion(db);
  for (const m of migrations) {
    if (m.version <= current) continue;
    transaction(db, () => {
      if (typeof m.up === "string") db.exec(m.up);
      else m.up(db);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(m.version);
    });
  }
}

/** Runs `fn` atomically. Reentrant: called inside another transaction, it joins that one. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
