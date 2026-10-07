import { randomUUID } from "node:crypto";
import {
  adaptiveGenerator,
  addDays,
  daysBetween,
  goalOn,
  ruleBasedGenerator,
  type AdaptiveInput,
  type ExercisePerformance,
  type ExerciseSession,
  type GenerationInput,
  type WorkoutGenerator,
  type WorkoutPlan,
} from "@form/domain";
import type { Db } from "../../db";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { loadGoalHistory, loadProfile } from "../users/repo";
import { can } from "../billing/entitlements";

/** Free: the rule-based generator. */
export const activeGenerator: WorkoutGenerator = ruleBasedGenerator;

/**
 * Up to the last 4 sessions per exercise (newest first) with reps, load and the camera-verified
 * form and range of motion — what adaptive training decides from. Serious-pain sessions included
 * (the generator's safety rules read them).
 */
export function exerciseHistory(db: Db, userId: string, before: string): Record<string, ExerciseSession[]> {
  const rows = db
    .prepare(
      `SELECT ws.exercise_id AS exerciseId, w.id AS workoutId, w.local_date AS localDate, w.pain_level AS painLevel, ws.reps, ws.load_kg AS loadKg,
              ws.verified_reps AS verifiedReps, ws.form_score AS formScore, ws.rom_percent AS rom
       FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id
       WHERE w.user_id = ? AND w.local_date < ?
       ORDER BY w.local_date DESC, w.created_at DESC, ws.set_index ASC
       LIMIT 4000`,
    )
    .all(userId, before) as { exerciseId: string; workoutId: string; localDate: string; painLevel: ExerciseSession["painLevel"]; reps: number; loadKg: number; verifiedReps: number; formScore: number | null; rom: number | null }[];
  const acc = new Map<string, Map<string, { s: ExerciseSession; formW: number; formN: number; romW: number; romN: number }>>();
  for (const r of rows) {
    const perEx = acc.get(r.exerciseId) ?? new Map();
    acc.set(r.exerciseId, perEx);
    if (!perEx.has(r.workoutId)) {
      if (perEx.size >= 4) continue;
      perEx.set(r.workoutId, { s: { localDate: r.localDate, painLevel: r.painLevel, sets: [], formScore: null, romPercent: null, verifiedReps: 0 }, formW: 0, formN: 0, romW: 0, romN: 0 });
    }
    const e = perEx.get(r.workoutId)!;
    e.s.sets.push({ reps: r.reps, loadKg: r.loadKg });
    e.s.verifiedReps += r.verifiedReps;
    if (r.formScore !== null && r.verifiedReps > 0) (e.formW += r.formScore * r.verifiedReps), (e.formN += r.verifiedReps);
    if (r.rom !== null && r.verifiedReps > 0) (e.romW += r.rom * r.verifiedReps), (e.romN += r.verifiedReps);
  }
  const out: Record<string, ExerciseSession[]> = {};
  for (const [ex, perEx] of acc) {
    out[ex] = [...perEx.values()].map((e) => ({ ...e.s, formScore: e.formN ? Math.round(e.formW / e.formN) : null, romPercent: e.romN ? Math.round(e.romW / e.romN) : null }));
  }
  return out;
}

export function adaptiveInput(ctx: AppContext, userId: string, clock: UserClock): AdaptiveInput {
  const base = generationInput(ctx, userId, clock);
  const done = ctx.db.prepare("SELECT COUNT(DISTINCT local_date) AS n FROM workouts WHERE user_id = ? AND local_date >= ? AND local_date < ?").get(userId, addDays(clock.today, -14), clock.today) as { n: number };
  const first = ctx.db.prepare("SELECT MIN(local_date) AS d FROM workouts WHERE user_id = ?").get(userId) as { d: string | null };
  // Only judge consistency over days since the user started.
  const span = first.d ? Math.min(14, Math.max(0, daysBetween(first.d, clock.today))) : 0;
  const plannedDays = Math.round(((base.trainingDaysPerWeek ?? 3) * span) / 7);
  return { ...base, history: exerciseHistory(ctx.db, userId, clock.today), consistency: { plannedDays, completedDays: done.n } };
}

/** The generator this user's plan comes from: adaptive for FORM Pro, rule-based otherwise. */
function generateFor(ctx: AppContext, userId: string, clock: UserClock): WorkoutPlan {
  return can(ctx, userId, "ADAPTIVE_TRAINING") ? adaptiveGenerator.generate(adaptiveInput(ctx, userId, clock)) : activeGenerator.generate(generationInput(ctx, userId, clock));
}

/**
 * Most recent performance of each exercise from completed workouts. `excludeWorkoutId` leaves one
 * workout out, so a just-finished workout isn't shown as its own "previous".
 */
