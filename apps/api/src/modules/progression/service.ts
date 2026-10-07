import {
  activeXpFrom,
  addDays,
  CONSISTENCY_RULES,
  dayOutcome,
  daysUntilReset,
  isRecoveryDay,
  lifetimeXpFrom,
  nutritionDayXp,
  progressFromXp,
  RANKS,
  rankForLevel,
  resetThreshold,
  xpRequiredForLevel,
  workoutStreak,
  type ConsistencyInput,
  type XpKind,
  type XpSource,
} from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import { domainEventWritten } from "../../shared/observability";
import { hasAnyTarget, targetOn } from "../nutrition/targets";

/**
 * ProgressionEngine (server side) — the one source of truth for XP, level and rank.
 *
 * Validated domain event → XP rule → append-only ledger entry → active XP → level → rank.
 *
 * - Every XP change is a new entry in xp_events (never an edit; the table refuses UPDATE/DELETE).
 *   Each has a unique idempotency key, so retries and concurrent requests can't double-award.
 * - When something already rewarded changes (a late food edit, a quest's progress dropping), the
 *   ledger gets a compensating adjustment that brings that reference to its correct total.
 * - Daily consistency rules (decay for a missed day, reset after too long without training) are
 *   applied once per finished day, in order, from a cursor — deterministic and auditable.
 * - A reset is an entry that starts a new active epoch; all history (workouts, PRs, food, XP
 *   entries) stays exactly as it was.
 */

// ---- Ledger ------------------------------------------------------------------------------------

export interface LedgerEntry {
  userId: string;
  source: XpSource;
  reference: string;
  kind: XpKind;
  xp: number;
  idempotencyKey: string;
  localDate: string | null;
  detail: Record<string, unknown>;
  now: Date;
  domainEventId?: number | null;
}

/** Appends one entry; a repeated idempotency key is a no-op. Returns true if it was written. */
export function appendXp(db: Db, e: LedgerEntry): boolean {
  const r = db
    .prepare(
      `INSERT INTO xp_events (user_id, source, source_key, kind, xp, idempotency_key, domain_event_id, local_date, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, idempotency_key) DO NOTHING`,
    )
    .run(e.userId, e.source, e.reference, e.kind, Math.trunc(e.xp), e.idempotencyKey, e.domainEventId ?? null, e.localDate, JSON.stringify(e.detail), e.now.toISOString());
  return r.changes > 0;
}

/** Records a domain event (idempotent on user, type, key) and returns its id. */
export function emitDomainEvent(db: Db, userId: string, type: string, key: string, payload: Record<string, unknown>, now: Date): number {
  const r = db.prepare("INSERT OR IGNORE INTO domain_events (user_id, type, key, payload, created_at) VALUES (?, ?, ?, ?, ?)").run(userId, type, key, JSON.stringify({ type, key, ...payload }), now.toISOString());
  if (r.changes > 0) domainEventWritten(db, { userId, type, key });
  return (db.prepare("SELECT id FROM domain_events WHERE user_id = ? AND type = ? AND key = ?").get(userId, type, key) as { id: number }).id;
}

function referenceTotal(db: Db, userId: string, source: XpSource, reference: string): { total: number; entries: number } {
  return db.prepare("SELECT COALESCE(SUM(xp), 0) AS total, COUNT(*) AS entries FROM xp_events WHERE user_id = ? AND source = ? AND source_key = ?").get(userId, source, reference) as {
    total: number;
    entries: number;
  };
}

/**
 * Brings the ledger total for one reference to `target` by appending the difference — the first
 * entry is the award, later ones are compensating adjustments. Never edits an entry.
 */
export function settleReference(db: Db, e: { userId: string; source: XpSource; reference: string; target: number; localDate: string | null; detail: Record<string, unknown>; now: Date; domainEventId?: number | null }): void {
  const { total, entries } = referenceTotal(db, e.userId, e.source, e.reference);
  const target = Math.trunc(e.target);
  if (entries > 0 && total === target) return;
  appendXp(db, {
    userId: e.userId,
    source: e.source,
    reference: e.reference,
    kind: entries === 0 ? "award" : "adjustment",
    xp: target - total,
    idempotencyKey: `${e.source}:${e.reference}:${entries}`,
    localDate: e.localDate,
    detail: entries === 0 ? e.detail : { ...e.detail, previousTotal: total, newTotal: target },
    now: e.now,
    domainEventId: e.domainEventId,
  });
}

