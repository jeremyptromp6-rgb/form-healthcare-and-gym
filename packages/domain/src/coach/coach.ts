import type { NutritionCoachContext } from "../nutrition/nutritionContext";
import type { PersonalizationProfile } from "../personalization/personalization";
import type { ProviderBase, ProviderResult } from "../providers/result";
import { addDays, dayNumber, weekStart } from "../shared/dates";
import type { Equipment, ExperienceLevel, PrimaryGoal } from "../users/profileOptions";

/**
 * AI Coach — context.
 *
 * CoachContextBuilder is the only way user data reaches a coach provider. It sends the minimum
 * needed to coach well, from authoritative records only: no name, email, exact body measurements,
 * photos, camera frames, food names or raw logs, and never credentials. Everything the coach may
 * state about the user is a *fact* with a stable key (e.g. `training.workoutsLast7Days`); the
 * response validator checks every claim against these facts, so the domain stays the source of truth.
 */

export const COACH_PROVIDER_TYPES = {
  REAL_AI_PROVIDER: "real_ai",
  DETERMINISTIC_FALLBACK: "deterministic_fallback",
  UNAVAILABLE: "unavailable",
} as const;
export type CoachProviderType = (typeof COACH_PROVIDER_TYPES)[keyof typeof COACH_PROVIDER_TYPES];

export const COACH_TOPICS = ["daily_insight", "home", "workout", "form", "nutrition", "consistency", "pr", "body_quest", "progression", "weekly_report", "chat"] as const;
export type CoachTopic = (typeof COACH_TOPICS)[number];

export interface CoachExerciseSummary {
  exerciseId: string;
  name: string;
  sets: number;
  reps: number;
  verifiedReps: number;
  topLoadKg: number;
  /** Server form score over verified reps (null when none were scored). */
  avgFormScore: number | null;
  avgRomPercent: number | null;
}

export interface CoachContextInput {
  now: { localDate: string; localTime: string; weekday: string };
  personalization: PersonalizationProfile;
  /** True once the user has body measurements (so calorie targets exist). */
  hasTargets: boolean;
  /** Workouts from the last 28 days, any order. */
  workouts: { localDate: string; durationMinutes: number; painLevel: "none" | "mild" | "serious"; xp: number; exercises: CoachExerciseSummary[] }[];
  /** Form issues the server detected on verified reps in the last 28 days. */
  formIssues: { exerciseId: string; name: string; code: string; cue: string; count: number }[];
  progression: {
    level: number;
    rank: string;
    totalXp: number;
    xpToNextLevel: number;
    nextRank: { name: string; minLevel: number } | null;
    trainWithinDays: number | null;
    recovering: boolean;
  };
  nutrition?: NutritionCoachContext | null;
  bodyQuest?: {
    stage: string;
    overall: number | null;
    stats: Record<string, number | null>;
    nextStage: string | null;
    unmet: { kind: "overall" | "stats" | "weeks"; needed: number; have: number }[];
  } | null;
  /** Records that beat an earlier one, last 30 days, newest first. */
  records?: { exercise: string; label: string; display: string; previousDisplay: string; localDate: string }[];
  achievements?: { unlocked: string[]; next: { title: string; progress: number; target: number } | null } | null;
  streaks?: { workout: { current: number; longest: number; plannedRestDays: number }; weekly: { current: number; target: number; metThisWeek: boolean }; nutrition: { current: number; available: boolean }; quest: { current: number } } | null;
  quests?: { title: string; cadence: "daily" | "weekly"; progress: number; target: number; completed: boolean }[];
  /** Trends over a recent range from the ProgressAnalyticsService (words and counts only, no raw series). */
  analytics?: {
    rangeDays: number;
    trends: Record<string, string>;
    strengthExercise: string | null;
    adherencePercent: number | null;
    trainingDays: number;
    nutritionDaysLogged: number;
    estimatedFoodPercent: number | null;
    verifiedReps: number;
    recordsBeaten: number;
    questsCompleted: number;
  } | null;
  /** FORM Pro (deeper personalization): the same trends over 90 days. */
  analyticsLong?: CoachContextInput["analytics"];
  /** FORM Pro: the lowest measured Body Quest stat — where effort pays most. */
  bodyQuestFocus?: { stat: string; value: number } | null;
}

