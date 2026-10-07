import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AppContext } from "../src/app";
import { auditDatabase, auditUser, repairUser } from "../src/modules/integrity/service";
import { foodLog, makeApp, onboard, registerUser, TestClock, workoutPayload } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

const DAY1 = "2026-09-27";
const DAY2 = "2026-09-28";

/** A user with a workout and a settled food day (the next day's request settles it). */
async function activeUser() {
  const clock = new TestClock(new Date(`${DAY1}T12:00:00Z`));
  ({ app, ctx } = await makeApp({ clock }));
  const u = await registerUser(app);
  await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone: "UTC" } });
  await onboard(app, u.auth, DAY1);
  await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload({ localDate: DAY1 }) });
  await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: DAY1, kcal: 2400, proteinG: 150, carbsG: 250, fatG: 80 }) });
  clock.set(`${DAY2}T12:00:00Z`);
  await app.inject({ method: "GET", url: "/progress", headers: u.auth }); // settles DAY1
  await app.inject({ method: "GET", url: "/quests", headers: u.auth });
  await app.inject({ method: "GET", url: "/achievements", headers: u.auth });
  return { ...u, clock };
}

const audit = (id: string) => auditUser(ctx.db, id, DAY2, new Date(`${DAY2}T12:00:00Z`));
const checks = (id: string) => audit(id).filter((f) => f.severity !== "info").map((f) => f.check);
const ledger = (id: string) => ctx.db.prepare("SELECT id, source, source_key, kind, xp, idempotency_key FROM xp_events WHERE user_id = ? ORDER BY id").all(id);