/**
 * A manual correction (support/admin tooling — there is no client endpoint for this). A
 * compensating entry with a reason; the history it corrects stays untouched.
 */
export function correctXp(db: Db, e: { userId: string; xp: number; reason: string; reference: string; correctionId: string; now: Date }): boolean {
  return appendXp(db, { userId: e.userId, source: "correction", reference: e.reference, kind: "correction", xp: e.xp, idempotencyKey: `correction:${e.correctionId}`, localDate: null, detail: { reason: e.reason }, now: e.now });
}

interface Row {
  id: number;
  source: XpSource;
  source_key: string;
  kind: XpKind;
  xp: number;
  local_date: string | null;
  detail: string;
  created_at: string;
}

function lastReset(db: Db, userId: string): Row | null {
  return (db.prepare("SELECT * FROM xp_events WHERE user_id = ? AND kind = 'reset' ORDER BY id DESC LIMIT 1").get(userId) as Row | undefined) ?? null;
}

/** Active XP: everything since the latest reset (optionally only entries dated on or before `asOf`). */
export function activeXp(db: Db, userId: string, asOf?: string): number {
  const reset = lastReset(db, userId);
  const rows = db
    .prepare(`SELECT kind, xp FROM xp_events WHERE user_id = ? AND id > ? ${asOf ? "AND (local_date IS NULL OR local_date <= ?)" : ""} ORDER BY id`)
    .all(...([userId, reset?.id ?? 0, ...(asOf ? [asOf] : [])] as [string, number, ...string[]])) as { kind: XpKind; xp: number }[];
  return activeXpFrom(rows);
}

/** Runs `fn` and emits a level-up event if it raised the active level. */
function trackingLevel<T>(db: Db, userId: string, now: Date, fn: () => T): T {
  const before = progressFromXp(activeXp(db, userId)).level;
  const result = fn();
  const after = progressFromXp(activeXp(db, userId)).level;
  if (after > before) {
    const epoch = lastReset(db, userId)?.id ?? 0;
    emitDomainEvent(db, userId, "progression.level_up", `${epoch}:${after}`, { level: after, rank: rankForLevel(after), previousLevel: before }, now);
  }
  return result;
}

/** Appends a workout's award (from the XP engine) for its workout.completed domain event. */
export function awardWorkoutXp(db: Db, e: { userId: string; workoutId: string; localDate: string; xp: number; detail: Record<string, unknown>; domainEventId: number; now: Date }): void {
  trackingLevel(db, e.userId, e.now, () => {
    appendXp(db, { userId: e.userId, source: "workout", reference: e.workoutId, kind: "award", xp: e.xp, idempotencyKey: `workout:${e.workoutId}`, localDate: e.localDate, detail: e.detail, now: e.now, domainEventId: e.domainEventId });
    // A workout on a day that already decayed (logged late) cancels that day's decay.
    const decay = referenceTotal(db, e.userId, "decay", e.localDate);
    if (decay.total < 0) {
      appendXp(db, { userId: e.userId, source: "decay", reference: e.localDate, kind: "adjustment", xp: -decay.total, idempotencyKey: `decay:${e.localDate}:reversed`, localDate: e.localDate, detail: { reason: "workout_logged_for_day", workoutId: e.workoutId }, now: e.now });
    }
  });
}

/** An achievement's one-time reward, from its achievement.unlocked domain event. */
export function awardAchievementXp(db: Db, e: { userId: string; achievementId: string; title: string; xp: number; localDate: string; domainEventId: number; now: Date }): void {
  trackingLevel(db, e.userId, e.now, () => {
    appendXp(db, { userId: e.userId, source: "achievement", reference: e.achievementId, kind: "award", xp: e.xp, idempotencyKey: `achievement:${e.achievementId}`, localDate: e.localDate, detail: { achievementId: e.achievementId, title: e.title }, now: e.now, domainEventId: e.domainEventId });
  });
}

