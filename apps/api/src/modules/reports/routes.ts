import { addDays, buildWeeklyReport, EXERCISE_BY_ID, formatRecordValue, GLOBAL_RECORD, PR_METRICS, progressFromXp, rankForLevel, type PrKind, type WeekTraining } from "@form/domain";
import type { FastifyInstance } from "fastify";
import type { Db } from "../../db";
import type { AppContext } from "../../shared/context";
import { userClock, type UserClock } from "../../shared/userClock";
import { can, requireFeature } from "../billing/entitlements";
import { coachInsight } from "../coach/service";
import { targetOn } from "../nutrition/targets";
import { activeXp } from "../progression/service";
import { bodyQuestView } from "../recognition/service";
import { loadProfile } from "../users/repo";

/** Same thresholds as Progress, so the report and the charts agree. */
const PROTEIN_MET = 0.9;
const ON_TARGET = 0.1;

function training(db: Db, userId: string, from: string, to: string, plannedDays: number | null): WeekTraining {
  const w = db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT local_date) AS d, COALESCE(SUM(duration_minutes), 0) AS m FROM workouts WHERE user_id = ? AND local_date BETWEEN ? AND ?").get(userId, from, to) as { n: number; d: number; m: number };
  const s = db
    .prepare(
      `SELECT COALESCE(SUM(ws.verified_reps), 0) AS v,
              SUM(CASE WHEN ws.form_score IS NOT NULL AND ws.verified_reps > 0 THEN ws.form_score * ws.verified_reps END) AS fw,
              SUM(CASE WHEN ws.form_score IS NOT NULL AND ws.verified_reps > 0 THEN ws.verified_reps END) AS fn,
              SUM(CASE WHEN ws.rom_percent IS NOT NULL AND ws.verified_reps > 0 THEN ws.rom_percent * ws.verified_reps END) AS rw,
              SUM(CASE WHEN ws.rom_percent IS NOT NULL AND ws.verified_reps > 0 THEN ws.verified_reps END) AS rn
       FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ?`,
    )
    .get(userId, from, to) as { v: number; fw: number | null; fn: number | null; rw: number | null; rn: number | null };
  return {
    workouts: w.n,
    trainingDays: w.d,
    plannedDays,
    minutes: w.m,
    verifiedReps: s.v,
    averageFormScore: s.fn ? Math.round(s.fw! / s.fn) : null,
    averageRomPercent: s.rn ? Math.round(s.rw! / s.rn) : null,
  };
}

