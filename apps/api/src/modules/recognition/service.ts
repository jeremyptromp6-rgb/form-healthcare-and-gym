import {
  ACHIEVEMENTS,
  addDays,
  BODY_QUEST_STAGES,
  consecutiveDayStreak,
  evaluateAchievements,
  evaluateBodyQuest,
  plannedRestDays,
  QUESTS,
  reachedMilestones,
  stageIndex,
  weeklyStreak,
  weeksMeetingPlan,
  weekStart,
  workoutStreak,
  XP_RULES,
  type AchievementMetrics,
  type AchievementStatus,
  type BodyQuestInput,
  type BodyQuestResult,
  type BodyQuestStage,
  type StreakState,
  type StreakType,
  type WeeklyStreakState,
} from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { hasAnyTarget, targetOn } from "../nutrition/targets";
import { awardAchievementXp, emitDomainEvent, settleProgression } from "../progression/service";
import { syncQuests } from "../quests/service";

/**
 * Recognition: streaks, achievements, Body Quest and celebrations — all derived from the server's
 * authoritative records, all idempotent. Anything that earns XP does so through the progression
 * ledger; anything worth celebrating is a domain event (once per occurrence), which the
 * celebration feed reads until the user has seen it.
 */

// ---- Shared history ----------------------------------------------------------------------------

interface TrainingHistory {
  workouts: { localDate: string; painLevel: string }[];
  trainingDaysPerWeek: number | null;
}

function trainingHistory(db: Db, userId: string): TrainingHistory {
  const workouts = db.prepare("SELECT local_date AS localDate, pain_level AS painLevel FROM workouts WHERE user_id = ? ORDER BY local_date").all(userId) as TrainingHistory["workouts"];
  const plan = db.prepare("SELECT training_days_per_week AS n FROM profiles WHERE user_id = ?").get(userId) as { n: number | null } | undefined;
  return { workouts, trainingDaysPerWeek: plan?.n ?? null };
}

/** Finished days whose settled nutrition XP says on target (never a day under the safe minimum). */
function onTrackNutritionDays(db: Db, userId: string): string[] {
  const rows = db.prepare("SELECT source_key AS d, detail FROM xp_events WHERE user_id = ? AND source = 'nutrition_day' ORDER BY id").all(userId) as { d: string; detail: string }[];
  const latest = new Map<string, string[]>();
  for (const r of rows) latest.set(r.d, (JSON.parse(r.detail).flags ?? []) as string[]);
  return [...latest.entries()].filter(([, flags]) => flags.includes("on_target")).map(([d]) => d);
}

const DAILY_QUESTS = QUESTS.filter((q) => q.cadence === "daily").map((q) => q.id);

/** Days with at least one daily quest completed (as recorded by the quest engine). */
function dailyQuestDays(db: Db, userId: string): string[] {
  if (DAILY_QUESTS.length === 0) return [];
  const rows = db
    .prepare(`SELECT DISTINCT period_key AS d FROM user_quests WHERE user_id = ? AND status = 'completed' AND quest_id IN (${DAILY_QUESTS.map(() => "?").join(", ")})`)
    .all(userId, ...DAILY_QUESTS) as { d: string }[];
  return rows.map((r) => r.d);
}

// ---- Streaks -----------------------------------------------------------------------------------

export interface Streaks {
  workout: StreakState & { plannedRestDays: number };
  nutrition: StreakState & { available: boolean };
  quest: StreakState;
  weekly: WeeklyStreakState & { target: number };
}

export function computeStreaks(db: Db, userId: string, today: string): Streaks {
  const h = trainingHistory(db, userId);
  return {
    workout: { ...workoutStreak(h, today), plannedRestDays: plannedRestDays(h.trainingDaysPerWeek) },
    nutrition: { ...consecutiveDayStreak(onTrackNutritionDays(db, userId), today), available: hasAnyTarget(db, userId) },
    quest: consecutiveDayStreak(dailyQuestDays(db, userId), today),
    weekly: { ...weeklyStreak(weeksMeetingPlan(h), today), target: Math.min(6, Math.max(1, h.trainingDaysPerWeek ?? 3)) },
  };
}