/** Settles a quest period to its reward (completed) or zero (no longer complete). */
export function settleQuestXp(db: Db, e: { userId: string; questId: string; periodKey: string; xpReward: number; completed: boolean; localDate: string; now: Date }): void {
  const reference = `${e.questId}:${e.periodKey}`;
  trackingLevel(db, e.userId, e.now, () => {
    const { entries, total } = referenceTotal(db, e.userId, "quest", reference);
    if (entries === 0 && !e.completed) return; // never started rewarding: nothing to record
    const target = e.completed ? e.xpReward : 0;
    if (entries > 0 && total === target) return;
    const eventId = emitDomainEvent(db, e.userId, e.completed ? "quest.completed" : "quest.withdrawn", `${reference}:${entries}`, { questId: e.questId, periodKey: e.periodKey, xpReward: e.xpReward }, e.now);
    settleReference(db, { userId: e.userId, source: "quest", reference, target, localDate: e.localDate, detail: { questId: e.questId, periodKey: e.periodKey }, now: e.now, domainEventId: eventId });
  });
}

// ---- Nutrition days ----------------------------------------------------------------------------

function dayTotals(db: Db, userId: string, date: string): { n: number; kcal: number } {
  return db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(kcal), 0) AS kcal FROM food_logs WHERE user_id = ? AND local_date = ?").get(userId, date) as {
    n: number;
    kcal: number;
  };
}

export function evaluateNutritionDay(db: Db, userId: string, date: string, dayComplete: boolean) {
  const target = targetOn(db, userId, date);
  if (!target) return { xp: 0, flags: ["no_targets"] as string[] };
  const { n, kcal } = dayTotals(db, userId, date);
  return nutritionDayXp({
    mealsLogged: Math.min(n, 50),
    totalKcal: Math.min(kcal, 20_000),
    targetKcal: target.targetKcal,
    safeFloorKcal: target.safeFloorKcal,
    dayComplete,
  });
}

/** Settles a finished day's nutrition XP; a later edit appends a compensating adjustment. */
export function settleNutritionDay(db: Db, userId: string, date: string, now: Date): void {
  const result = evaluateNutritionDay(db, userId, date, true);
  trackingLevel(db, userId, now, () =>
    settleReference(db, { userId, source: "nutrition_day", reference: date, target: result.xp, localDate: date, detail: { flags: result.flags }, now }),
  );
}

/** After a late edit to an already-settled day, re-settle it so the ledger matches its logs. */
export function resettleIfSettled(db: Db, userId: string, date: string, now: Date): void {
  if (referenceTotal(db, userId, "nutrition_day", date).entries > 0) settleNutritionDay(db, userId, date, now);
}

export function settleCompletedNutritionDays(db: Db, userId: string, today: string, now: Date): void {
  const pending = db
    .prepare(
      `SELECT DISTINCT local_date AS d FROM food_logs f WHERE f.user_id = ? AND f.local_date < ?
         AND NOT EXISTS (SELECT 1 FROM xp_events e WHERE e.user_id = f.user_id AND e.source = 'nutrition_day' AND e.source_key = f.local_date)
       ORDER BY local_date`,
    )
    .all(userId, today) as { d: string }[];
  for (const { d } of pending) settleNutritionDay(db, userId, d, now);
}

export function nutritionDayPreview(db: Db, userId: string, date: string, today: string) {
  if (date < today) {
    const ref = referenceTotal(db, userId, "nutrition_day", date);
    if (ref.entries > 0) {
      const last = db.prepare("SELECT detail FROM xp_events WHERE user_id = ? AND source = 'nutrition_day' AND source_key = ? ORDER BY id DESC LIMIT 1").get(userId, date) as { detail: string };
      return { xp: ref.total, flags: (JSON.parse(last.detail).flags ?? []) as string[], settled: true };
    }
  }
  return { ...evaluateNutritionDay(db, userId, date, date < today), settled: false };
}

// ---- Consistency: decay and reset --------------------------------------------------------------