export type FactValue = number | string | boolean;

export interface CoachContext {
  version: 2;
  /** Flat, keyed facts. The only things the coach may state about the user. */
  facts: Record<string, FactValue>;
  /** Hard food constraints (allergies, diet restrictions). Recommendations must never violate them. */
  food: { allergens: string[]; customAllergies: string[]; dietRestrictions: string[] };
  equipment: Equipment[];
  /** Exercises the user can do with their equipment (ids), for suggestions and actions. */
  safety: {
    isMinor: boolean;
    noWeightLossTargets: boolean;
    hasTargets: boolean;
    safeFloorKcal: number | null;
    recovering: boolean;
    trainedToday: boolean;
    planMetThisWeek: boolean;
    notes: string[];
  };
  /** For grounding exercise names and parameters. */
  recentExercises: { exerciseId: string; name: string; topLoadKg: number }[];
}

export interface CoachProviderRequest {
  context: CoachContext;
  topic: CoachTopic;
  /** The user's chat message (chat only). */
  message: string | null;
  /** Earlier turns, oldest first (chat only, already validated text). */
  history: { role: "user" | "coach"; text: string }[];
}

/** Model output before validation: untrusted. */
export interface RawCoachOutput {
  message: string;
  category: string;
  priority: string;
  evidence: { fact: string; claim: string }[];
  actions: { id: string; label: string; exerciseId?: string | null; section?: string | null }[];
  confidence: string;
}

export interface AiCoachProvider extends ProviderBase {
  readonly kind: "ai";
  respond(request: CoachProviderRequest, opts?: { signal?: AbortSignal }): Promise<ProviderResult<RawCoachOutput>>;
}

export const BASE_SAFETY_RULES = [
  "Never recommend eating below the user's safe minimum intake, skipping meals, fasting or extreme restriction.",
  "Never suggest dehydrating, cutting water or sweating weight off.",
  "Never encourage training through pain or without rest; recommend rest and a qualified professional for pain.",
  "You are not a doctor: never diagnose. Refer medical questions to a healthcare professional.",
  "Never guess at the user's mood, mental state or character.",
  "Streaks include planned rest. Never suggest skipping rest, training hurt or under-eating to keep a streak or earn an achievement.",
] as const;

const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;
const DAY_PART = (hhmm: string) => {
  const h = Number(hhmm.slice(0, 2));
  return h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};