/** Builds (once) the report for the last finished week; stored so it stays the user's even after Pro ends. */
export async function weeklyReport(ctx: AppContext, userId: string, clock: UserClock) {
  const { db } = ctx;
  const weekStart = addDays(clock.weekStart, -7);
  const weekEnd = addDays(clock.weekStart, -1);
  const stored = db.prepare("SELECT report, coach, generated_at AS generatedAt FROM weekly_reports WHERE user_id = ? AND week_start = ?").get(userId, weekStart) as { report: string; coach: string | null; generatedAt: string } | undefined;
  if (stored) return { weekStart, report: JSON.parse(stored.report), coach: stored.coach ? JSON.parse(stored.coach) : null, generatedAt: stored.generatedAt };

  const planned = loadProfile(db, userId)?.trainingDaysPerWeek ?? null;
  const records = (db.prepare("SELECT exercise_id AS e, kind, value FROM personal_records WHERE user_id = ? AND status = 'awarded' AND previous IS NOT NULL AND local_date BETWEEN ? AND ? ORDER BY id").all(userId, weekStart, weekEnd) as { e: string; kind: PrKind; value: number }[])
    .filter((r) => PR_METRICS[r.kind])
    .map((r) => ({ exercise: r.e === GLOBAL_RECORD ? "All training" : (EXERCISE_BY_ID.get(r.e)?.name ?? r.e), label: PR_METRICS[r.kind].label, display: formatRecordValue(r.kind, r.value) }));
  const days = db.prepare("SELECT local_date AS d, SUM(kcal) AS kcal, SUM(protein_g) AS p FROM food_logs WHERE user_id = ? AND local_date BETWEEN ? AND ? GROUP BY local_date").all(userId, weekStart, weekEnd) as { d: string; kcal: number; p: number }[];
  let hasTargets = false;
  let proteinDaysMet = 0;
  let daysOnTarget = 0;
  let daysBelowSafeMinimum = 0;
  for (const day of days) {
    const t = targetOn(db, userId, day.d);
    if (!t) continue;
    hasTargets = true;
    if (day.p >= t.proteinG * PROTEIN_MET) proteinDaysMet++;
    if (Math.abs(day.kcal - t.targetKcal) <= t.targetKcal * ON_TARGET) daysOnTarget++;
    if (day.kcal < t.safeFloorKcal) daysBelowSafeMinimum++;
  }
  const earned = (db.prepare("SELECT COALESCE(SUM(xp), 0) AS n FROM xp_events WHERE user_id = ? AND local_date BETWEEN ? AND ?").get(userId, weekStart, weekEnd) as { n: number }).n;
  const level = progressFromXp(activeXp(db, userId, weekEnd)).level;
  const bq = bodyQuestView(db, userId, clock.today, ctx.now());
  const snap = (ws: string) => bq.snapshots.find((s) => s.weekStart === ws) ?? null;
  const end = snap(weekStart);
  const start = snap(addDays(weekStart, -7));

  const report = buildWeeklyReport({
    weekStart,
    weekEnd,
    training: training(db, userId, weekStart, weekEnd, planned),
    previousTraining: training(db, userId, addDays(weekStart, -7), addDays(weekStart, -1), planned),
    recordsBeaten: records,
    nutrition: { daysLogged: days.length, hasTargets, proteinDaysMet, daysOnTarget, daysBelowSafeMinimum },
    xp: { earned, levelAtEnd: level, rankAtEnd: rankForLevel(level) },
    bodyQuest: end || start ? { stageAtStart: start?.stage ?? null, stageAtEnd: end?.stage ?? null, overallAtStart: start?.overall ?? null, overallAtEnd: end?.overall ?? null } : null,
  });
  // The coach note goes through the same validated, labelled coach (AI with consent, otherwise rules); none if coaching is off.
  // The coach reads the last 7 days, so it only speaks for the report's week when the report is made right after that
  // week ends; later than that, the note is left out rather than mixing in another week.
  let coach = null;
  if (clock.today <= addDays(weekEnd, 2)) {
    try {
      coach = await coachInsight(ctx, userId, clock, "weekly_report");
    } catch {
      coach = null;
    }
  }
  const generatedAt = ctx.now().toISOString();
  db.prepare("INSERT OR IGNORE INTO weekly_reports (user_id, week_start, report, coach, generated_at) VALUES (?, ?, ?, ?, ?)").run(userId, weekStart, JSON.stringify(report), coach ? JSON.stringify(coach) : null, generatedAt);
  return { weekStart, report, coach, generatedAt };
}

export function reportRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Reports already generated stay viewable on any plan; a new one needs FORM Pro. */
  app.get("/reports/weekly", async (req) => {
    const pro = can(ctx, req.user.sub, "WEEKLY_AI_REPORT");
    if (pro) await weeklyReport(ctx, req.user.sub, userClock(ctx, req.user.sub));
    const rows = ctx.db.prepare("SELECT week_start AS weekStart, report, coach, generated_at AS generatedAt FROM weekly_reports WHERE user_id = ? ORDER BY week_start DESC LIMIT 52").all(req.user.sub) as { weekStart: string; report: string; coach: string | null; generatedAt: string }[];
    return { canGenerate: pro, reports: rows.map((r) => ({ weekStart: r.weekStart, generatedAt: r.generatedAt, report: JSON.parse(r.report), coach: r.coach ? JSON.parse(r.coach) : null })) };
  });

  app.post("/reports/weekly", async (req) => {
    requireFeature(ctx, req.user.sub, "WEEKLY_AI_REPORT", "Weekly progress reports are part of FORM Pro.");
    return weeklyReport(ctx, req.user.sub, userClock(ctx, req.user.sub));
  });
}
