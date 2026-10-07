import {  ACHIEVEMENTS,
  activeXpFrom,
  addDays,
  bucketKey,
  bucketsFor,
  dayNumber,
  chartForUnits,
  chartModel,
  computeTrend,
  dateRange,
  estimateOneRepMax,
  EXERCISE_BY_ID,
  formatRecordValue,
  GOAL_FOCUS_SECTIONS,
  granularityFor,
  interpretTrend,
  KG_PER_LB,
  localDateIn,
  METRICS,
  PR_METRICS,
  progressFromXp,
  QUESTS,
  TREND,
  weekStart,
  weightSpec,
  type AnalyticsRange,
  type AnalyticsSection,
  type ChartModel,
  type DateRange,
  type Granularity,
  type Point,
  type PrKind,
  type PrimaryGoal,
  type Trend,
  type XpKind, hasFeature, premiumFeature, type Entitlements, type PremiumFeatureId } from "@form/domain";
import type { Db } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { nutritionDayTotals } from "../nutrition/service";
import { targetOn } from "../nutrition/targets";
import { bodyQuestView, computeStreaks, syncRecognition } from "../recognition/service";
import { userState } from "../users/service";

/**
 * ProgressAnalyticsService — one place that turns the user's own records into ranges, trends,
 * chart models and summaries. Everything is read from authoritative tables (workouts, verified
 * reps, food logs, weight entries, the XP ledger, records, quests, Body Quest snapshots,
 * achievements) for whole local days in the user's time zone. Nothing is estimated that wasn't
 * logged: no body composition, no percentiles, no comparison with other people.
 *
 * Results are cached per user, range, exercise and day, keyed by a fingerprint of the user's data;
 * any new workout, food entry, weight entry, ledger entry, quest or snapshot changes the
 * fingerprint, so the next read recomputes (event-driven invalidation without bookkeeping).
 */

const PROTEIN_MET = 0.9;
const ON_TARGET = 0.1;
const ACHIEVEMENT_TITLE = new Map(ACHIEVEMENTS.map((a) => [a.id, a.title]));

export interface AnalyticsQuery {
  range: AnalyticsRange;
  exerciseId?: string;
}

// ---- Cache ----------------------------------------------------------------------------------------

const CACHE_LIMIT = 500;
const cache = new Map<string, { stamp: string; value: ProgressAnalytics }>();
export const analyticsCacheStats = { hits: 0, misses: 0 };

/** Drops a user's cached analytics (e.g. when their account is deleted). */
export function forgetUserAnalytics(userId: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(`${userId}|`)) cache.delete(k);
}

