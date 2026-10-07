import { ACHIEVEMENTS, addDays, nutrientsFor, PR_METRICS, QUESTS, sessionIdleMs, type PrKind } from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import { awardAchievementXp, evaluateNutritionDay, settleCompletedNutritionDays, settleNutritionDay, settleQuestXp } from "../progression/service";
import { syncWeightFromHistory } from "../users/service";
import { latestWeight } from "../users/repo";

/**
 * Reconciliation — detects derived state that disagrees with the records it is derived from.
 *
 * Source records (workouts and their sets, food logs, weight entries, quest progress, achievement
 * unlocks, personal records, the XP ledger) are history and are never rewritten here. A finding is
 * either reported for a person to look at, or — only where the fix is itself append-only or a pure
 * recomputation of a cache — repaired the same way the engines would have done it:
 *
 * - a settled nutrition day whose XP no longer matches its logs → a compensating ledger entry;
 * - a finished day with food but no settlement → settle it (what the next request would do anyway);
 * - a quest period whose ledger total disagrees with its recorded status → a compensating entry;
 * - an unlocked achievement with no reward entry → the missing (idempotent) award entry;
 * - a profile weight that isn't the newest weight entry → recompute it from the weight history.
 *
 * Everything else (a workout with no award, a broken record chain, a superseded estimate still
 * present, food math that doesn't add up, a completed session with no workout) is reported only:
 * deciding the right value would mean guessing at history.
 */

export type RepairKind = "resettle_nutrition_day" | "settle_pending_days" | "resettle_quest" | "award_achievement" | "sync_profile_weight";

export interface Finding {
  check: string;
  /** error: inconsistent. warning: suspicious. info: expected for now (e.g. waiting for the next visit). */
  severity: "error" | "warning" | "info";
  /** What it's about: a date, a workout id, a quest period… never personal content. */
  subject: string;
  detail: Record<string, unknown>;
  repair: RepairKind | null;
}

