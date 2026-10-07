// Boots the built API bundle (apps/api/dist/server.js) with production settings against a
// throwaway database, runs a short real journey over HTTP, checks the logs, runs the built
// reconciliation CLI against the same database, and shuts it down. Exit code 0 = healthy.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 4100 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), "form-smoke-"));
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  JWT_SECRET: randomBytes(48).toString("base64url"),
  CORS_ORIGINS: "https://app.example",
  DATABASE_PATH: join(dir, "smoke.db"),
  PORT: String(port),
};

const server = spawn(process.execPath, ["apps/api/dist/server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
server.stdout.on("data", (d) => (stdout += d));
server.stderr.on("data", (d) => (stderr += d));

const check = (cond, msg) => {
  if (!cond) throw new Error(`smoke check failed: ${msg}`);
  console.log(`  ok  ${msg}`);
};

async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become healthy\n${stderr}`);
}

const json = (method, path, token, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

try {
  const health = await waitForHealth();
  check(health.ok === true && health.schemaVersion >= 19, `production bundle boots, migrates (v${health.schemaVersion}) and /health responds`);

  const email = `smoke-${Date.now()}@example.com`;
  const password = "smoke-test-password";
  const reg = await json("POST", "/auth/register", null, { email, password });
  check(reg.status === 201 && /^[0-9a-f-]{36}$/.test(reg.headers.get("x-request-id") ?? ""), "register returns 201 with a request id");
  const { token } = await reg.json();

  const me = await json("GET", "/me", token);
  check(me.status === 200 && me.headers.get("cache-control") === "no-store", "/me is authenticated and uncached");
  const providers = await (await json("GET", "/system/providers", token)).json();
  check(providers.providers.every((p) => p.missing === undefined), "production hides missing-secret names");
  check((await json("GET", "/me")).status === 401, "unauthenticated request is rejected");

  // A short real journey through the production build.
  const today = new Date().toISOString().slice(0, 10);
  await json("PATCH", "/me/settings", token, { timezone: "UTC" });
  await json("PATCH", "/me/profile", token, { localDate: today, primaryGoal: "improve_health", sex: "unspecified", ageYears: 30, heightCm: 175, weightKg: 75, experience: "beginner", trainingDaysPerWeek: 3, trainingLocation: "home", equipment: ["bodyweight"] });
  await json("PATCH", "/me/preferences", token, { dietaryPreferences: [], allergens: [], customAllergies: [], dislikedFoods: [], cookingTime: "15_30", foodBudget: "medium" });
  check((await json("POST", "/onboarding/complete", token)).status === 200, "onboarding completes");
  const workout = await json("POST", "/workouts", token, { clientWorkoutId: randomUUID(), localDate: today, durationMinutes: 25, painLevel: "none", sets: [{ exerciseId: "push_up", reps: 12 }] });
  check(workout.status === 201, "a workout is logged and rewarded");
  const meal = await json("POST", "/nutrition/logs", token, { clientLogId: randomUUID(), amountMethod: "measured", food: { foodId: "fdb:banana", quantity: 118, unit: "g" } });
  check(meal.status === 201, "a weighed food is logged");
  const home = await (await json("GET", "/home", token)).json();
  check(home.date === today && home.errors.length === 0, "Home builds every section");
  const exported = await json("POST", "/me/export", token, { password });
  check(exported.status === 200 && !(await exported.text()).includes("password_hash"), "export works and withholds the password hash");

  // The built reconciliation CLI against the live database (WAL: safe alongside the server).
  const audit = spawnSync(process.execPath, ["apps/api/dist/reconcile.js"], { env, encoding: "utf8" });
  const report = JSON.parse(audit.stdout);
  check(audit.status === 0 && report.usersChecked === 1 && report.errors === 0 && report.warnings === 0, "reconciliation finds the journey consistent");

  // The built backup CLI: a verified snapshot of the live database.
  const backup = spawnSync(process.execPath, ["apps/api/dist/backup.js", "--dir", join(dir, "backups")], { env, encoding: "utf8" });
  const backupReport = JSON.parse(backup.stdout);
  check(backup.status === 0 && backupReport.ok && backupReport.integrity === "ok" && backupReport.users === 1, "a verified backup is written while the server runs");

  // First-party crash reporting accepts a report from the app.
  const crash = await json("POST", "/client-errors", null, { name: "Error", message: "smoke crash", platform: "web", appVersion: "smoke" });
  check(crash.status === 204, "crash reports are accepted");

  check((await json("DELETE", "/me", token, { password, confirm: "DELETE" })).status === 204, "the account deletes");

  // Logs: structured JSON lines, with request ids — and none of the user's secrets.
  const lines = stdout.trim().split("\n").filter(Boolean);
  check(lines.length > 0 && lines.every((l) => l.startsWith("{")), "logs are structured JSON lines");
  check(lines.some((l) => l.includes('"domainEvent":"workout.completed"')), "domain events are visible in the logs");
  check(lines.some((l) => l.includes('"msg":"client error"')), "crash reports reach the logs");
  check(![password, token, email].some((s) => stdout.includes(s) || stderr.includes(s)), "logs contain no password, token or email");

  console.log("API smoke test passed");
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  server.kill();
  await new Promise((r) => server.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
}