function consistencyInput(db: Db, userId: string): ConsistencyInput & { firstWorkout: string | null; workouts: { localDate: string; painLevel: string }[] } {
  const workouts = db.prepare("SELECT local_date AS d, pain_level AS pain FROM workouts WHERE user_id = ? ORDER BY local_date").all(userId) as { d: string; pain: string }[];
  const days = db.prepare("SELECT training_days_per_week AS n FROM profiles WHERE user_id = ?").get(userId) as { n: number | null } | undefined;
  return {
    workoutDates: [...new Set(workouts.map((w) => w.d))],
    seriousPainDates: [...new Set(workouts.filter((w) => w.pain === "serious").map((w) => w.d))],
    trainingDaysPerWeek: days?.n ?? null,
    firstWorkout: workouts[0]?.d ?? null,
    workouts: workouts.map((w) => ({ localDate: w.d, painLevel: w.pain })),
  };
}

/** Days are evaluated at most this far back (the reset makes anything older irrelevant). */
const MAX_LOOKBACK_DAYS = 60;

/**
 * Applies the decay and reset rules to every finished day not yet evaluated, in order. Each day
 * produces at most one entry, keyed by its date, so this is idempotent and safe under concurrency.
 */
export function settleConsistency(db: Db, userId: string, today: string, now: Date): void {
  const input = consistencyInput(db, userId);
  if (!input.firstWorkout) return;
  const state = db.prepare("SELECT evaluated_through AS t FROM progression_state WHERE user_id = ?").get(userId) as { t: string } | undefined;
  const yesterday = addDays(today, -1);
  let from = addDays(input.firstWorkout, 1);
  if (state && addDays(state.t, 1) > from) from = addDays(state.t, 1);
  if (addDays(today, -MAX_LOOKBACK_DAYS) > from) from = addDays(today, -MAX_LOOKBACK_DAYS);

  for (let d = from; d <= yesterday; d = addDays(d, 1)) {
    const reset = lastReset(db, userId);
    const outcome = dayOutcome({ ...input, date: d, lastReset: reset?.local_date ?? null, activeXp: activeXp(db, userId, d) });
    if (outcome.kind === "decay") {
      appendXp(db, { userId, source: "decay", reference: d, kind: "decay", xp: -outcome.amount, idempotencyKey: `decay:${d}`, localDate: d, detail: { reason: "missed_training_day", trainingDaysPerWeek: input.trainingDaysPerWeek ?? CONSISTENCY_RULES.defaultTrainingDaysPerWeek }, now });
    } else if (outcome.kind === "reset") {
      const xp = activeXp(db, userId);
      const p = progressFromXp(xp);
      const payload = { date: d, previousActiveXp: xp, previousLevel: p.level, previousRank: p.rank, gapDays: outcome.gapDays, threshold: outcome.threshold, lastWorkoutDate: input.workoutDates.filter((w) => w <= d).at(-1) ?? null };
      const eventId = emitDomainEvent(db, userId, "progression.reset", d, payload, now);
      appendXp(db, { userId, source: "reset", reference: d, kind: "reset", xp: 0, idempotencyKey: `reset:${d}`, localDate: d, detail: payload, now, domainEventId: eventId });
    }
  }
  if (yesterday >= from || !state) {
    db.prepare("INSERT INTO progression_state (user_id, evaluated_through, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET evaluated_through = MAX(evaluated_through, excluded.evaluated_through), updated_at = excluded.updated_at").run(
      userId,
      yesterday,
      now.toISOString(),
    );
  }
}

/** Settles everything due for `today` (nutrition days, decay, resets) in one transaction. */
export function settleProgression(db: Db, userId: string, today: string, now: Date): void {
  transaction(db, () => {
    settleCompletedNutritionDays(db, userId, today, now);
    settleConsistency(db, userId, today, now);
  });
}

// ---- The progress view -------------------------------------------------------------------------

const SOURCE_LABEL: Record<XpSource, string> = {
  workout: "Workout",
  nutrition_day: "Nutrition day",
  quest: "Quest",
  achievement: "Achievement",
  decay: "Missed training day",
  reset: "Progress reset",
  correction: "Correction",
};

function ledgerLabel(r: Row, detail: Record<string, unknown>): string {
  if (r.kind === "adjustment" && r.source === "decay") return "Missed day cancelled — workout logged";
  if (r.source === "quest" && r.kind === "adjustment") return r.xp < 0 ? "Quest no longer complete" : "Quest complete";
  if (r.source === "quest" && typeof detail.questId === "string") return "Quest complete";
  if (r.source === "achievement" && typeof detail.title === "string") return `Achievement: ${detail.title}`;
  if (r.kind === "adjustment") return `${SOURCE_LABEL[r.source]} updated`;
  return SOURCE_LABEL[r.source];
}

