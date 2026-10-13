// Production entrypoint (`npm start -w @form/api`, Render's startCommand).
//
// With the four Litestream/R2 variables set, the database is first restored from the R2 replica
// (the free plan's filesystem is empty after every restart), then the server runs under
// `litestream replicate`, which streams every change back to R2 and does a final sync on shutdown.
// With none of them set (local use) the server just starts, with backups off.
//
// Safety rules: a half-configured backup refuses to start (a server silently running without backups
// in production is worse than a failed deploy), and a failed restore exits non-zero rather than
// starting an empty database that Litestream would then replicate as the new truth.
// Render deploys overlap the old and new instance for ~1 minute and Litestream 0.5.17 has no lease for
// two writers on one replica; this cannot be solved here (see docs/RELEASE.md, Backups).
// Nothing here ever prints a variable's value, only names.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BACKUP_VARS = ["R2_ACCOUNT_ID", "LITESTREAM_BUCKET", "LITESTREAM_ACCESS_KEY_ID", "LITESTREAM_SECRET_ACCESS_KEY"];
const LITESTREAM_BIN = "./bin/litestream";
const LITESTREAM_CONFIG = "litestream.yml";
const SERVER_ARGS = ["--enable-source-maps", "dist/server.js"];

const isSet = (env, name) => typeof env[name] === "string" && env[name].trim() !== "";

/**
 * What to do for this environment (pure; `hasBinary` says whether bin/litestream is installed).
 * Returns `{ action: "refuse", message }` or `{ action: "run", backup, log, restore?, command }`; commands
 * are `{ cmd, args }` (cmd "node" means the current Node). Only variable names ever appear in messages.
 */
export function startPlan(env, hasBinary) {
  const db = isSet(env, "DATABASE_PATH") ? env.DATABASE_PATH : "./form.db";
  const present = BACKUP_VARS.filter((n) => isSet(env, n));
  if (present.length === 0) {
    return { action: "run", backup: "off", log: "backups: off", command: { cmd: "node", args: SERVER_ARGS } };
  }
  if (present.length < BACKUP_VARS.length) {
    const missing = BACKUP_VARS.filter((n) => !present.includes(n));
    return { action: "refuse", message: `backups are half-configured; missing ${missing.join(", ")}. Set all of ${BACKUP_VARS.join(", ")} or none.` };
  }
  if (!hasBinary) {
    return { action: "refuse", message: "backups are configured but bin/litestream is missing; the build must run apps/api/scripts/install-litestream.sh" };
  }
  return {
    action: "run",
    backup: "litestream",
    log: "backups: on (Litestream to R2)",
    // -if-replica-exists: a first-ever start has nothing to restore. Any other failure is an error.
    restore: { cmd: LITESTREAM_BIN, args: ["restore", "-config", LITESTREAM_CONFIG, "-if-db-not-exists", "-if-replica-exists", db] },
    command: { cmd: LITESTREAM_BIN, args: ["replicate", "-config", LITESTREAM_CONFIG, "-exec", `node ${SERVER_ARGS.join(" ")}`] },
  };
}

let current = null;
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    stopping = true;
    current?.kill(sig);
  });
}

/** Runs a command with inherited stdio; resolves with its exit code (1 when it could not start). */
function run({ cmd, args }, env) {
  return new Promise((done) => {
    const child = spawn(cmd === "node" ? process.execPath : cmd, args, { stdio: "inherit", env });
    current = child;
    child.on("error", (err) => {
      console.error(`[start] could not run ${cmd}: ${err.code ?? "error"}`);
      done(1);
    });
    child.on("close", (code) => done(code ?? 1));
  });
}

async function main() {
  // Relative paths (DATABASE_PATH, litestream.yml, dist/) are relative to apps/api, as under `npm start -w`.
  process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  const plan = startPlan(process.env, existsSync(LITESTREAM_BIN));
  if (plan.action === "refuse") {
    console.error(`[start] refusing to start: ${plan.message}`);
    return 1;
  }
  console.log(`[start] ${plan.log}`);
  const env = { ...process.env, FORM_BACKUP: plan.backup };
  if (plan.restore) {
    const code = await run(plan.restore, env);
    if (code !== 0) {
      console.error(`[start] restoring the database from the backup failed (exit ${code}); not starting with an empty database`);
      return code;
    }
    if (stopping) return 0;
  }
  return run(plan.command, env);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code));
}
