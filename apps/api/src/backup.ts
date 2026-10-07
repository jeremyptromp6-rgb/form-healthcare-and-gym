/**
 * Backup CLI (operations). Writes a verified, consistent snapshot of the database while the API
 * runs, keeps the newest --keep (default 14), and prints one JSON line. Schedule it (cron, a
 * platform job) and copy BACKUP_DIR off the machine — a backup on the same disk isn't a backup.
 *
 *   node dist/backup.js [--dir <dir>] [--keep <n>]
 *   npm run backup -w @form/api -- [--dir <dir>] [--keep <n>]
 *
 * Exit code 0 on a verified backup, 1 otherwise. Restore steps: modules/backup/service.ts.
 */
import { existsSync } from "node:fs";
import { loadConfig } from "./config";
import { backupDatabase } from "./modules/backup/service";

if (existsSync(".env")) process.loadEnvFile(".env");

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const config = loadConfig();
const dir = arg("--dir") ?? process.env.BACKUP_DIR ?? "./backups";
const keep = Number(arg("--keep") ?? process.env.BACKUP_KEEP ?? 14);

try {
  const result = backupDatabase(config.databasePath, dir, { keep });
  console.log(JSON.stringify({ ok: true, ...result }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
}