export function ledgerView(r: Row) {
  const detail = JSON.parse(r.detail) as Record<string, unknown>;
  const label = ledgerLabel(r, detail);
  return { id: r.id, source: r.source, reference: r.source_key, kind: r.kind, xp: r.xp, localDate: r.local_date, label, detail, at: r.created_at };
}

export function recentLedger(db: Db, userId: string, limit = 20, before?: number) {
  const rows = db
    .prepare(`SELECT * FROM xp_events WHERE user_id = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`)
    .all(...([userId, ...(before ? [before] : []), limit] as [string, ...number[]])) as unknown as Row[];
  return rows.map(ledgerView);
}

export function computeUserProgress(db: Db, userId: string, today: string, now: Date) {
  settleProgression(db, userId, today, now);

  const reset = lastReset(db, userId);
  const epoch = db.prepare("SELECT source, kind, xp FROM xp_events WHERE user_id = ? AND id > ? ORDER BY id").all(userId, reset?.id ?? 0) as { source: XpSource; kind: XpKind; xp: number }[];
  const all = db.prepare("SELECT kind, xp FROM xp_events WHERE user_id = ? ORDER BY id").all(userId) as { kind: XpKind; xp: number }[];
  const sum = (s: XpSource) => epoch.filter((e) => e.source === s).reduce((t, e) => t + e.xp, 0);
  const provisional = dayTotals(db, userId, today).n > 0 ? evaluateNutritionDay(db, userId, today, false).xp : 0;
  const active = activeXpFrom(epoch) + provisional;

  const input = consistencyInput(db, userId);
  const levelUp = db.prepare("SELECT payload, created_at FROM domain_events WHERE user_id = ? AND type = 'progression.level_up' ORDER BY id DESC LIMIT 1").get(userId) as { payload: string; created_at: string } | undefined;
  const levelUpPayload = levelUp ? (JSON.parse(levelUp.payload) as { level: number; rank: string }) : null;

  return {
    ...progressFromXp(active),
    /** XP earned across all time, including before any reset. */
    lifetimeXp: lifetimeXpFrom(all) + provisional,
    provisionalXp: provisional,
    rankLadder: RANKS.map((r) => ({ name: r.name, minLevel: r.minLevel, xpRequired: xpRequiredForLevel(r.minLevel) })),
    xpSources: {
      workouts: sum("workout"),
      nutrition: sum("nutrition_day") + provisional,
      quests: sum("quest"),
      achievements: sum("achievement"),
      decay: sum("decay"),
      corrections: sum("correction"),
    },
    nutritionXpEnabled: hasAnyTarget(db, userId),
    // Plan-aware: scheduled rest and recovery after reported pain never break it.
    streak: workoutStreak({ workouts: input.workouts, trainingDaysPerWeek: input.trainingDaysPerWeek }, today),
    consistency: {
      trainingDaysPerWeek: input.trainingDaysPerWeek ?? CONSISTENCY_RULES.defaultTrainingDaysPerWeek,
      decayPerMissedDay: CONSISTENCY_RULES.decayPerMissedDay,
      resetAfterDays: resetThreshold(input.trainingDaysPerWeek),
      /** Days (counting today) within which a workout keeps active progress; null before the first workout. */
      trainWithinDays: daysUntilReset(today, input, reset?.local_date ?? null),
      recovering: isRecoveryDay(today, input),
      missedThisWeek: (db.prepare("SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ? AND kind = 'decay' AND local_date >= ?").get(userId, addDays(today, -6)) as { n: number }).n,
    },
    lastReset: reset ? { date: reset.local_date, ...(JSON.parse(reset.detail) as { previousLevel: number; previousRank: string; previousActiveXp: number; gapDays: number }) } : null,
    recentLevelUp: levelUp && levelUpPayload ? { level: levelUpPayload.level, rank: levelUpPayload.rank, at: levelUp.created_at } : null,
  };
}