export function previousPerformance(db: Db, userId: string, opts: { excludeWorkoutId?: string } = {}): Record<string, ExercisePerformance & { workoutId: string }> {
  const rows = db
    .prepare(
      `SELECT ws.exercise_id AS exerciseId, w.id AS workoutId, w.local_date AS localDate, w.pain_level AS painLevel,
              ws.reps, ws.load_kg AS loadKg, ws.rom_percent AS rom
       FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id
       WHERE w.user_id = ? AND w.id != ?
       ORDER BY w.local_date DESC, w.created_at DESC, ws.set_index ASC
       LIMIT 3000`,
    )
    .all(userId, opts.excludeWorkoutId ?? "") as {
    exerciseId: string;
    workoutId: string;
    localDate: string;
    painLevel: ExercisePerformance["painLevel"];
    reps: number;
    loadKg: number;
    rom: number | null;
  }[];

  const out: Record<string, ExercisePerformance & { workoutId: string }> = {};
  const roms: Record<string, number[]> = {};
  for (const r of rows) {
    const current = out[r.exerciseId];
    if (current && current.workoutId !== r.workoutId) continue; // only the latest workout per exercise
    if (!current) out[r.exerciseId] = { workoutId: r.workoutId, localDate: r.localDate, painLevel: r.painLevel, sets: [], averageRomPercent: null };
    out[r.exerciseId]!.sets.push({ reps: r.reps, loadKg: r.loadKg });
    if (r.rom !== null) (roms[r.exerciseId] ??= []).push(r.rom);
  }
  for (const [id, list] of Object.entries(roms)) out[id]!.averageRomPercent = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  return out;
}

export function generationInput(ctx: AppContext, userId: string, clock: UserClock): GenerationInput {
  const { db } = ctx;
  const profile = loadProfile(db, userId);
  const recent = db
    .prepare("SELECT local_date AS d, pain_level AS pain FROM workouts WHERE user_id = ? AND local_date < ? ORDER BY local_date DESC LIMIT 60")
    .all(userId, clock.today) as { d: string; pain: string }[];
  const last = recent[0]?.d ?? null;
  return {
    date: clock.today,
    goal: goalOn(loadGoalHistory(db, userId), clock.today) ?? profile?.primaryGoal ?? null,
    experience: profile?.experience ?? null,
    equipment: profile?.equipment ?? ["bodyweight"],
    trainingDaysPerWeek: profile?.trainingDaysPerWeek ?? null,
    // Sessions before today, so the plan stays the same all day.
    sessionsThisWeek: new Set(recent.filter((r) => r.d >= clock.weekStart).map((r) => r.d)).size,
    daysSinceLastWorkout: last ? daysBetween(last, clock.today) : null,
    recentSeriousPain: recent.some((r) => r.pain === "serious" && r.d >= addDays(clock.today, -2)),
    previous: previousPerformance(db, userId),
  };
}

export interface StoredPlan {
  id: string;
  plan: WorkoutPlan;
  createdAt: string;
}

/** Today's plan: generated on first request of the day and kept stable; `regenerate` replaces it (e.g. after a kit change). */
export function todayPlan(ctx: AppContext, userId: string, clock: UserClock, opts: { regenerate?: boolean } = {}): StoredPlan {
  const { db } = ctx;
  const existing = db.prepare("SELECT id, plan, created_at FROM workout_plans WHERE user_id = ? AND local_date = ?").get(userId, clock.today) as
    | { id: string; plan: string; created_at: string }
    | undefined;
  const wanted = can(ctx, userId, "ADAPTIVE_TRAINING") ? adaptiveGenerator.id : activeGenerator.id;
  // A plan made before an upgrade (or after Pro ended) is rebuilt with the right generator — unless today's workout has begun.
  const started = !!db.prepare("SELECT 1 FROM workout_sessions WHERE user_id = ? AND local_date = ?").get(userId, clock.today);
  if (existing && !opts.regenerate && (JSON.parse(existing.plan).generator?.id === wanted || started)) return { id: existing.id, plan: JSON.parse(existing.plan), createdAt: existing.created_at };

  const plan = generateFor(ctx, userId, clock);
  const id = existing?.id ?? randomUUID();
  const now = ctx.now().toISOString();
  db.prepare(
    `INSERT INTO workout_plans (id, user_id, local_date, generator_id, generator_version, plan, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, local_date) DO UPDATE SET generator_id = excluded.generator_id, generator_version = excluded.generator_version,
       plan = excluded.plan, created_at = excluded.created_at`,
  ).run(id, userId, clock.today, plan.generator.id, plan.generator.version, JSON.stringify(plan), now);
  return { id, plan, createdAt: now };
}