/** One celebration per milestone per streak run (keyed by the run's first day). */
function emitStreakMilestones(db: Db, userId: string, s: Streaks, now: Date): void {
  const runs: [StreakType, number, string | null][] = [
    ["workout", s.workout.current, s.workout.startDate],
    ["nutrition", s.nutrition.current, s.nutrition.startDate],
    ["quest", s.quest.current, s.quest.startDate],
    ["weekly", s.weekly.current, s.weekly.startWeek],
  ];
  for (const [type, current, start] of runs) {
    if (!start) continue;
    for (const m of reachedMilestones(type, current)) emitDomainEvent(db, userId, "streak.milestone", `${type}:${start}:${m}`, { streak: type, length: m, startDate: start }, now);
  }
}

// ---- Achievements ------------------------------------------------------------------------------

/** Lifetime metrics from authoritative records. Sessions with serious pain never count. */
export function achievementMetrics(db: Db, userId: string, today: string): AchievementMetrics {
  const w = db
    .prepare(
      `SELECT COUNT(DISTINCT w.id) AS workouts, COALESCE(SUM(s.verified_reps), 0) AS reps
       FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id WHERE w.user_id = ? AND w.pain_level <> 'serious'`,
    )
    .get(userId) as { workouts: number; reps: number };
  const goodForm = db
    .prepare(
      `SELECT COUNT(*) AS n FROM verified_reps r JOIN workout_sets s ON s.id = r.set_id JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.pain_level <> 'serious' AND r.form_score >= ?`,
    )
    .get(userId, XP_RULES.goodFormScore) as { n: number };
  // A beaten record (the first value for a metric is a baseline). Consistency records don't count.
  const beaten = db
    .prepare(
      `SELECT COUNT(*) AS n FROM personal_records p WHERE p.user_id = ? AND p.status = 'awarded' AND p.kind <> 'longest_streak'
         AND EXISTS (SELECT 1 FROM personal_records q WHERE q.user_id = p.user_id AND q.exercise_id = p.exercise_id AND q.kind = p.kind AND q.status = 'awarded' AND q.id < p.id)`,
    )
    .get(userId) as { n: number };
  return {
    total_verified_reps: w.reps,
    workouts_completed: w.workouts,
    good_form_reps: goodForm.n,
    weekly_consistency_streak: weeklyStreak(weeksMeetingPlan(trainingHistory(db, userId)), today).longest,
    prs_beaten: beaten.n,
    nutrition_on_track_days: onTrackNutritionDays(db, userId).length,
  };
}

function unlockedAchievements(db: Db, userId: string): Map<string, string> {
  const rows = db.prepare("SELECT achievement_id AS id, unlocked_at AS at FROM user_achievements WHERE user_id = ?").all(userId) as { id: string; at: string }[];
  return new Map(rows.map((r) => [r.id, r.at]));
}

/**
 * Evaluates achievements and records any new unlocks: one immutable row (INSERT OR IGNORE on the
 * primary key), one `achievement.unlocked` event, one ledger award — each keyed by the achievement,
 * so concurrent or repeated evaluation unlocks and rewards exactly once.
 */