const sum = (db: Db, sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;

function ledgerTotal(db: Db, userId: string, source: string, reference: string): { total: number; entries: number } {
  return db.prepare("SELECT COALESCE(SUM(xp), 0) AS total, COUNT(*) AS entries FROM xp_events WHERE user_id = ? AND source = ? AND source_key = ?").get(userId, source, reference) as {
    total: number;
    entries: number;
  };
}

function checkWorkouts(db: Db, userId: string, out: Finding[]): void {
  const missing = db
    .prepare(
      `SELECT w.id, w.local_date AS localDate FROM workouts w WHERE w.user_id = ?
         AND NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = w.user_id AND e.source = 'workout' AND e.source_key = w.id)`,
    )
    .all(userId) as { id: string; localDate: string }[];
  for (const w of missing) out.push({ check: "workout_award_missing", severity: "error", subject: w.id, detail: { localDate: w.localDate }, repair: null });

  // Workouts from before the event outbox were carried into the ledger by migration v13 (their award
  // has no domain event); only a workout recorded since then must have its workout.completed event.
  const noEvent = db
    .prepare(
      `SELECT w.id FROM workouts w WHERE w.user_id = ?
         AND NOT EXISTS (SELECT 1 FROM domain_events d WHERE d.user_id = w.user_id AND d.type = 'workout.completed' AND d.key = w.id)
         AND NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = w.user_id AND e.source = 'workout' AND e.source_key = w.id AND e.kind = 'award' AND e.domain_event_id IS NULL)`,
    )
    .all(userId) as { id: string }[];
  for (const w of noEvent) out.push({ check: "workout_event_missing", severity: "warning", subject: w.id, detail: {}, repair: null });

  const orphanXp = db
    .prepare(
      `SELECT DISTINCT e.source_key AS ref FROM xp_events e WHERE e.user_id = ? AND e.source = 'workout'
         AND NOT EXISTS (SELECT 1 FROM workouts w WHERE w.id = e.source_key AND w.user_id = e.user_id)`,
    )
    .all(userId) as { ref: string }[];
  for (const r of orphanXp) out.push({ check: "xp_for_missing_workout", severity: "error", subject: r.ref, detail: {}, repair: null });

  const doubled = db
    .prepare("SELECT source_key AS ref, COUNT(*) AS n FROM xp_events WHERE user_id = ? AND source = 'workout' AND kind = 'award' GROUP BY source_key HAVING COUNT(*) > 1")
    .all(userId) as { ref: string; n: number }[];
  for (const r of doubled) out.push({ check: "workout_awarded_twice", severity: "error", subject: r.ref, detail: { awards: r.n }, repair: null });
}

function checkNutritionDays(db: Db, userId: string, today: string, out: Finding[]): void {
  const settled = db.prepare("SELECT DISTINCT source_key AS d FROM xp_events WHERE user_id = ? AND source = 'nutrition_day' ORDER BY source_key").all(userId) as { d: string }[];
  for (const { d } of settled) {
    const expected = Math.trunc(evaluateNutritionDay(db, userId, d, true).xp);
    const { total } = ledgerTotal(db, userId, "nutrition_day", d);
    if (total !== expected) out.push({ check: "nutrition_day_xp_mismatch", severity: "error", subject: d, detail: { ledger: total, expected }, repair: "resettle_nutrition_day" });
  }
  // Finished days with food but never settled. Normal for a moment (the next request settles them);
  // a backlog means settlement isn't running.
  const pending = db
    .prepare(
      `SELECT COUNT(DISTINCT local_date) AS n FROM food_logs f WHERE f.user_id = ? AND f.local_date < ?
         AND NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = f.user_id AND e.source = 'nutrition_day' AND e.source_key = f.local_date)`,
    )
    .get(userId, addDays(today, -1)) as { n: number };
  if (pending.n > 0) out.push({ check: "nutrition_days_unsettled", severity: "info", subject: `before ${addDays(today, -1)}`, detail: { days: pending.n }, repair: "settle_pending_days" });
}

function checkQuests(db: Db, userId: string, out: Finding[]): void {
  const rows = db.prepare("SELECT quest_id AS questId, period_key AS periodKey, status FROM user_quests WHERE user_id = ?").all(userId) as { questId: string; periodKey: string; status: string }[];
  for (const r of rows) {
    const def = QUESTS.find((q) => q.id === r.questId);
    if (!def) continue;
    const { total, entries } = ledgerTotal(db, userId, "quest", `${r.questId}:${r.periodKey}`);
    const expected = r.status === "completed" ? def.xpReward : 0;
    if (total !== expected && !(entries === 0 && expected === 0)) {
      out.push({ check: "quest_xp_mismatch", severity: "error", subject: `${r.questId}:${r.periodKey}`, detail: { status: r.status, ledger: total, expected }, repair: "resettle_quest" });
    }
  }
}

function checkAchievements(db: Db, userId: string, out: Finding[]): void {
  const rows = db.prepare("SELECT achievement_id AS id, xp_reward AS reward FROM user_achievements WHERE user_id = ?").all(userId) as { id: string; reward: number }[];
  for (const a of rows) {
    const { total, entries } = ledgerTotal(db, userId, "achievement", a.id);
    if (a.reward > 0 && entries === 0) out.push({ check: "achievement_award_missing", severity: "error", subject: a.id, detail: { reward: a.reward }, repair: "award_achievement" });
    else if (entries > 0 && total !== a.reward) out.push({ check: "achievement_xp_mismatch", severity: "error", subject: a.id, detail: { ledger: total, expected: a.reward }, repair: null });
  }
}

/** Awarded records, in order, must each beat the best before them, and say what they beat. */
function checkRecords(db: Db, userId: string, out: Finding[]): void {
  const rows = db
    .prepare("SELECT id, exercise_id AS exerciseId, kind, value, previous, workout_id AS workoutId FROM personal_records WHERE user_id = ? AND status = 'awarded' ORDER BY id")
    .all(userId) as { id: number; exerciseId: string; kind: PrKind; value: number; previous: number | null; workoutId: string | null }[];
  const best = new Map<string, number>();
  for (const r of rows) {
    const m = PR_METRICS[r.kind];
    if (!m) continue;
    const key = `${r.exerciseId}|${r.kind}`;
    const prior = best.get(key) ?? null;
    if (prior !== null && !(m.direction === "higher" ? r.value > prior : r.value < prior)) {
      out.push({ check: "record_does_not_improve", severity: "error", subject: String(r.id), detail: { exerciseId: r.exerciseId, kind: r.kind, value: r.value, best: prior }, repair: null });
    } else if ((r.previous ?? null) !== prior) {
      out.push({ check: "record_previous_mismatch", severity: "warning", subject: String(r.id), detail: { exerciseId: r.exerciseId, kind: r.kind, previous: r.previous, best: prior }, repair: null });
    }
    if (prior === null || (m.direction === "higher" ? r.value > prior : r.value < prior)) best.set(key, r.value);
    if (r.workoutId && !db.prepare("SELECT 1 FROM workouts WHERE id = ? AND user_id = ?").get(r.workoutId, userId)) {
      out.push({ check: "record_workout_missing", severity: "error", subject: String(r.id), detail: { workoutId: r.workoutId }, repair: null });
    }
  }
}

function checkFood(db: Db, userId: string, out: Finding[]): void {
  // A replaced estimate must be gone — both counting would double the meal.
  const doubled = db
    .prepare("SELECT f.id, f.replaced_log_id AS replaced FROM food_logs f JOIN food_logs old ON old.id = f.replaced_log_id WHERE f.user_id = ?")
    .all(userId) as { id: string; replaced: string }[];
  for (const r of doubled) out.push({ check: "replaced_estimate_still_counted", severity: "error", subject: r.id, detail: { replacedLogId: r.replaced }, repair: null });

  // Entries calculated by the engine from a food's per-100 values must still add up.
  const calculated = db
    .prepare(
      `SELECT id, amount, per100_kcal AS kcal100, per100_protein_g AS p100, per100_carbs_g AS c100, per100_fat_g AS f100, kcal, protein_g AS p, carbs_g AS c, fat_g AS f
       FROM food_logs WHERE user_id = ? AND calc_version IS NOT NULL AND source IN ('verified_database', 'user_food') AND amount IS NOT NULL AND per100_kcal IS NOT NULL`,
    )
    .all(userId) as { id: string; amount: number; kcal100: number; p100: number; c100: number; f100: number; kcal: number; p: number; c: number; f: number }[];
  for (const r of calculated) {
    const want = nutrientsFor({ kcal: r.kcal100, proteinG: r.p100, carbsG: r.c100, fatG: r.f100 }, r.amount);
    const off = Math.abs(want.kcal - r.kcal) > 0.5 || Math.abs(want.proteinG - r.p) > 0.05 || Math.abs(want.carbsG - r.c) > 0.05 || Math.abs(want.fatG - r.f) > 0.05;
    if (off) out.push({ check: "food_nutrients_mismatch", severity: "error", subject: r.id, detail: { storedKcal: r.kcal, expectedKcal: Math.round(want.kcal * 10) / 10 }, repair: null });
  }

  const eaten = db
    .prepare(
      `SELECT pm.id FROM planned_meals pm WHERE pm.user_id = ? AND pm.food_log_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM food_logs f WHERE f.id = pm.food_log_id AND f.user_id = pm.user_id)`,
    )
    .all(userId) as { id: string }[];
  for (const m of eaten) out.push({ check: "planned_meal_log_missing", severity: "warning", subject: m.id, detail: {}, repair: null });
}

function checkSessions(db: Db, userId: string, now: Date, today: string, out: Finding[]): void {
  const broken = db
    .prepare(
      `SELECT s.id FROM workout_sessions s WHERE s.user_id = ? AND s.status = 'completed'
         AND (s.workout_id IS NULL OR NOT EXISTS (SELECT 1 FROM workouts w WHERE w.id = s.workout_id AND w.user_id = s.user_id))`,
    )
    .all(userId) as { id: string }[];
  for (const s of broken) out.push({ check: "session_completed_without_workout", severity: "error", subject: s.id, detail: {}, repair: null });

  const open = db
    .prepare(
      `SELECT s.id, s.status, s.local_date AS localDate, MAX(s.updated_at, COALESCE((SELECT MAX(updated_at) FROM session_sets WHERE session_id = s.id), '')) AS last
       FROM workout_sessions s WHERE s.user_id = ? AND s.status IN ('active', 'paused')`,
    )
    .all(userId) as { id: string; status: "active" | "paused"; localDate: string; last: string }[];
  for (const s of open) {
    if (sessionIdleMs({ status: s.status, lastActivityAt: new Date(s.last), now }) > 0 || s.localDate < today) {
      out.push({ check: "session_left_open", severity: "info", subject: s.id, detail: { localDate: s.localDate, lastActivityAt: s.last }, repair: null });
    }
  }
}

function checkProfile(db: Db, userId: string, today: string, out: Finding[]): void {
  const profile = db.prepare("SELECT primary_goal AS goal, weight_kg AS weightKg FROM profiles WHERE user_id = ?").get(userId) as { goal: string | null; weightKg: number | null } | undefined;
  if (!profile) return;
  const latest = latestWeight(db, userId);
  if (latest && profile.weightKg !== null && Math.abs(latest.weightKg - profile.weightKg) > 0.001) {
    out.push({ check: "profile_weight_not_latest", severity: "error", subject: latest.localDate, detail: { profileKg: profile.weightKg, latestKg: latest.weightKg }, repair: "sync_profile_weight" });
  }
  const goal = db.prepare("SELECT primary_goal AS goal FROM goal_history WHERE user_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1").get(userId, today) as { goal: string } | undefined;
  if (profile.goal && goal && goal.goal !== profile.goal) {
    out.push({ check: "goal_history_mismatch", severity: "error", subject: today, detail: { profileGoal: profile.goal, historyGoal: goal.goal }, repair: null });
  }
  const onboarded = db.prepare("SELECT onboarding_completed_at AS t FROM profiles WHERE user_id = ?").get(userId) as { t: string | null } | undefined;
  if (onboarded?.t && sum(db, "SELECT COUNT(*) AS n FROM nutrition_targets WHERE user_id = ? AND effective_from <= ?", userId, today) === 0) {
    out.push({ check: "targets_missing", severity: "warning", subject: today, detail: {}, repair: null });
  }
}

/** Every check for one user, as of their `today`. Read-only. */
export function auditUser(db: Db, userId: string, today: string, now: Date): Finding[] {
  const out: Finding[] = [];
  checkWorkouts(db, userId, out);
  checkNutritionDays(db, userId, today, out);
  checkQuests(db, userId, out);
  checkAchievements(db, userId, out);
  checkRecords(db, userId, out);
  checkFood(db, userId, out);
  checkSessions(db, userId, now, today, out);
  checkProfile(db, userId, today, out);
  return out;
}

/**
 * Applies the safe repairs among `findings` (see the module comment), in one transaction, then
 * audits again. Returns what was repaired and what is left for a person to look at.
 */
export function repairUser(db: Db, userId: string, today: string, now: Date, findings = auditUser(db, userId, today, now)): { repaired: Finding[]; remaining: Finding[] } {
  const repaired: Finding[] = [];
  transaction(db, () => {
    for (const f of findings) {
      switch (f.repair) {
        case "resettle_nutrition_day":
          settleNutritionDay(db, userId, f.subject, now);
          break;
        case "settle_pending_days":
          settleCompletedNutritionDays(db, userId, today, now);
          break;
        case "resettle_quest": {
          const [questId, periodKey] = [f.subject.slice(0, f.subject.indexOf(":")), f.subject.slice(f.subject.indexOf(":") + 1)];
          const def = QUESTS.find((q) => q.id === questId)!;
          settleQuestXp(db, { userId, questId, periodKey, xpReward: def.xpReward, completed: f.detail.status === "completed", localDate: today, now });
          break;
        }
        case "award_achievement": {
          const row = db.prepare("SELECT domain_event_id AS eventId, unlocked_at AS at FROM user_achievements WHERE user_id = ? AND achievement_id = ?").get(userId, f.subject) as { eventId: number | null; at: string };
          const title = ACHIEVEMENTS.find((a) => a.id === f.subject)?.title ?? f.subject;
          awardAchievementXp(db, { userId, achievementId: f.subject, title, xp: Number(f.detail.reward), localDate: row.at.slice(0, 10), domainEventId: row.eventId as number, now });
          break;
        }
        case "sync_profile_weight":
          syncWeightFromHistory(db, userId, today, now);
          break;
        default:
          continue;
      }
      repaired.push(f);
    }
  });
  return { repaired, remaining: auditUser(db, userId, today, now) };
}

/** Database-wide structural checks: SQLite's own integrity check and every foreign key. */
export function auditDatabase(db: Db): Finding[] {
  const out: Finding[] = [];
  const quick = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
  if (quick.length !== 1 || quick[0]!.quick_check !== "ok") out.push({ check: "sqlite_quick_check", severity: "error", subject: "database", detail: { result: quick.slice(0, 5) }, repair: null });
  const fk = db.prepare("PRAGMA foreign_key_check").all() as { table: string; parent: string }[];
  const byTable = new Map<string, number>();
  for (const r of fk) byTable.set(`${r.table}→${r.parent}`, (byTable.get(`${r.table}→${r.parent}`) ?? 0) + 1);
  for (const [k, n] of byTable) out.push({ check: "foreign_key_violation", severity: "error", subject: k, detail: { rows: n }, repair: null });
  return out;
}