describe("reconciliation audit", () => {
  it("finds nothing wrong after real use", async () => {
    const u = await activeUser();
    expect(checks(u.id)).toEqual([]);
    expect(auditDatabase(ctx.db)).toEqual([]);
  });

  it("repairs a settled food day whose XP no longer matches its logs — by appending, never editing", async () => {
    const u = await activeUser();
    // A code path that edits a log without re-settling the day (the bug this audit exists to catch).
    ctx.db.prepare("UPDATE food_logs SET kcal = 300 WHERE user_id = ?").run(u.id);
    const found = audit(u.id).find((f) => f.check === "nutrition_day_xp_mismatch");
    expect(found).toMatchObject({ subject: DAY1, severity: "error", repair: "resettle_nutrition_day" });

    const before = ledger(u.id);
    const { repaired, remaining } = repairUser(ctx.db, u.id, DAY2, new Date(`${DAY2}T12:00:00Z`));
    expect(repaired.map((f) => f.check)).toContain("nutrition_day_xp_mismatch");
    expect(remaining.filter((f) => f.severity !== "info")).toEqual([]);
    const after = ledger(u.id);
    expect(after.slice(0, before.length)).toEqual(before); // history untouched
    expect(after.slice(before.length)).toEqual([expect.objectContaining({ source: "nutrition_day", source_key: DAY1, kind: "adjustment" })]);
  });

  it("adds a missing achievement reward and a missing quest reward exactly once", async () => {
    const u = await activeUser();
    ctx.db.prepare("INSERT INTO user_achievements (user_id, achievement_id, unlocked_at, xp_reward) VALUES (?, 'first_meal_logged', ?, 25)").run(u.id, `${DAY1}T12:00:00Z`);
    ctx.db.prepare("INSERT INTO user_quests (user_id, quest_id, period_key, progress, target, status, completed_at, created_at) VALUES (?, 'daily_water', '2026-09-20', 1, 1, 'completed', ?, ?)").run(u.id, "2026-09-20T12:00:00Z", "2026-09-20T12:00:00Z");
    expect(checks(u.id).sort()).toEqual(["achievement_award_missing", "quest_xp_mismatch"]);
    repairUser(ctx.db, u.id, DAY2, new Date(`${DAY2}T12:00:00Z`));
    repairUser(ctx.db, u.id, DAY2, new Date(`${DAY2}T12:00:00Z`)); // a second run changes nothing
    expect(checks(u.id)).toEqual([]);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n, SUM(xp) AS xp FROM xp_events WHERE user_id = ? AND source = 'achievement' AND source_key = 'first_meal_logged'").get(u.id)).toEqual({ n: 1, xp: 25 });
    expect(ctx.db.prepare("SELECT SUM(xp) AS xp FROM xp_events WHERE user_id = ? AND source = 'quest' AND source_key = 'daily_water:2026-09-20'").get(u.id)).toEqual({ xp: 10 });
  });

  it("recomputes a profile weight that drifted from the weight history", async () => {
    const u = await activeUser();
    ctx.db.prepare("UPDATE profiles SET weight_kg = 95 WHERE user_id = ?").run(u.id);
    expect(checks(u.id)).toEqual(["profile_weight_not_latest"]);
    repairUser(ctx.db, u.id, DAY2, new Date(`${DAY2}T12:00:00Z`));
    expect(checks(u.id)).toEqual([]);
    expect((ctx.db.prepare("SELECT weight_kg AS w FROM profiles WHERE user_id = ?").get(u.id) as { w: number }).w).toBe(80);
  });

  it("only reports what it can't safely fix: double-counted food, a record that doesn't improve, a lost workout", async () => {
    const u = await activeUser();
    const log = ctx.db.prepare("SELECT * FROM food_logs WHERE user_id = ?").get(u.id) as Record<string, unknown>;
    // A replacement whose superseded estimate is still there (both would count).
    ctx.db
      .prepare("INSERT INTO food_logs (id, user_id, client_log_id, local_date, meal_type, logged_at, name, source, amount_method, kcal, protein_g, carbs_g, fat_g, replaced_log_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'lunch', ?, 'Weighed', 'manual', 'estimated', 100, 1, 1, 1, ?, ?, ?)")
      .run(randomUUID(), u.id, randomUUID(), DAY1, `${DAY1}T13:00:00Z`, log.id as string, `${DAY1}T13:00:00Z`, `${DAY1}T13:00:00Z`);
    // A "record" that is lower than the best before it.
    const best = ctx.db.prepare("SELECT exercise_id AS e, kind, value FROM personal_records WHERE user_id = ? AND status = 'awarded' AND kind = 'max_load' LIMIT 1").get(u.id) as { e: string; kind: string; value: number };
    ctx.db.prepare("INSERT INTO personal_records (user_id, exercise_id, kind, value, previous, status, workout_id, local_date, created_at) VALUES (?, ?, ?, ?, ?, 'awarded', ?, ?, ?)").run(u.id, best.e, best.kind, best.value - 10, best.value, (ctx.db.prepare("SELECT id FROM workouts WHERE user_id = ?").get(u.id) as { id: string }).id, DAY2, `${DAY2}T12:00:00Z`);
    // A session that says it completed, with no workout.
    ctx.db.prepare("INSERT INTO workout_sessions (id, user_id, client_session_id, local_date, status, exercises, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, 'completed', '[]', ?, ?, ?)").run(randomUUID(), u.id, randomUUID(), DAY1, `${DAY1}T10:00:00Z`, `${DAY1}T11:00:00Z`, `${DAY1}T11:00:00Z`);

    const found = audit(u.id).filter((f) => f.severity === "error");
    expect(found.map((f) => [f.check, f.repair]).sort()).toEqual(
      [
        ["nutrition_day_xp_mismatch", "resettle_nutrition_day"], // the extra 100 kcal changed the settled day
        ["record_does_not_improve", null],
        ["replaced_estimate_still_counted", null],
        ["session_completed_without_workout", null],
      ].sort(),
    );
    const { remaining } = repairUser(ctx.db, u.id, DAY2, new Date(`${DAY2}T12:00:00Z`));
    expect(remaining.filter((f) => f.severity === "error").map((f) => f.check).sort()).toEqual(["record_does_not_improve", "replaced_estimate_still_counted", "session_completed_without_workout"]);
  });

  it("flags a workout with no XP award and a session left open, and checks every foreign key", async () => {
    const u = await activeUser();
    ctx.db.prepare("INSERT INTO workouts (id, user_id, client_workout_id, local_date, duration_minutes, pain_level, xp_flags, created_at) VALUES (?, ?, ?, ?, 30, 'none', '[]', ?)").run(randomUUID(), u.id, randomUUID(), DAY2, `${DAY2}T09:00:00Z`);
    ctx.db.prepare("INSERT INTO workout_sessions (id, user_id, client_session_id, local_date, status, exercises, started_at, updated_at) VALUES (?, ?, ?, ?, 'active', '[]', ?, ?)").run(randomUUID(), u.id, randomUUID(), DAY1, `${DAY1}T10:00:00Z`, `${DAY1}T10:05:00Z`);
    const found = audit(u.id);
    expect(found.find((f) => f.check === "workout_award_missing")?.severity).toBe("error");
    expect(found.find((f) => f.check === "session_left_open")?.severity).toBe("info");

    ctx.db.exec("PRAGMA foreign_keys = OFF");
    ctx.db.prepare("INSERT INTO workout_sets (workout_id, set_index, exercise_id, reps, verified_reps, verification_status, load_kg) VALUES ('no-such-workout', 0, 'push_up', 5, 0, 'not_tracked', 0)").run();
    ctx.db.exec("PRAGMA foreign_keys = ON");
    expect(auditDatabase(ctx.db)).toEqual([expect.objectContaining({ check: "foreign_key_violation", subject: "workout_sets→workouts", detail: { rows: 1 } })]);
  });
});