export function buildCoachContext(input: CoachContextInput): CoachContext {
  const today = input.now.localDate;
  const todayN = dayNumber(today);
  const p = input.personalization;
  const workouts = input.workouts.filter((w) => dayNumber(w.localDate) <= todayN && dayNumber(w.localDate) > todayN - 28).sort((a, b) => (a.localDate < b.localDate ? 1 : -1));
  const inLast = (days: number) => workouts.filter((w) => dayNumber(w.localDate) > todayN - days);
  const days = (ws: typeof workouts) => new Set(ws.map((w) => w.localDate)).size;
  const monday = weekStart(today);
  const doneThisWeek = days(workouts.filter((w) => w.localDate >= monday && w.painLevel !== "serious"));
  const planned = Math.min(6, Math.max(1, p.training.daysPerWeek ?? 3));
  const trainedToday = workouts.some((w) => w.localDate === today);
  const seriousPainRecently = inLast(7).some((w) => w.painLevel === "serious");
  const recovering = input.progression.recovering || seriousPainRecently;
  const last = workouts[0] ?? null;

  const f: Record<string, FactValue> = {
    "now.localDate": today,
    "now.localTime": input.now.localTime,
    "now.weekday": input.now.weekday,
    "now.dayPart": DAY_PART(input.now.localTime),
    "profile.goal": p.goal.primary ?? "unset",
    "profile.experience": (p.training.experience ?? "unknown") as ExperienceLevel | "unknown",
    "profile.trainingDaysPerWeek": planned,
    "profile.equipment": p.training.equipment.join(", ") || "bodyweight",
    "profile.hasNutritionTargets": input.hasTargets,
    "training.workoutsLast7Days": inLast(7).length,
    "training.trainingDaysLast7Days": days(inLast(7)),
    "training.workoutsLast28Days": workouts.length,
    "training.trainedToday": trainedToday,
    "training.doneThisWeek": doneThisWeek,
    "training.plannedThisWeek": planned,
    "training.remainingThisWeek": Math.max(0, planned - doneThisWeek),
    "training.daysLeftThisWeek": dayNumber(addDays(monday, 6)) - todayN + (trainedToday ? 0 : 1),
    "training.seriousPainLast7Days": seriousPainRecently,
  };
  if (last) {
    f["training.lastWorkoutDate"] = last.localDate;
    f["training.daysSinceLastWorkout"] = todayN - dayNumber(last.localDate);
  }
  workouts.slice(0, 3).forEach((w, i) => {
    f[`workouts.${i}.date`] = w.localDate;
    f[`workouts.${i}.durationMinutes`] = w.durationMinutes;
    f[`workouts.${i}.xp`] = w.xp;
    f[`workouts.${i}.pain`] = w.painLevel;
    w.exercises.slice(0, 6).forEach((e, j) => {
      const k = `workouts.${i}.exercises.${j}`;
      f[`${k}.name`] = e.name;
      f[`${k}.sets`] = e.sets;
      f[`${k}.reps`] = e.reps;
      f[`${k}.verifiedReps`] = e.verifiedReps;
      if (e.topLoadKg > 0) f[`${k}.topLoadKg`] = e.topLoadKg;
      if (e.avgFormScore !== null) f[`${k}.formScore`] = e.avgFormScore;
      if (e.avgRomPercent !== null) f[`${k}.romPercent`] = e.avgRomPercent;
    });
  });

  // Form over the last 28 days, from verified reps only.
  const scored = workouts.flatMap((w) => w.exercises).filter((e) => e.verifiedReps > 0);
  const verifiedReps = scored.reduce((a, e) => a + e.verifiedReps, 0);
  f["form.verifiedRepsLast28Days"] = verifiedReps;
  const withForm = scored.filter((e) => e.avgFormScore !== null);
  if (withForm.length) f["form.averageScore"] = round(withForm.reduce((a, e) => a + e.avgFormScore! * e.verifiedReps, 0) / withForm.reduce((a, e) => a + e.verifiedReps, 0));
  const withRom = scored.filter((e) => e.avgRomPercent !== null);
  if (withRom.length) f["form.averageRomPercent"] = round(withRom.reduce((a, e) => a + e.avgRomPercent! * e.verifiedReps, 0) / withRom.reduce((a, e) => a + e.verifiedReps, 0));
  input.formIssues
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .forEach((iss, i) => {
      f[`form.issues.${i}.exercise`] = iss.name;
      f[`form.issues.${i}.exerciseId`] = iss.exerciseId;
      f[`form.issues.${i}.cue`] = iss.cue;
      f[`form.issues.${i}.count`] = iss.count;
    });

  const pr = input.progression;
  Object.assign(f, {
    "progression.level": pr.level,
    "progression.rank": pr.rank,
    "progression.xp": pr.totalXp,
    "progression.xpToNextLevel": pr.xpToNextLevel,
    "progression.nextLevel": pr.level + 1,
    "progression.recovering": recovering,
  });
  if (pr.nextRank) Object.assign(f, { "progression.nextRank": pr.nextRank.name, "progression.nextRankLevel": pr.nextRank.minLevel });
  if (pr.trainWithinDays !== null && pr.totalXp > 0) f["progression.trainWithinDays"] = pr.trainWithinDays;

  const n = input.nutrition ?? null;
  if (n) {
    Object.assign(f, {
      "nutrition.hasTargets": n.hasTargets,
      "nutrition.today.kcal": round(n.today.kcal),
      "nutrition.today.proteinG": round(n.today.proteinG),
      "nutrition.today.entries": n.today.entries,
      "nutrition.today.waterMl": round(n.today.waterMl),
      "nutrition.today.waterTargetMl": round(n.today.waterTargetMl),
      "nutrition.today.estimatedPercent": round(n.today.estimatedShare * 100),
      "nutrition.last7Days.daysLogged": n.last7Days.daysLogged,
      "nutrition.last7Days.daysMeetingProtein": n.last7Days.daysMeetingProtein,
      "nutrition.last7Days.daysBelowSafeFloor": n.last7Days.daysBelowSafeFloor,
    });
    if (n.last7Days.averageProteinG !== null) f["nutrition.last7Days.averageProteinG"] = n.last7Days.averageProteinG;
    if (n.last7Days.averageKcal !== null) f["nutrition.last7Days.averageKcal"] = n.last7Days.averageKcal;
    if (n.targets) {
      Object.assign(f, {
        "nutrition.targets.kcal": n.targets.kcal,
        "nutrition.targets.proteinG": n.targets.proteinG,
        "nutrition.targets.safeMinimumKcal": n.targets.safeFloorKcal,
        "nutrition.today.kcalRemaining": round(n.today.remainingKcal ?? 0),
        "nutrition.today.proteinRemainingG": Math.max(0, round(n.targets.proteinG - n.today.proteinG)),
      });
    }
  }

  const bq = input.bodyQuest ?? null;
  if (bq) {
    const title = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    f["bodyQuest.stage"] = title(bq.stage);
    if (bq.overall !== null) f["bodyQuest.overall"] = bq.overall;
    for (const [k, v] of Object.entries(bq.stats)) if (v !== null) f[`bodyQuest.stats.${k}`] = v;
    f["bodyQuest.statsMeasured"] = Object.values(bq.stats).filter((v) => v !== null).length;
    if (bq.nextStage) f["bodyQuest.nextStage"] = title(bq.nextStage);
    bq.unmet.forEach((u) => {
      f[`bodyQuest.next.${u.kind}.needed`] = u.needed;
      f[`bodyQuest.next.${u.kind}.have`] = u.have;
    });
  }
  (input.records ?? []).slice(0, 3).forEach((r, i) => {
    Object.assign(f, { [`records.${i}.exercise`]: r.exercise, [`records.${i}.label`]: r.label, [`records.${i}.value`]: r.display, [`records.${i}.previous`]: r.previousDisplay, [`records.${i}.date`]: r.localDate });
  });
  f["records.recentCount"] = (input.records ?? []).length;
  const a = input.achievements ?? null;
  if (a) {
    f["achievements.unlocked"] = a.unlocked.length;
    if (a.unlocked[0]) f["achievements.latest"] = a.unlocked[0];
    if (a.next) Object.assign(f, { "achievements.next.title": a.next.title, "achievements.next.progress": a.next.progress, "achievements.next.target": a.next.target, "achievements.next.remaining": a.next.target - a.next.progress });
  }
  const s = input.streaks ?? null;
  if (s) {
    Object.assign(f, {
      "streaks.workout.current": s.workout.current,
      "streaks.workout.longest": s.workout.longest,
      "streaks.workout.plannedRestDays": s.workout.plannedRestDays,
      "streaks.weekly.current": s.weekly.current,
      "streaks.weekly.metThisWeek": s.weekly.metThisWeek,
      "streaks.quest.current": s.quest.current,
    });
    if (s.nutrition.available) f["streaks.nutrition.current"] = s.nutrition.current;
  }
  for (const an of [input.analytics ?? null, input.analyticsLong ?? null]) {
    if (!an) continue;
    const k = `analytics.${an.rangeDays}d`;
    for (const [metric, dir] of Object.entries(an.trends)) f[`${k}.trend.${metric}`] = dir.replace("_", " ");
    if (an.strengthExercise) f[`${k}.strengthExercise`] = an.strengthExercise;
    if (an.adherencePercent !== null) f[`${k}.planAdherencePercent`] = an.adherencePercent;
    if (an.estimatedFoodPercent !== null) f[`${k}.estimatedFoodPercent`] = an.estimatedFoodPercent;
    Object.assign(f, {
      [`${k}.trainingDays`]: an.trainingDays,
      [`${k}.foodDaysLogged`]: an.nutritionDaysLogged,
      [`${k}.verifiedReps`]: an.verifiedReps,
      [`${k}.recordsBeaten`]: an.recordsBeaten,
      [`${k}.questsCompleted`]: an.questsCompleted,
    });
  }
  if (input.bodyQuestFocus) Object.assign(f, { "bodyQuest.focusStat": input.bodyQuestFocus.stat, "bodyQuest.focusValue": input.bodyQuestFocus.value });
  (input.quests ?? []).slice(0, 6).forEach((q, i) => {
    Object.assign(f, { [`quests.${i}.title`]: q.title, [`quests.${i}.cadence`]: q.cadence, [`quests.${i}.progress`]: q.progress, [`quests.${i}.target`]: q.target, [`quests.${i}.completed`]: q.completed });
  });

  const notes: string[] = [...BASE_SAFETY_RULES];
  if (!input.hasTargets) notes.push("No body profile on file: do not give calorie or macro targets.");
  if (p.safety.isMinor) notes.push("User is under 18: give no weight-loss, deficit or calorie-restriction advice.");
  if (recovering) notes.push("User reported serious pain recently: advise rest and professional assessment; do not suggest training.");
  if (trainedToday) notes.push("User already trained today: suggest recovery, food or tomorrow's plan, not another workout.");
  if (doneThisWeek >= planned) notes.push("Weekly plan already met: remaining days this week are planned rest.");
  notes.push(...(n?.safetyNotes ?? []));

  const recent = new Map<string, { exerciseId: string; name: string; topLoadKg: number }>();
  for (const w of workouts) for (const e of w.exercises) if (!recent.has(e.exerciseId)) recent.set(e.exerciseId, { exerciseId: e.exerciseId, name: e.name, topLoadKg: e.topLoadKg });
  // Form issues come from the user's own sessions, so those exercises were done too.
  for (const i of input.formIssues) if (!recent.has(i.exerciseId)) recent.set(i.exerciseId, { exerciseId: i.exerciseId, name: i.name, topLoadKg: 0 });

  return {
    version: 2,
    facts: f,
    food: { allergens: [...p.nutrition.hard.allergens], customAllergies: [...p.nutrition.hard.customAllergies], dietRestrictions: [...p.nutrition.hard.dietRestrictions] },
    equipment: [...p.training.equipment],
    safety: {
      isMinor: p.safety.isMinor,
      noWeightLossTargets: p.safety.noWeightLossTargets,
      hasTargets: input.hasTargets,
      safeFloorKcal: n?.targets?.safeFloorKcal ?? null,
      recovering,
      trainedToday,
      planMetThisWeek: doneThisWeek >= planned,
      notes,
    },
    recentExercises: [...recent.values()],
  };
}

/** Goals in the user's words, for prompts and fallback copy. */
export const GOAL_FOCUS: Record<PrimaryGoal | "unset", string> = {
  lose_fat: "losing fat while keeping strength",
  build_muscle: "building muscle",
  get_stronger: "getting stronger",
  get_lean: "getting lean and keeping muscle",
  improve_fitness: "stamina and all-round fitness",
  improve_health: "overall health",
  unset: "general fitness",
};
