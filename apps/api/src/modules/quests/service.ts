import {
  addDays,
  daysBetween,
  evaluateQuest,
  featureAvailability,
  providerStatuses,
  questsFor,
  waterTargetMl,
  XP_RULES,
  type QuestMetrics,
  type QuestProgress,
} from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { hasAnyTarget, targetOn } from "../nutrition/targets";
import { settleQuestXp } from "../progression/service";
import { loadProfile } from "../users/repo";

const PROTEIN_HIT_FRACTION = 0.9;

function dailyTotals(db: Db, userId: string, from: string, to: string) {
  const food = db
    .prepare(
      `SELECT local_date AS d, COUNT(*) AS n, COALESCE(SUM(protein_g), 0) AS protein FROM food_logs
       WHERE user_id = ? AND local_date BETWEEN ? AND ? GROUP BY local_date`,
    )
    .all(userId, from, to) as { d: string; n: number; protein: number }[];
  const water = db
    .prepare(`SELECT local_date AS d, SUM(ml) AS ml FROM water_logs WHERE user_id = ? AND local_date BETWEEN ? AND ? GROUP BY local_date`)
    .all(userId, from, to) as { d: string; ml: number }[];
  return { food, water };
}

/** Real activity metrics for [from, to] (inclusive local dates). */
export function questMetrics(db: Db, userId: string, from: string, to: string): QuestMetrics {
  const { food, water } = dailyTotals(db, userId, from, to);
  const profile = loadProfile(db, userId);
  const waterTarget = waterTargetMl(profile?.weightKg ?? null).targetMl;

  const workouts = db
    .prepare(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT local_date) AS days FROM workouts WHERE user_id = ? AND local_date BETWEEN ? AND ?`,
    )
    .get(userId, from, to) as { n: number; days: number };
  const verified = db
    .prepare(
      `SELECT COALESCE(SUM(s.verified_reps), 0) AS reps FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ?`,
    )
    .get(userId, from, to) as { reps: number };
  // Form Master: verified reps the server scored 85+ (no reps from a serious-pain session count).
  const goodForm = db
    .prepare(
      `SELECT COUNT(*) AS n FROM verified_reps r JOIN workout_sets s ON s.id = r.set_id JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ? AND w.pain_level <> 'serious' AND r.form_score >= ?`,
    )
    .get(userId, from, to, XP_RULES.goodFormScore) as { n: number };
  const prs = db
    .prepare(
      // A personal best beats an earlier record; a first-ever lift sets a baseline, not a record.
      `SELECT COUNT(*) AS n FROM personal_records p JOIN workouts w ON w.id = p.workout_id
       WHERE p.user_id = ? AND p.status = 'awarded' AND w.local_date BETWEEN ? AND ?
         AND EXISTS (SELECT 1 FROM personal_records q
                     WHERE q.user_id = p.user_id AND q.exercise_id = p.exercise_id AND q.kind = p.kind AND q.status = 'awarded' AND q.id < p.id)`,
    )
    .get(userId, from, to) as { n: number };

  let proteinDays = 0;
  for (const day of food) {
    const target = targetOn(db, userId, day.d);
    if (target && day.protein >= target.proteinG * PROTEIN_HIT_FRACTION) proteinDays++;
  }

  return {
    meals_logged: food.reduce((a, d) => a + d.n, 0),
    food_log_days: food.length,
    protein_target_days: proteinDays,
    water_target_days: water.filter((d) => d.ml >= waterTarget).length,
    active_days: workouts.days,
    workouts_completed: workouts.n,
    verified_reps: verified.reps,
    good_form_reps: goodForm.n,
    prs_awarded: prs.n,
  };
}

function usedCameraRecently(db: Db, userId: string, today: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.local_date >= ? AND s.verified_reps > 0 LIMIT 1`,
    )
    .get(userId, addDays(today, -28));
  return row !== undefined;
}

/**
 * Evaluates the user's current quests and records completions. Idempotent: a quest awards
 * its XP through one ledger event keyed `questId:periodKey`, so repeated or concurrent
 * evaluation can never award twice. While a period is open the award follows the real
 * progress — deleting the logs that completed a quest withdraws its XP.
 */
export function syncQuests(ctx: AppContext, userId: string, clock: UserClock): { daily: QuestProgress[]; weekly: QuestProgress[] } {
  const { db } = ctx;
  const profile = loadProfile(db, userId);
  const features = featureAvailability(providerStatuses(ctx.providers));
  const active = questsFor({
    today: clock.today,
    weekStart: clock.weekStart,
    trainingDaysPerWeek: profile?.trainingDaysPerWeek ?? null,
    hasNutritionTargets: hasAnyTarget(db, userId),
    // Only offer camera quests to people whose device has actually verified reps recently.
    cameraVerificationAvailable: features.camera_verification.available && usedCameraRecently(db, userId, clock.today),
  });

  const daily = questMetrics(db, userId, clock.today, clock.today);
  const weekly = questMetrics(db, userId, clock.weekStart, clock.today);
  const results = active.map((q) => evaluateQuest(q, q.cadence === "daily" ? daily : weekly));
  const now = ctx.now();

  transaction(db, () => {
    const existing = db.prepare("SELECT quest_id, period_key, status, completed_at FROM user_quests WHERE user_id = ? AND period_key IN (?, ?)").all(
      userId,
      clock.today,
      clock.weekStart,
    ) as { quest_id: string; period_key: string; status: string; completed_at: string | null }[];
    const upsert = db.prepare(
      `INSERT INTO user_quests (user_id, quest_id, period_key, progress, target, status, completed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, quest_id, period_key) DO UPDATE SET progress = excluded.progress, target = excluded.target,
         status = excluded.status, completed_at = excluded.completed_at`,
    );
    for (const r of results) {
      const prev = existing.find((e) => e.quest_id === r.id && e.period_key === r.periodKey);
      const completedAt = r.completed ? (prev?.completed_at ?? now.toISOString()) : null;
      upsert.run(userId, r.id, r.periodKey, r.progress, r.target, r.completed ? "completed" : "active", completedAt, now.toISOString());

      // Completion is decided here, from real data — never by the client. A period that's still open
      // follows real progress: if it drops below the target, a compensating entry withdraws the XP.
      settleQuestXp(db, { userId, questId: r.id, periodKey: r.periodKey, xpReward: r.xpReward, completed: r.completed, localDate: clock.today, now });
    }
  });

  return { daily: results.filter((r) => r.cadence === "daily"), weekly: results.filter((r) => r.cadence === "weekly") };
}

/** The most recent local date with any logged activity (workout, food or water), up to today. */
export function lastActivityDate(db: Db, userId: string, today: string): string | null {
  const row = db
    .prepare(
      `SELECT MAX(d) AS d FROM (
         SELECT MAX(local_date) AS d FROM workouts WHERE user_id = ? AND local_date <= ?
         UNION ALL SELECT MAX(local_date) FROM food_logs WHERE user_id = ? AND local_date <= ?
         UNION ALL SELECT MAX(local_date) FROM water_logs WHERE user_id = ? AND local_date <= ?)`,
    )
    .get(userId, today, userId, today, userId, today) as { d: string | null };
  return row.d;
}

export function daysSince(date: string | null, today: string): number | null {
  return date === null ? null : daysBetween(date, today);
}