/** Cheap fingerprint of everything analytics reads; changes whenever any of it does. */
function dataStamp(db: Db, userId: string): string {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) || ':' || COALESCE(MAX(created_at), '') FROM workouts WHERE user_id = :u) AS w,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM food_logs WHERE user_id = :u) AS f,
         (SELECT COUNT(*) || ':' || COALESCE(SUM(weight_kg), 0) FROM body_measurements WHERE user_id = :u) AS b,
         (SELECT COALESCE(MAX(id), 0) FROM xp_events WHERE user_id = :u) AS x,
         (SELECT COALESCE(MAX(id), 0) FROM personal_records WHERE user_id = :u) AS p,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(completed_at), '') FROM user_quests WHERE user_id = :u AND status = 'completed') AS q,
         (SELECT COALESCE(MAX(id), 0) FROM body_quest_snapshots WHERE user_id = :u) AS s,
         (SELECT COUNT(*) FROM user_achievements WHERE user_id = :u) AS a,
         (SELECT COALESCE(updated_at, '') || ':' || COALESCE(primary_goal, '') || ':' || COALESCE(training_days_per_week, '') FROM profiles WHERE user_id = :u) AS pr,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(effective_from), '') FROM goal_history WHERE user_id = :u) AS gh,
         (SELECT COALESCE(units, '') || COALESCE(timezone, '') || COALESCE(updated_at, '') FROM user_settings WHERE user_id = :u) AS st,
         (SELECT COUNT(*) || ':' || COALESCE(MAX(effective_from), '') FROM nutrition_targets WHERE user_id = :u) AS t`,
    )
    .get({ u: userId }) as Record<string, string | number | null>;
  return Object.values(row).join("|");
}

// ---- Model ----------------------------------------------------------------------------------------

export interface Section<T> {
  available: boolean;
  /** A FORM Pro section the user doesn't have: no data is sent, only what it would show. */
  locked?: { feature: PremiumFeatureId; title: string; pro: string } | null;
  /** One of the clearest signals for the user's goal. */
  focus: boolean;
  interpretation: string | null;
  data: T;
}

export interface ProgressAnalytics {
  range: DateRange & { timezone: string; granularity: Granularity };
  units: "metric" | "imperial";
  goal: { primary: PrimaryGoal | null };
  /** Sections in order of relevance to the user's goal. */
  order: AnalyticsSection[];
  strength: Section<{ exercises: { exerciseId: string; name: string; sessions: number; measure: "estimated_1rm" | "verified_reps" }[]; selected: { exerciseId: string; name: string; measure: "estimated_1rm" | "verified_reps"; chart: ChartModel; best: number | null } | null }>;
  form: Section<{ chart: ChartModel; averageScore: number | null; reps: number }>;
  rom: Section<{ chart: ChartModel; averagePercent: number | null; reps: number }>;
  verifiedReps: Section<{ chart: ChartModel; total: number }>;
  consistency: Section<{ chart: ChartModel; trainingDays: number; plannedDays: number; adherencePercent: number | null; workouts: number; minutes: number }>;
  nutrition: Section<{
    kcalChart: ChartModel;
    proteinChart: ChartModel;
    daysLogged: number;
    daysOnTarget: number;
    daysMeetingProtein: number;
    daysBelowSafeMinimum: number;
    /** Share of logged calories that were estimated vs weighed, over the range. */
    estimatedPercent: number | null;
    measuredPercent: number | null;
    hasTargets: boolean;
  }>;
  weight: Section<{ chart: ChartModel; latest: number | null; latestDate: string | null; entries: number }>;
  xp: Section<{ chart: ChartModel; earned: number; lost: number; levelUps: { level: number; rank: string; date: string }[]; level: number; rank: string; resets: string[] }>;
  prs: Section<{ chart: ChartModel; records: { date: string; exercise: string; label: string; display: string; previousDisplay: string | null; beaten: boolean }[] }>;
  quests: Section<{ completed: number; daily: number; weekly: number; history: { title: string; cadence: "daily" | "weekly"; period: string; xpReward: number }[] }>;
  bodyQuest: Section<{ chart: ChartModel; stage: string; overall: number | null; stageChanges: { weekStart: string; from: string; to: string }[] }>;
  achievements: { unlocked: { id: string; title: string; date: string }[] };
  streaks: { workout: { current: number; longest: number }; weekly: { current: number; longest: number }; nutrition: { current: number; longest: number; available: boolean }; quest: { current: number; longest: number } };
  summaries: {
    daily: PeriodSummary[] | null;
    weekly: PeriodSummary[] | null;
    monthly: PeriodSummary[] | null;
  };
  generatedAt: string;
}

export interface PeriodSummary {
  key: string;
  from: string;
  to: string;
  partial: boolean;
  hasData: boolean;
  trainingDays: number;
  workouts: number;
  minutes: number;
  verifiedReps: number;
  averageForm: number | null;
  daysLogged: number;
  averageKcal: number | null;
  averageProteinG: number | null;
  xpEarned: number;
  prs: number;
}

// ---- Loading --------------------------------------------------------------------------------------

interface SetRow {
  date: string;
  exerciseId: string;
  loadKg: number;
  verifiedReps: number;
  formScore: number | null;
  romPercent: number | null;
}

function load(db: Db, userId: string, r: DateRange, tz: string) {
  const workouts = db
    .prepare("SELECT local_date AS date, duration_minutes AS minutes, pain_level AS pain FROM workouts WHERE user_id = ? AND local_date BETWEEN ? AND ?")
    .all(userId, r.from, r.to) as { date: string; minutes: number; pain: string }[];
  // Verified sets only; sessions with serious pain never count toward performance trends.
  const sets = db
    .prepare(
      `SELECT w.local_date AS date, s.exercise_id AS exerciseId, s.load_kg AS loadKg, s.verified_reps AS verifiedReps, s.form_score AS formScore, s.rom_percent AS romPercent
       FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ? AND s.verified_reps > 0 AND w.pain_level <> 'serious'`,
    )
    .all(userId, r.from, r.to) as unknown as SetRow[];
  const weights = db
    .prepare("SELECT local_date AS date, weight_kg AS kg FROM body_measurements WHERE user_id = ? AND local_date BETWEEN ? AND ? AND weight_kg IS NOT NULL ORDER BY local_date")
    .all(userId, r.from, r.to) as { date: string; kg: number }[];
  const ledger = db.prepare("SELECT kind, xp, source, local_date AS date, substr(created_at, 1, 10) AS created FROM xp_events WHERE user_id = ? ORDER BY id").all(userId) as {
    kind: XpKind;
    xp: number;
    source: string;
    date: string | null;
    created: string;
  }[];
  const records = db
    .prepare("SELECT exercise_id AS exerciseId, kind, value, previous, local_date AS date FROM personal_records WHERE user_id = ? AND status = 'awarded' AND local_date BETWEEN ? AND ? ORDER BY id DESC")
    .all(userId, r.from, r.to) as { exerciseId: string; kind: PrKind; value: number; previous: number | null; date: string }[];
  const quests = db
    .prepare("SELECT quest_id AS questId, period_key AS period FROM user_quests WHERE user_id = ? AND status = 'completed' AND period_key BETWEEN ? AND ? ORDER BY period_key DESC")
    .all(userId, addDays(r.from, -6), r.to) as { questId: string; period: string }[];
  const snapshots = db
    .prepare("SELECT week_start AS week, as_of AS asOf, stage, overall FROM body_quest_snapshots WHERE user_id = ? AND as_of BETWEEN ? AND ? ORDER BY week_start")
    .all(userId, r.from, r.to) as { week: string; asOf: string; stage: string; overall: number | null }[];
  const levelUps = db.prepare("SELECT payload, created_at AS at FROM domain_events WHERE user_id = ? AND type = 'progression.level_up' ORDER BY id").all(userId) as { payload: string; at: string }[];
  const achievements = db.prepare("SELECT achievement_id AS id, unlocked_at AS at FROM user_achievements WHERE user_id = ?").all(userId) as { id: string; at: string }[];
  // When the user started: their first workout or their account, whichever came first (local dates).
  const first = db.prepare("SELECT MIN(local_date) AS d FROM workouts WHERE user_id = ?").get(userId) as { d: string | null };
  const created = db.prepare("SELECT created_at AS at FROM users WHERE id = ?").get(userId) as { at: string } | undefined;
  const createdOn = created ? localDateIn(tz, new Date(created.at)) : null;
  const startedOn = [first.d, createdOn].filter((x): x is string => !!x).sort()[0] ?? null;
  return { startedOn, workouts, sets, weights, ledger, records, quests, snapshots, levelUps, achievements };
}

// ---- Compute --------------------------------------------------------------------------------------

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, dp = 0) => (n === null ? null : Math.round(n * 10 ** dp) / 10 ** dp);
/** Rep-weighted average of a per-set score. */
const weighted = (sets: SetRow[], key: "formScore" | "romPercent") => {
  const s = sets.filter((x) => x[key] !== null);
  const reps = s.reduce((a, x) => a + x.verifiedReps, 0);
  return reps ? s.reduce((a, x) => a + Math.min(100, x[key]!) * x.verifiedReps, 0) / reps : null;
};
const perDay = <T extends { date: string }>(rows: T[], f: (rows: T[]) => number | null): Point[] => {
  const by = new Map<string, T[]>();
  for (const r of rows) by.set(r.date, [...(by.get(r.date) ?? []), r]);
  return [...by.entries()].flatMap(([date, rs]) => {
    const v = f(rs);
    return v === null ? [] : [{ date, value: v }];
  });
};

function section<T>(id: AnalyticsSection, data: T, available: boolean, trend: Trend | null, goal: PrimaryGoal | null): Section<T> {
  return { available, focus: goal ? GOAL_FOCUS_SECTIONS[goal].includes(id) : false, interpretation: available && trend ? interpretTrend(id, trend, goal) : null, data };
}

function computeAnalytics(ctx: AppContext, userId: string, clock: UserClock, q: AnalyticsQuery): ProgressAnalytics {
  const { db } = ctx;
  const today = clock.today;
  const r = dateRange(today, q.range);
  const g = granularityFor(q.range);
  const state = userState(db, userId, today);
  const goal = state.profile?.primaryGoal ?? null;
  const energy = state.personalization.goal.energy;
  const plan = Math.min(6, Math.max(1, state.profile?.trainingDaysPerWeek ?? 3));
  const units = ((db.prepare("SELECT units FROM user_settings WHERE user_id = ?").get(userId) as { units: "metric" | "imperial" } | undefined)?.units ?? "metric") as "metric" | "imperial";
  const d = load(db, userId, r, clock.timezone);

  // Strength: per exercise, best verified performance per day (estimated 1RM for loaded lifts, verified reps otherwise).
  const byExercise = new Map<string, SetRow[]>();
  for (const s of d.sets) byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s]);
  const exercises = [...byExercise.entries()]
    .map(([exerciseId, sets]) => ({
      exerciseId,
      name: EXERCISE_BY_ID.get(exerciseId)?.name ?? exerciseId,
      sessions: new Set(sets.map((s) => s.date)).size,
      measure: (sets.some((s) => s.loadKg > 0) ? "estimated_1rm" : "verified_reps") as "estimated_1rm" | "verified_reps",
    }))
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  if (q.exerciseId && !EXERCISE_BY_ID.has(q.exerciseId)) throw new HttpError(400, "unknown_exercise", "Unknown exercise");
  const chosen = q.exerciseId ?? exercises[0]?.exerciseId ?? null;
  let selected: ProgressAnalytics["strength"]["data"]["selected"] = null;
  if (chosen) {
    const sets = byExercise.get(chosen) ?? [];
    const measure = exercises.find((e) => e.exerciseId === chosen)?.measure ?? (EXERCISE_BY_ID.get(chosen)?.loadable ? "estimated_1rm" : "verified_reps");
    const points = perDay(sets, (rs) =>
      measure === "estimated_1rm" ? Math.max(...rs.filter((s) => s.loadKg > 0).map((s) => estimateOneRepMax(s.loadKg, Math.min(s.verifiedReps, 1000)) ?? s.loadKg), 0) || null : Math.max(...rs.map((s) => s.verifiedReps)),
    );
    const spec = measure === "estimated_1rm" ? METRICS.strength : METRICS.strength_reps;
    const chart = chartForUnits(chartModel({ id: "strength", title: `${EXERCISE_BY_ID.get(chosen)?.name ?? chosen} — ${measure === "estimated_1rm" ? "estimated 1RM" : "verified reps per set"}`, spec, kind: "line", range: r, granularity: g, points, how: "max" }), units);
    selected = { exerciseId: chosen, name: EXERCISE_BY_ID.get(chosen)?.name ?? chosen, measure, chart, best: points.length ? Math.max(...chart.points.map((p) => p.value ?? 0)) : null };
  }

  // Form, range of motion and verified reps (optionally for one exercise).
  const scope = q.exerciseId ? d.sets.filter((s) => s.exerciseId === q.exerciseId) : d.sets;
  const formChart = chartModel({ id: "form", title: "Form score", spec: METRICS.form, kind: "line", range: r, granularity: g, points: perDay(scope, (rs) => round(weighted(rs, "formScore"), 1)), how: "mean" });
  const romChart = chartModel({ id: "rom", title: "Range of motion", spec: METRICS.rom, kind: "line", range: r, granularity: g, points: perDay(scope, (rs) => round(weighted(rs, "romPercent"), 1)), how: "mean" });
  const repsPoints = perDay(scope, (rs) => rs.reduce((a, s) => a + s.verifiedReps, 0));
  const repsChart = chartModel({ id: "verified_reps", title: "Verified reps", spec: METRICS.verified_reps, kind: "bar", range: r, granularity: g, points: repsPoints, how: "sum" });

  // Consistency: training days per week against the plan (always weekly — a plan is weekly).
  const painFree = d.workouts.filter((w) => w.pain !== "serious");
  const trainingDates = [...new Set(painFree.map((w) => w.date))];
  const weekBuckets = bucketsFor(r, "week");
  // Days before the user started aren't missed days: the plan applies from their start.
  const begun = d.startedOn && d.startedOn > r.from ? d.startedOn : r.from;
  const adherence: Point[] = weekBuckets
    .filter((b) => (!b.partial || b.days >= 7) && b.from >= begun)
    .map((b) => ({ date: b.from, value: Math.min(100, (trainingDates.filter((x) => x >= b.from && x <= b.to).length / plan) * 100) }));
  const consistencyChart = chartModel({
    id: "consistency",
    title: "Training days per week",
    spec: METRICS.consistency,
    kind: "bar",
    range: r,
    granularity: "week",
    points: trainingDates.map((date) => ({ date, value: 1 })),
    how: "sum",
    target: { value: plan, label: "Your plan" },
    trendPoints: adherence,
    unit: "days",
  });
  // Expected days so far: the plan, pro rata from the user's start; today only counts once it has been trained.
  const elapsed = dayNumber(today) - dayNumber(begun) + (trainingDates.includes(today) ? 1 : 0);
  const expected = (plan * elapsed) / 7;
  const adherencePercent = expected > 0 ? Math.min(100, Math.round((trainingDates.length / expected) * 100)) : null;

  // Nutrition: per logged day, against the target in force that day. Today isn't judged until it ends.
  const days = nutritionDayTotals(db, userId, r.from, r.to).filter((x) => x.totals.entries > 0);
  const targets = new Map(days.map((x) => [x.date, targetOn(db, userId, x.date)]));
  const done = days.filter((x) => x.date < today);
  const kcalPoints = days.map((x) => ({ date: x.date, value: x.totals.kcal, estimated: x.totals.estimatedKcalShare > 0 }));
  const latestTarget = targetOn(db, userId, today);
  const deviation = done.flatMap((x) => {
    const t = targets.get(x.date);
    return t ? [{ date: x.date, value: (Math.abs(x.totals.kcal - t.targetKcal) / t.targetKcal) * 100, estimated: x.totals.estimatedKcalShare > 0 }] : [];
  });
  const protein = done.flatMap((x) => {
    const t = targets.get(x.date);
    return t ? [{ date: x.date, value: Math.min(150, (x.totals.proteinG / t.proteinG) * 100), estimated: x.totals.estimatedKcalShare > 0 }] : [];
  });
  const kcalChart = chartModel({ id: "kcal", title: "Calories", spec: METRICS.kcal_deviation, kind: "bar", range: r, granularity: g, points: kcalPoints, how: g === "day" ? "sum" : "mean", target: latestTarget ? { value: latestTarget.targetKcal, label: "Target" } : null, trendPoints: deviation, unit: "kcal" });
  const proteinChart = chartModel({
    id: "protein",
    title: "Protein",
    spec: METRICS.protein,
    unit: "g",
    kind: "bar",
    range: r,
    granularity: g,
    points: days.map((x) => ({ date: x.date, value: x.totals.proteinG, estimated: x.totals.estimatedKcalShare > 0 })),
    how: g === "day" ? "sum" : "mean",
    target: latestTarget ? { value: latestTarget.proteinG, label: "Target" } : null,
    trendPoints: protein,
  });
  const totalKcal = days.reduce((a, x) => a + x.totals.kcal, 0);
  const share = (k: "estimatedKcalShare" | "measuredKcalShare") => (totalKcal > 0 ? Math.round((days.reduce((a, x) => a + x.totals[k] * x.totals.kcal, 0) / totalKcal) * 100) : null);

  // Weight: only where the user logged it, judged against their own energy goal.
  const wSpec = weightSpec(energy);
  const weightChart = chartForUnits(chartModel({ id: "weight", title: "Weight", spec: wSpec, kind: "line", range: r, granularity: g, points: d.weights.map((w) => ({ date: w.date, value: w.kg })), how: "last" }), units);
  const lastWeight = d.weights[d.weights.length - 1] ?? null;

  // XP: active XP at the end of each day (resets included), and what was earned.
  const dayOf = (e: { date: string | null; created: string }) => e.date ?? e.created;
  const xpPoints: Point[] = [];
  for (let day = r.from; day <= r.to; day = addDays(day, 1)) xpPoints.push({ date: day, value: activeXpFrom(d.ledger.filter((e) => dayOf(e) <= day)) });
  const inRange = d.ledger.filter((e) => dayOf(e) >= r.from && dayOf(e) <= r.to);
  const earnedPerWeek: Point[] = weekBuckets.map((b) => ({ date: b.from, value: inRange.filter((e) => dayOf(e) >= b.from && dayOf(e) <= b.to && e.xp > 0).reduce((a, e) => a + e.xp, 0) }));
  const xpChart = chartModel({ id: "xp", title: "XP", spec: METRICS.xp, kind: "line", range: r, granularity: g, points: xpPoints, how: "last", trendPoints: earnedPerWeek.filter((_, i) => !weekBuckets[i]!.partial || weekBuckets[i]!.days >= 7) });
  const levelNow = progressFromXp(xpPoints[xpPoints.length - 1]?.value ?? 0);
  const tz = clock.timezone;
  const toLocal = (iso: string) => localDateIn(tz, new Date(iso));
  const levelUps = d.levelUps
    .map((e) => ({ ...(JSON.parse(e.payload) as { level: number; rank: string }), date: toLocal(e.at) }))
    .filter((e) => e.date >= r.from && e.date <= r.to)
    .map((e) => ({ level: e.level, rank: e.rank, date: e.date }));

  // Records in range: beaten ones are PRs; first values are baselines.
  const recs = d.records
    .filter((x) => PR_METRICS[x.kind])
    .map((x) => ({
      date: x.date,
      exercise: x.exerciseId === "*" ? "All training" : (EXERCISE_BY_ID.get(x.exerciseId)?.name ?? x.exerciseId),
      label: PR_METRICS[x.kind].label,
      display: formatRecordValue(x.kind, x.value),
      previousDisplay: x.previous === null ? null : formatRecordValue(x.kind, x.previous),
      beaten: x.previous !== null,
    }));
  const prChart = chartModel({ id: "prs", title: "Records beaten", spec: { ...METRICS.verified_reps, id: "prs", unit: "count" }, kind: "bar", range: r, granularity: "week", points: recs.filter((x) => x.beaten).map((x) => ({ date: x.date, value: 1 })), how: "sum", noTrend: true });

  // Quests completed in range.
  const questDef = new Map(QUESTS.map((qd) => [qd.id, qd]));
  const questHistory = d.quests
    .map((x) => ({ def: questDef.get(x.questId), period: x.period }))
    .filter((x): x is { def: NonNullable<typeof x.def>; period: string } => !!x.def)
    .filter((x) => (x.def.cadence === "daily" ? x.period >= r.from : addDays(x.period, 6) >= r.from))
    .map((x) => ({ title: x.def.title.replace("{n}", String(plan)), cadence: x.def.cadence, period: x.period, xpReward: x.def.xpReward }));

  // Body Quest weekly snapshots.
  const bq = bodyQuestView(db, userId, today, ctx.now());
  const bqChart = chartModel({ id: "body_quest", title: "Body Quest overall", spec: METRICS.body_quest, kind: "line", range: r, granularity: "week", points: d.snapshots.filter((s) => s.overall !== null).map((s) => ({ date: s.asOf, value: s.overall! })), how: "last" });
  const stageChanges = d.snapshots.slice(1).flatMap((s, i) => (s.stage !== d.snapshots[i]!.stage ? [{ weekStart: s.week, from: d.snapshots[i]!.stage, to: s.stage }] : []));

  const streaks = computeStreaks(db, userId, today);

  // Summaries where the range supports them.
  const summarize = (gran: Granularity): PeriodSummary[] =>
    bucketsFor(r, gran).map((b) => {
      const within = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date >= b.from && x.date <= b.to);
      const ws = within(d.workouts);
      const ss = within(d.sets);
      const fs = within(days.map((x) => ({ date: x.date, t: x.totals })));
      const xp = inRange.filter((e) => dayOf(e) >= b.from && dayOf(e) <= b.to && e.xp > 0).reduce((a, e) => a + e.xp, 0);
      const prs = within(recs).filter((x) => x.beaten).length;
      const s: PeriodSummary = {
        key: b.key,
        from: b.from,
        to: b.to,
        partial: b.partial,
        hasData: ws.length > 0 || fs.length > 0 || xp > 0,
        trainingDays: new Set(ws.filter((w) => w.pain !== "serious").map((w) => w.date)).size,
        workouts: ws.length,
        minutes: ws.reduce((a, w) => a + w.minutes, 0),
        verifiedReps: ss.reduce((a, x) => a + x.verifiedReps, 0),
        averageForm: round(weighted(ss, "formScore")),
        daysLogged: fs.length,
        averageKcal: round(mean(fs.map((x) => x.t.kcal))),
        averageProteinG: round(mean(fs.map((x) => x.t.proteinG))),
        xpEarned: xp,
        prs,
      };
      return s;
    });

  const order = [...(goal ? GOAL_FOCUS_SECTIONS[goal] : []), ...(["strength", "consistency", "form", "rom", "verified_reps", "nutrition", "weight", "xp", "prs", "body_quest", "quests"] as AnalyticsSection[])].filter((s, i, all) => all.indexOf(s) === i);

  return {
    range: { ...r, timezone: tz, granularity: g },
    units,
    goal: { primary: goal },
    order,
    strength: section("strength", { exercises, selected }, !!selected, selected?.chart.trend ?? null, goal),
    form: section("form", { chart: formChart, averageScore: round(weighted(scope, "formScore")), reps: scope.reduce((a, s) => a + s.verifiedReps, 0) }, scope.length > 0, formChart.trend, goal),
    rom: section("rom", { chart: romChart, averagePercent: round(weighted(scope, "romPercent")), reps: scope.reduce((a, s) => a + s.verifiedReps, 0) }, scope.length > 0, romChart.trend, goal),
    verifiedReps: section("verified_reps", { chart: repsChart, total: scope.reduce((a, s) => a + s.verifiedReps, 0) }, scope.length > 0, computeTrend(repsPoints, METRICS.verified_reps, r), goal),
    consistency: section(
      "consistency",
      { chart: consistencyChart, trainingDays: trainingDates.length, plannedDays: Math.round(expected * 10) / 10, adherencePercent, workouts: d.workouts.length, minutes: d.workouts.reduce((a, w) => a + w.minutes, 0) },
      true,
      consistencyChart.trend,
      goal,
    ),
    nutrition: section(
      "nutrition",
      {
        kcalChart,
        proteinChart,
        daysLogged: days.length,
        daysOnTarget: done.filter((x) => {
          const t = targets.get(x.date);
          return t && Math.abs(x.totals.kcal - t.targetKcal) <= t.targetKcal * ON_TARGET;
        }).length,
        daysMeetingProtein: done.filter((x) => {
          const t = targets.get(x.date);
          return t && x.totals.proteinG >= t.proteinG * PROTEIN_MET;
        }).length,
        daysBelowSafeMinimum: done.filter((x) => {
          const t = targets.get(x.date);
          return t && x.totals.kcal < t.safeFloorKcal;
        }).length,
        estimatedPercent: share("estimatedKcalShare"),
        measuredPercent: share("measuredKcalShare"),
        hasTargets: latestTarget !== null,
      },
      days.length > 0,
      kcalChart.trend,
      goal,
    ),
    weight: section("weight", { chart: weightChart, latest: lastWeight ? (units === "imperial" ? Math.round((lastWeight.kg / KG_PER_LB) * 10) / 10 : lastWeight.kg) : null, latestDate: lastWeight?.date ?? null, entries: d.weights.length }, d.weights.length > 0, computeTrend(d.weights.map((w) => ({ date: w.date, value: w.kg })), wSpec, r), goal),
    xp: section(
      "xp",
      {
        chart: xpChart,
        earned: inRange.filter((e) => e.xp > 0).reduce((a, e) => a + e.xp, 0),
        lost: -inRange.filter((e) => e.xp < 0).reduce((a, e) => a + e.xp, 0),
        levelUps,
        level: levelNow.level,
        rank: levelNow.rank,
        resets: inRange.filter((e) => e.kind === "reset").map((e) => dayOf(e)),
      },
      d.ledger.length > 0,
      xpChart.trend,
      goal,
    ),
    prs: section("prs", { chart: prChart, records: recs }, recs.length > 0, null, goal),
    quests: section("quests", { completed: questHistory.length, daily: questHistory.filter((x) => x.cadence === "daily").length, weekly: questHistory.filter((x) => x.cadence === "weekly").length, history: questHistory }, questHistory.length > 0, null, goal),
    bodyQuest: section("body_quest", { chart: bqChart, stage: bq.stage, overall: bq.overall, stageChanges }, d.snapshots.length > 0 || bq.statsWithData > 0, bqChart.trend, goal),
    achievements: {
      unlocked: d.achievements
        .map((a) => ({ id: a.id, date: toLocal(a.at) }))
        .filter((a) => a.date >= r.from && a.date <= r.to)
        .map((a) => ({ ...a, title: ACHIEVEMENT_TITLE.get(a.id) ?? a.id })),
    },
    streaks: {
      workout: { current: streaks.workout.current, longest: streaks.workout.longest },
      weekly: { current: streaks.weekly.current, longest: streaks.weekly.longest },
      nutrition: { current: streaks.nutrition.current, longest: streaks.nutrition.longest, available: streaks.nutrition.available },
      quest: { current: streaks.quest.current, longest: streaks.quest.longest },
    },
    summaries: { daily: q.range === 7 ? summarize("day") : null, weekly: q.range >= 30 ? summarize("week") : null, monthly: q.range === 90 ? summarize("month") : null },
    generatedAt: ctx.now().toISOString(),
  };
}

/** Analytics for a range, settled first and served from cache while the user's data is unchanged. */
export function progressAnalytics(ctx: AppContext, userId: string, clock: UserClock, q: AnalyticsQuery, opts: { sync?: boolean } = {}): ProgressAnalytics {
  if (opts.sync !== false) syncRecognition(ctx, userId, clock);
  const key = `${userId}|${q.range}|${q.exerciseId ?? ""}|${clock.today}|${clock.timezone}`;
  const stamp = dataStamp(ctx.db, userId);
  const hit = cache.get(key);
  if (hit && hit.stamp === stamp) {
    analyticsCacheStats.hits++;
    return hit.value;
  }
  analyticsCacheStats.misses++;
  const value = computeAnalytics(ctx, userId, clock, q);
  cache.delete(key);
  cache.set(key, { stamp, value });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return value;
}

/** Trend words and a few numbers for the AI coach (no raw series). */
export function analyticsForCoach(a: ProgressAnalytics) {
  return {
    rangeDays: a.range.days,
    trends: {
      strength: a.strength.data.selected?.chart.trend.direction ?? TREND.INSUFFICIENT_DATA,
      form: a.form.data.chart.trend.direction,
      rom: a.rom.data.chart.trend.direction,
      consistency: a.consistency.data.chart.trend.direction,
      nutrition: a.nutrition.data.kcalChart.trend.direction,
      protein: a.nutrition.data.proteinChart.trend.direction,
      weight: a.weight.available ? a.weight.data.chart.trend.direction : TREND.INSUFFICIENT_DATA,
      xp: a.xp.data.chart.trend.direction,
    },
    strengthExercise: a.strength.data.selected?.name ?? null,
    adherencePercent: a.consistency.data.adherencePercent,
    trainingDays: a.consistency.data.trainingDays,
    nutritionDaysLogged: a.nutrition.data.daysLogged,
    estimatedFoodPercent: a.nutrition.data.estimatedPercent,
    verifiedReps: a.verifiedReps.data.total,
    recordsBeaten: a.prs.data.records.filter((x) => x.beaten).length,
    questsCompleted: a.quests.data.completed,
  };
}


/** An empty chart: a locked section shows what it is, never someone's data or a fake shape. */
function emptyChart(c: ChartModel): ChartModel {
  return { ...c, points: [], target: null, trend: { ...c.trend, direction: TREND.INSUFFICIENT_DATA, movement: null, from: null, to: null, change: null, changePercent: null, points: 0, spanDays: 0 }, state: "no_data" };
}

/** Free users get every section except Pro's form and range-of-motion trends — those are emptied server-side. */
export function lockForTier(a: ProgressAnalytics, e: Pick<Entitlements, "features">): ProgressAnalytics {
  const lock = (feature: PremiumFeatureId) => {
    const f = premiumFeature(feature);
    return { feature, title: f.title, pro: f.pro };
  };
  return {
    ...a,
    form: hasFeature(e, "ADVANCED_FORM_ANALYSIS") ? a.form : { available: false, focus: a.form.focus, interpretation: null, locked: lock("ADVANCED_FORM_ANALYSIS"), data: { chart: emptyChart(a.form.data.chart), averageScore: null, reps: 0 } },
    rom: hasFeature(e, "ADVANCED_ROM_ANALYSIS") ? a.rom : { available: false, focus: a.rom.focus, interpretation: null, locked: lock("ADVANCED_ROM_ANALYSIS"), data: { chart: emptyChart(a.rom.data.chart), averagePercent: null, reps: 0 } },
  };
}
