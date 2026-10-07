import { EXERCISES, featureAvailability, providerStatuses, suggestToday, type PrimaryGoal } from "@form/domain";
import { foodDaySummary } from "../nutrition/service";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { coachMode } from "../coach/service";
import { computeUserProgress } from "../progression/service";
import { daysSince, lastActivityDate, syncQuests } from "../quests/service";
import { recognitionSummary, syncDerived } from "../recognition/service";
import { loadProfile } from "../users/repo";
import { waterDay } from "../water/routes";

/**
 * Home view model — one aggregation answering "what should I do today?". Everything comes
 * from real, authoritative data for the user's local day. Each section is computed
 * independently: if one fails, it is reported in `errors` and the rest of Home still works.
 */

export type HomeSection = "progression" | "today" | "nutrition" | "water" | "quests" | "activity" | "recognition";

const RETURNING_AFTER_DAYS = 3;
const NAME = new Map(EXERCISES.map((e) => [e.id, e.name]));

function greetingPeriod(hour: number): "morning" | "afternoon" | "evening" | "night" {
  return hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

function lastWorkout(ctx: AppContext, userId: string, today: string) {
  const w = ctx.db
    .prepare(
      `SELECT w.id, w.local_date AS localDate, w.duration_minutes AS durationMinutes, w.pain_level AS painLevel, (SELECT COALESCE(SUM(e.xp), 0) FROM xp_events e WHERE e.user_id = w.user_id AND e.source = 'workout' AND e.source_key = w.id) AS xp
       FROM workouts w
       WHERE w.user_id = ? AND w.local_date <= ? ORDER BY w.local_date DESC, w.created_at DESC LIMIT 1`,
    )
    .get(userId, today) as { id: string; localDate: string; durationMinutes: number; painLevel: string; xp: number } | undefined;
  if (!w) return null;
  const sets = ctx.db
    .prepare("SELECT exercise_id AS exerciseId, reps, verified_reps AS verifiedReps, load_kg AS loadKg FROM workout_sets WHERE workout_id = ? ORDER BY set_index")
    .all(w.id) as { exerciseId: string; reps: number; verifiedReps: number; loadKg: number }[];
  const byExercise = new Map<string, { exerciseId: string; name: string; sets: number; totalReps: number; verifiedReps: number; bestLoadKg: number }>();
  for (const s of sets) {
    const e = byExercise.get(s.exerciseId) ?? { exerciseId: s.exerciseId, name: NAME.get(s.exerciseId) ?? s.exerciseId, sets: 0, totalReps: 0, verifiedReps: 0, bestLoadKg: 0 };
    e.sets++;
    e.totalReps += s.reps;
    e.verifiedReps += s.verifiedReps;
    e.bestLoadKg = Math.max(e.bestLoadKg, s.loadKg);
    byExercise.set(s.exerciseId, e);
  }
  return { ...w, exercises: [...byExercise.values()] };
}

export function buildHome(ctx: AppContext, userId: string, clock: UserClock) {
  const errors: HomeSection[] = [];
  const section = <T>(name: HomeSection, fn: () => T): T | null => {
    try {
      return fn();
    } catch (err) {
      ctx.log.error({ section: name, err }, "home section failed");
      errors.push(name);
      return null;
    }
  };

  const { db } = ctx;
  const profile = loadProfile(db, userId);
  const email = (db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email: string }).email;
  const features = featureAvailability(providerStatuses(ctx.providers));
  const today = clock.today;

  // Quests first: completing one writes quest XP, which the progression summary must include.
  const quests = section("quests", () => syncQuests(ctx, userId, clock));
  // Then achievements (their XP), streaks and Body Quest, before the progression summary reads XP.
  const recognition = section("recognition", () => {
    syncDerived(db, userId, today, ctx.now());
    return recognitionSummary(db, userId, today, ctx.now());
  });

  const progression = section("progression", () => {
    const p = computeUserProgress(db, userId, today, ctx.now());
    const next = p.rankLadder.find((r) => r.minLevel > p.level) ?? null;
    return {
      level: p.level,
      rank: p.rank,
      totalXp: p.totalXp,
      xpIntoLevel: p.xpIntoLevel,
      xpForNextLevel: p.xpForNextLevel,
      fractionToNext: p.fractionToNext,
      provisionalXp: p.provisionalXp,
      nextRank: next ? { name: next.name, minLevel: next.minLevel } : null,
      streak: p.streak,
      /** Days (counting today) within which a workout keeps active progress; null before the first workout. */
      trainWithinDays: p.consistency.trainWithinDays,
      lastResetDate: p.lastReset?.date ?? null,
    };
  });

  const todayPlan = section("today", () => {
    const recent = db.prepare("SELECT local_date AS d, pain_level AS pain FROM workouts WHERE user_id = ? AND local_date >= date(?, '-14 days') AND local_date <= ?").all(
      userId,
      today,
      today,
    ) as { d: string; pain: string }[];
    const workoutDates = recent.map((r) => r.d);
    const suggestion = suggestToday({
      today,
      weekStart: clock.weekStart,
      plannedDaysPerWeek: profile?.trainingDaysPerWeek ?? null,
      workoutDates,
      seriousPainDates: recent.filter((r) => r.pain === "serious").map((r) => r.d),
    });
    return {
      suggestion,
      plannedDaysPerWeek: profile?.trainingDaysPerWeek ?? null,
      workoutsThisWeek: new Set(workoutDates.filter((d) => d >= clock.weekStart)).size,
      trainedToday: workoutDates.includes(today),
      lastWorkout: lastWorkout(ctx, userId, today),
    };
  });

  // Same summary code as the Eat tab, so Home and Eat can never disagree.
  const nutrition = section("nutrition", () => {
    const day = foodDaySummary(ctx, userId, today);
    const t = day.target;
    return {
      kcal: day.totals.kcal,
      proteinG: day.totals.proteinG,
      carbsG: day.totals.carbsG,
      fatG: day.totals.fatG,
      mealsLogged: day.totals.entries,
      mealsWithFood: Object.values(day.byMeal).filter((m) => m.entries > 0).length,
      remainingKcal: day.progress?.kcal.remaining ?? null,
      estimatedKcalShare: day.totals.estimatedKcalShare,
      measuredKcalShare: day.totals.measuredKcalShare,
      targets: t ? { kcal: t.targetKcal, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, safeFloorKcal: t.safeFloorKcal } : null,
    };
  });

  const water = section("water", () => {
    const d = waterDay(ctx, userId, today);
    return { totalMl: d.totalMl, targetMl: d.targetMl, targetBasis: d.targetBasis, lastEntryId: d.entries.at(-1)?.id ?? null, entries: d.entries.length };
  });

  const activity = section("activity", () => {
    const last = lastActivityDate(db, userId, today);
    const gap = daysSince(last, today);
    const state: "new" | "returning" | "active" = last === null ? "new" : gap !== null && gap >= RETURNING_AFTER_DAYS ? "returning" : "active";
    const ever = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM workouts WHERE user_id = ?) AS workouts, (SELECT COUNT(*) FROM food_logs WHERE user_id = ?) AS meals,
                (SELECT COUNT(*) FROM water_logs WHERE user_id = ?) AS water`,
      )
      .get(userId, userId, userId) as { workouts: number; meals: number; water: number };
    const steps = [
      { key: "workout" as const, done: ever.workouts > 0 },
      { key: "meal" as const, done: ever.meals > 0 },
      { key: "water" as const, done: ever.water > 0 },
    ];
    return { state, gap, firstSteps: steps.every((s) => s.done) ? null : steps };
  });

  return {
    generatedAt: ctx.now().toISOString(),
    date: today,
    timezone: clock.timezone,
    timezoneSource: clock.source,
    greeting: { period: greetingPeriod(clock.hour), name: profile?.displayName ?? email.split("@")[0]!, primaryGoal: (profile?.primaryGoal ?? null) as PrimaryGoal | null },
    // If activity history can't be read, treat the user as active rather than showing a misleading welcome.
    state: activity?.state ?? "active",
    daysSinceLastActivity: activity?.gap ?? null,
    firstSteps: activity?.firstSteps ?? null,
    progression,
    today: todayPlan,
    nutrition,
    water,
    quests: quests ? { available: true, ...quests } : null,
    bodyQuest: recognition && features.body_quest.available ? { available: true as const, ...recognition.bodyQuest } : { available: false as const },
    achievements: recognition && features.achievements.available ? { available: true as const, ...recognition.achievements } : { available: false as const, recent: [] as { id: string; title: string; unlockedAt: string }[] },
    streaks: recognition?.streaks ?? null,
    // Which coach answers, honestly: real AI, labelled rules, or none.
    coach: (() => {
      const m = coachMode(ctx, userId);
      return { mode: m.type, provider: m.provider };
    })(),
    errors,
  };
}