export function syncAchievements(db: Db, userId: string, today: string, now: Date): AchievementStatus[] {
  const metrics = achievementMetrics(db, userId, today);
  const { newlyUnlocked } = evaluateAchievements(ACHIEVEMENTS, metrics, unlockedAchievements(db, userId));
  for (const a of newlyUnlocked) {
    const eventId = emitDomainEvent(db, userId, "achievement.unlocked", a.id, { achievementId: a.id, title: a.title, description: a.description, xpReward: a.xpReward, metric: a.metric, value: metrics[a.metric] }, now);
    const inserted = db
      .prepare("INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at, xp_reward, metric_value, domain_event_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, a.id, now.toISOString(), a.xpReward, metrics[a.metric], eventId);
    if (inserted.changes > 0 && a.xpReward > 0) awardAchievementXp(db, { userId, achievementId: a.id, title: a.title, xp: a.xpReward, localDate: today, domainEventId: eventId, now });
  }
  return evaluateAchievements(ACHIEVEMENTS, metrics, unlockedAchievements(db, userId)).statuses;
}

// ---- Body Quest --------------------------------------------------------------------------------

/** Weekly snapshots are kept for at most this many finished weeks back. */
const SNAPSHOT_WEEKS = 26;
const PROTEIN_HIT_FRACTION = 0.9;

function bodyQuestInput(db: Db, userId: string, today: string): BodyQuestInput {
  const from = addDays(today, -(SNAPSHOT_WEEKS * 7 + 70));
  const h = trainingHistory(db, userId);
  const sets = db
    .prepare(
      `SELECT w.id, w.local_date AS localDate, w.duration_minutes AS durationMinutes, w.pain_level AS painLevel,
              s.exercise_id AS exerciseId, s.reps, s.verified_reps AS verifiedReps, s.load_kg AS loadKg
       FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id WHERE w.user_id = ? AND w.local_date <= ? ORDER BY w.local_date, s.id`,
    )
    .all(userId, today) as { id: string; localDate: string; durationMinutes: number; painLevel: string; exerciseId: string | null; reps: number; verifiedReps: number; loadKg: number }[];
  const byWorkout = new Map<string, BodyQuestInput["workouts"][number]>();
  for (const r of sets) {
    const w = byWorkout.get(r.id) ?? { localDate: r.localDate, durationMinutes: r.durationMinutes, painLevel: r.painLevel, sets: [] };
    if (r.exerciseId) w.sets.push({ exerciseId: r.exerciseId, reps: r.reps, verifiedReps: r.verifiedReps, loadKg: r.loadKg });
    byWorkout.set(r.id, w);
  }
  const verifiedReps = db
    .prepare(
      `SELECT w.local_date AS localDate, w.pain_level AS painLevel, r.form_score AS formScore, r.rom_percent AS romPercent
       FROM verified_reps r JOIN workout_sets s ON s.id = r.set_id JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ?`,
    )
    .all(userId, from, today) as BodyQuestInput["verifiedReps"][number][];
  let proteinDays: BodyQuestInput["proteinDays"] = null;
  if (hasAnyTarget(db, userId)) {
    const days = db
      .prepare("SELECT local_date AS d, COALESCE(SUM(protein_g), 0) AS protein FROM food_logs WHERE user_id = ? AND local_date BETWEEN ? AND ? GROUP BY local_date")
      .all(userId, from, today) as { d: string; protein: number }[];
    proteinDays = days.flatMap((d) => {
      const t = targetOn(db, userId, d.d);
      return t ? [{ localDate: d.d, hit: d.protein >= t.proteinG * PROTEIN_HIT_FRACTION }] : [];
    });
  }
  return { asOf: today, trainingDaysPerWeek: h.trainingDaysPerWeek, workouts: [...byWorkout.values()], verifiedReps, proteinDays };
}

/**
 * Writes an immutable snapshot for every finished week not yet recorded (evaluated as of that
 * week's Sunday, so it is deterministic), and emits a one-time `body_quest.stage_reached` event the
 * first time each stage is reached.
 */
function settleBodyQuest(db: Db, userId: string, today: string, now: Date): { live: BodyQuestResult; input: BodyQuestInput } {
  const input = bodyQuestInput(db, userId, today);
  const live = evaluateBodyQuest(input);
  const first = input.workouts.reduce<string | null>((a, w) => (a === null || w.localDate < a ? w.localDate : a), null);
  let highest = stageIndex(live.stage);
  if (first) {
    const thisWeek = weekStart(today);
    let week = weekStart(first);
    const earliest = addDays(thisWeek, -SNAPSHOT_WEEKS * 7);
    if (week < earliest) week = earliest;
    const insert = db.prepare(
      "INSERT OR IGNORE INTO body_quest_snapshots (user_id, week_start, as_of, stage, overall, stats, engine_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const have = new Set((db.prepare("SELECT week_start AS w FROM body_quest_snapshots WHERE user_id = ?").all(userId) as { w: string }[]).map((r) => r.w));
    for (; week < thisWeek; week = addDays(week, 7)) {
      if (have.has(week)) continue;
      const asOf = addDays(week, 6);
      const r = evaluateBodyQuest({ ...input, asOf });
      insert.run(userId, week, asOf, r.stage, r.overall, JSON.stringify(r.stats), r.engineVersion, now.toISOString());
    }
    const best = db.prepare("SELECT stage FROM body_quest_snapshots WHERE user_id = ?").all(userId) as { stage: BodyQuestStage }[];
    for (const b of best) highest = Math.max(highest, stageIndex(b.stage));
  }
  for (let i = 1; i <= highest; i++) {
    const stage = BODY_QUEST_STAGES[i]!;
    emitDomainEvent(db, userId, "body_quest.stage_reached", stage, { stage, overall: live.overall }, now);
  }
  return { live, input };
}

export function bodyQuestView(db: Db, userId: string, today: string, now: Date) {
  const { live } = transaction(db, () => settleBodyQuest(db, userId, today, now));
  const snapshots = (
    db.prepare("SELECT week_start AS weekStart, as_of AS asOf, stage, overall, stats, engine_version AS engineVersion FROM body_quest_snapshots WHERE user_id = ? ORDER BY week_start").all(userId) as {
      weekStart: string;
      asOf: string;
      stage: BodyQuestStage;
      overall: number | null;
      stats: string;
      engineVersion: number;
    }[]
  ).map((s) => ({ ...s, stats: Object.fromEntries(Object.entries(JSON.parse(s.stats) as Record<string, { value: number | null }>).map(([k, v]) => [k, v.value])) }));
  const reached = (db.prepare("SELECT key FROM domain_events WHERE user_id = ? AND type = 'body_quest.stage_reached'").all(userId) as { key: BodyQuestStage }[]).map((r) => r.key);
  const highest = reached.reduce<BodyQuestStage>((a, s) => (stageIndex(s) > stageIndex(a) ? s : a), "starter");
  return { ...live, highestStage: stageIndex(highest) > stageIndex(live.stage) ? highest : live.stage, stages: BODY_QUEST_STAGES, snapshots };
}

// ---- Celebrations ------------------------------------------------------------------------------

const CELEBRATED = ["achievement.unlocked", "personal_record.set", "streak.milestone", "body_quest.stage_reached"] as const;
/** Celebrations older than this are history, not news. */
const CELEBRATION_DAYS = 7;

export interface Celebration {
  id: number;
  kind: "achievement" | "personal_record" | "streak" | "body_quest";
  at: string;
  payload: Record<string, unknown>;
}

export function pendingCelebrations(db: Db, userId: string, now: Date): Celebration[] {
  const since = new Date(now.getTime() - CELEBRATION_DAYS * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT e.id, e.type, e.payload, e.created_at AS at FROM domain_events e
       WHERE e.user_id = ? AND e.type IN (${CELEBRATED.map(() => "?").join(", ")}) AND e.created_at >= ?
         AND NOT EXISTS (SELECT 1 FROM celebration_seen c WHERE c.user_id = e.user_id AND c.event_id = e.id)
       ORDER BY e.id`,
    )
    .all(userId, ...CELEBRATED, since) as { id: number; type: string; payload: string; at: string }[];
  const kind = (t: string): Celebration["kind"] => (t === "achievement.unlocked" ? "achievement" : t === "personal_record.set" ? "personal_record" : t === "streak.milestone" ? "streak" : "body_quest");
  const all = rows.map((r) => ({ id: r.id, kind: kind(r.type), at: r.at, payload: JSON.parse(r.payload) as Record<string, unknown> }));
  // Several milestones of one run (or several stages at once) collapse to the biggest one.
  const top = new Map<string, Celebration>();
  const rest: Celebration[] = [];
  for (const c of all) {
    if (c.kind === "personal_record") {
      // One celebration per exercise per workout: the first record it set (heaviest weight before 1RM).
      const group = `pr:${c.payload.workoutId}:${c.payload.exerciseId}`;
      if (!top.has(group)) top.set(group, c);
      continue;
    }
    const group = c.kind === "streak" ? `streak:${c.payload.streak}:${c.payload.startDate}` : c.kind === "body_quest" ? "body_quest" : null;
    if (!group) rest.push(c);
    else top.set(group, c); // ordered by id, so the latest (largest) wins
  }
  return [...rest, ...top.values()].sort((a, b) => a.id - b.id);
}

/** Marks celebrations seen. Collapsed siblings (smaller milestones of the same run) are marked too. */
export function markCelebrationsSeen(db: Db, userId: string, ids: number[], now: Date): number {
  return transaction(db, () => {
    let n = 0;
    const owned = db.prepare(`SELECT id, type, payload FROM domain_events WHERE user_id = ? AND id = ?`);
    const insert = db.prepare("INSERT OR IGNORE INTO celebration_seen (user_id, event_id, seen_at) VALUES (?, ?, ?)");
    for (const id of ids) {
      const e = owned.get(userId, id) as { id: number; type: string; payload: string } | undefined;
      if (!e || !(CELEBRATED as readonly string[]).includes(e.type)) continue; // never another user's event
      const siblings =
        e.type === "streak.milestone"
          ? (db.prepare("SELECT id FROM domain_events WHERE user_id = ? AND type = 'streak.milestone' AND json_extract(payload, '$.streak') = ? AND json_extract(payload, '$.startDate') = ? AND id <= ?").all(
              userId,
              JSON.parse(e.payload).streak,
              JSON.parse(e.payload).startDate,
              e.id,
            ) as { id: number }[])
          : e.type === "body_quest.stage_reached"
            ? (db.prepare("SELECT id FROM domain_events WHERE user_id = ? AND type = 'body_quest.stage_reached' AND id <= ?").all(userId, e.id) as { id: number }[])
            : e.type === "personal_record.set"
              ? (db.prepare("SELECT id FROM domain_events WHERE user_id = ? AND type = 'personal_record.set' AND json_extract(payload, '$.workoutId') = ? AND json_extract(payload, '$.exerciseId') = ?").all(
                  userId,
                  JSON.parse(e.payload).workoutId,
                  JSON.parse(e.payload).exerciseId,
                ) as { id: number }[])
              : [{ id: e.id }];
      for (const s of siblings) n += Number(insert.run(userId, s.id, now.toISOString()).changes);
    }
    return n;
  });
}

// ---- Sync --------------------------------------------------------------------------------------

/**
 * Brings everything derived up to date for the user's today: quests, nutrition settlement, decay
 * and reset, achievements, streak milestones and Body Quest snapshots. Idempotent; safe to call on
 * every read.
 */
export function syncRecognition(ctx: AppContext, userId: string, clock: UserClock): void {
  syncQuests(ctx, userId, clock);
  syncDerived(ctx.db, userId, clock.today, ctx.now());
}

/** Everything after quests: nutrition settlement, decay/reset, achievements, streak milestones, Body Quest. */
export function syncDerived(db: Db, userId: string, today: string, now: Date): void {
  transaction(db, () => {
    settleProgression(db, userId, today, now);
    syncAchievements(db, userId, today, now);
    emitStreakMilestones(db, userId, computeStreaks(db, userId, today), now);
    settleBodyQuest(db, userId, today, now);
  });
}

/** Compact summaries for Home, Profile and the AI Coach. */
export function recognitionSummary(db: Db, userId: string, today: string, now: Date) {
  const body = bodyQuestView(db, userId, today, now);
  const achievements = syncAchievements(db, userId, today, now);
  const streaks = computeStreaks(db, userId, today);
  const unlocked = achievements.filter((a) => a.state === "unlocked").sort((a, b) => (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""));
  const nextUp = achievements.filter((a) => a.state !== "unlocked").sort((a, b) => b.progress / b.target - a.progress / a.target)[0] ?? null;
  return {
    bodyQuest: { stage: body.stage, highestStage: body.highestStage, overall: body.overall, statsWithData: body.statsWithData, nextStage: body.next?.stage ?? null },
    achievements: {
      unlocked: unlocked.length,
      total: achievements.length,
      recent: unlocked.slice(0, 3).map((a) => ({ id: a.id, title: a.title, unlockedAt: a.unlockedAt! })),
      next: nextUp ? { id: nextUp.id, title: nextUp.title, progress: nextUp.progress, target: nextUp.target } : null,
    },
    streaks: {
      workout: { current: streaks.workout.current, longest: streaks.workout.longest },
      nutrition: { current: streaks.nutrition.current, longest: streaks.nutrition.longest, available: streaks.nutrition.available },
      quest: { current: streaks.quest.current, longest: streaks.quest.longest },
      weekly: { current: streaks.weekly.current, longest: streaks.weekly.longest, target: streaks.weekly.target, metThisWeek: streaks.weekly.metThisWeek },
    },
  };
}
