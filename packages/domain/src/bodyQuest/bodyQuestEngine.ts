import { addDays, dayNumber } from "../shared/dates";
import { estimateOneRepMax } from "../records/personalRecords";
import { EXERCISE_BY_ID, type MuscleGroup } from "../workouts/exercises";

/**
 * BodyQuestEngine — long-term progress across six stats, from authoritative training data.
 *
 * Body Quest is about what your body can do and how you train, never about weight or looks: no
 * stat uses body weight, measurements or photos. Every stat is a transparent formula over the
 * server's own records, rated 0–100, and reports "insufficient data" (with what it needs) rather
 * than guessing. Nothing rewards unsafe behaviour: sessions with serious pain are excluded, volume
 * and minutes are capped at sensible weekly amounts, and consistency is measured against the user's
 * own plan (more than planned doesn't score higher).
 *
 * - Strength:    improvement of verified performance (estimated 1RM, or reps for bodyweight
 *                moves) over the user's own first verified result — +50% = 100. No external
 *                "standards", so no one is judged against other bodies.
 * - Muscle:      weekly working sets per muscle group (10 per group per week = full marks, across
 *                legs, chest, back, shoulders, arms, core); protein adequacy adds a fifth when the
 *                user has nutrition targets and has logged enough days.
 * - Endurance:   active training minutes per week against the WHO guideline of 150.
 * - Mobility:    average range of motion of camera-verified reps.
 * - Form:        average server form score of camera-verified reps.
 * - Consistency: planned training days actually trained (recovery after pain is excused).
 */

export const BODY_QUEST_ENGINE_VERSION = 1;

export const BODY_QUEST_STAGES = ["starter", "foundation", "builder", "athlete", "elite"] as const;
export type BodyQuestStage = (typeof BODY_QUEST_STAGES)[number];

export const BODY_QUEST_STATS = ["strength", "muscle", "endurance", "mobility", "form", "consistency"] as const;
export type BodyQuestStat = (typeof BODY_QUEST_STATS)[number];

/** What a stage asks for: an overall score, stats with real data, and weeks of training history. */
export const STAGE_REQUIREMENTS: Record<BodyQuestStage, { overall: number; stats: number; weeks: number }> = {
  starter: { overall: 0, stats: 0, weeks: 0 },
  foundation: { overall: 20, stats: 3, weeks: 2 },
  builder: { overall: 40, stats: 4, weeks: 4 },
  athlete: { overall: 60, stats: 5, weeks: 8 },
  elite: { overall: 80, stats: 6, weeks: 12 },
};

export const BODY_QUEST_RULES = {
  windowDays: 28,
  strength: { lookbackDays: 56, fullImprovement: 0.5, minDaysBetween: 7 },
  muscle: { setsPerGroupPerWeek: 10, proteinShare: 0.2, minProteinDays: 7 },
  endurance: { minutesPerWeek: 150 },
  quality: { minReps: 20 },
  /** Days of history before volume, minutes and consistency are judged. */
  minHistoryDays: 7,
} as const;

const GROUPS: Record<string, readonly MuscleGroup[]> = {
  legs: ["quads", "hamstrings", "glutes", "calves"],
  chest: ["chest"],
  back: ["back", "lats"],
  shoulders: ["shoulders"],
  arms: ["biceps", "triceps"],
  core: ["core"],
};

export interface BodyQuestWorkout {
  localDate: string;
  durationMinutes: number;
  painLevel: string;
  sets: { exerciseId: string; reps: number; verifiedReps: number; loadKg: number }[];
}

export interface BodyQuestInput {
  asOf: string;
  trainingDaysPerWeek: number | null;
  workouts: readonly BodyQuestWorkout[];
  /** Camera-verified reps with their server scores. */
  verifiedReps: readonly { localDate: string; painLevel: string; formScore: number | null; romPercent: number }[];
  /** Logged food days that had a target, and whether protein was hit (only when the user has targets). */
  proteinDays: readonly { localDate: string; hit: boolean }[] | null;
}

export type StatNeed = "verify_same_exercise_twice" | "train_for_a_week" | "verify_more_reps" | "train_more";

export interface StatResult {
  value: number | null;
  status: "ok" | "insufficient_data";
  /** How much data the value rests on (reps, sets, minutes, days, exercises). */
  sample: number;
  /** What would make this stat measurable (insufficient data only). */
  needs: StatNeed | null;
  /** Inputs worth showing ("based on…"). */
  detail: Record<string, number>;
}

export interface BodyQuestResult {
  engineVersion: number;
  asOf: string;
  stage: BodyQuestStage;
  overall: number | null;
  stats: Record<BodyQuestStat, StatResult>;
  statsWithData: number;
  historyWeeks: number;
  next: { stage: BodyQuestStage; requirements: { kind: "overall" | "stats" | "weeks"; needed: number; have: number; met: boolean }[] } | null;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const score = (fraction: number) => Math.round(clamp01(fraction) * 100);
const insufficient = (needs: StatNeed, sample = 0, detail: Record<string, number> = {}): StatResult => ({ value: null, status: "insufficient_data", sample, needs, detail });
const ok = (value: number, sample: number, detail: Record<string, number> = {}): StatResult => ({ value, status: "ok", sample, needs: null, detail });

export function evaluateBodyQuest(input: BodyQuestInput): BodyQuestResult {
  const R = BODY_QUEST_RULES;
  const asOfN = dayNumber(input.asOf);
  const inRange = (d: string, days: number) => {
    const n = dayNumber(d);
    return n <= asOfN && n > asOfN - days;
  };
  // Serious-pain sessions never count toward anything.
  const workouts = input.workouts.filter((w) => w.painLevel !== "serious" && dayNumber(w.localDate) <= asOfN);
  const firstWorkout = workouts.length ? workouts.reduce((a, w) => (w.localDate < a ? w.localDate : a), workouts[0]!.localDate) : null;
  const historyDays = firstWorkout ? asOfN - dayNumber(firstWorkout) + 1 : 0;
  const historyWeeks = Math.floor(historyDays / 7);
  const windowDays = Math.min(R.windowDays, Math.max(historyDays, 1));
  const windowWeeks = Math.max(1, windowDays / 7);
  const recent = workouts.filter((w) => inRange(w.localDate, R.windowDays));
  const enoughHistory = historyDays >= R.minHistoryDays;

  // Strength: own verified progress per exercise.
  const byExercise = new Map<string, { date: string; value: number }[]>();
  for (const w of workouts) {
    for (const s of w.sets) {
      if (s.verifiedReps <= 0) continue;
      const value = s.loadKg > 0 ? estimateOneRepMax(s.loadKg, Math.min(s.verifiedReps, 1000)) ?? s.loadKg : s.verifiedReps;
      byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), { date: w.localDate, value }]);
    }
  }
  const improvements: number[] = [];
  for (const points of byExercise.values()) {
    const first = points.reduce((a, p) => (p.date < a ? p.date : a), points[0]!.date);
    const baseline = Math.max(...points.filter((p) => p.date === first).map((p) => p.value));
    const later = points.filter((p) => dayNumber(p.date) >= dayNumber(first) + R.strength.minDaysBetween && inRange(p.date, R.strength.lookbackDays));
    if (later.length === 0 || baseline <= 0) continue;
    const current = Math.max(...later.map((p) => p.value));
    improvements.push(clamp01((current / baseline - 1) / R.strength.fullImprovement));
  }
  const strength = improvements.length
    ? ok(score(improvements.reduce((a, b) => a + b, 0) / improvements.length), improvements.length, { exercises: improvements.length })
    : insufficient("verify_same_exercise_twice");

  // Muscle: weekly sets per group (capped), plus protein when the user tracks it.
  let muscle: StatResult;
  const recentSets = recent.flatMap((w) => w.sets).filter((s) => s.reps > 0);
  if (!enoughHistory || recent.length < 2) muscle = insufficient(enoughHistory ? "train_more" : "train_for_a_week", recentSets.length);
  else {
    const perGroup = Object.values(GROUPS).map((muscles) => {
      const sets = recentSets.filter((s) => (EXERCISE_BY_ID.get(s.exerciseId)?.primaryMuscles ?? []).some((m) => muscles.includes(m))).length;
      return clamp01(sets / windowWeeks / R.muscle.setsPerGroupPerWeek);
    });
    const volume = perGroup.reduce((a, b) => a + b, 0) / perGroup.length;
    const protein = (input.proteinDays ?? []).filter((d) => inRange(d.localDate, R.windowDays));
    const detail: Record<string, number> = { setsPerWeek: Math.round((recentSets.length / windowWeeks) * 10) / 10 };
    let fraction = volume;
    if (input.proteinDays && protein.length >= R.muscle.minProteinDays) {
      const hitShare = protein.filter((d) => d.hit).length / protein.length;
      fraction = volume * (1 - R.muscle.proteinShare) + hitShare * R.muscle.proteinShare;
      detail.proteinDays = protein.length;
      detail.proteinHitPercent = Math.round(hitShare * 100);
    }
    muscle = ok(score(fraction), recentSets.length, detail);
  }

  // Endurance: weekly active minutes against 150 (more isn't scored higher).
  const minutes = recent.reduce((a, w) => a + Math.min(w.durationMinutes, 240), 0);
  const endurance = !enoughHistory || recent.length < 2
    ? insufficient(enoughHistory ? "train_more" : "train_for_a_week", minutes)
    : ok(score(minutes / windowWeeks / R.endurance.minutesPerWeek), minutes, { minutesPerWeek: Math.round(minutes / windowWeeks) });

  // Mobility and form: verified reps in the window.
  const reps = input.verifiedReps.filter((r) => r.painLevel !== "serious" && inRange(r.localDate, R.windowDays));
  const romReps = reps.filter((r) => Number.isFinite(r.romPercent));
  const mobility = romReps.length >= R.quality.minReps
    ? ok(Math.round(romReps.reduce((a, r) => a + Math.min(100, Math.max(0, r.romPercent)), 0) / romReps.length), romReps.length, { reps: romReps.length })
    : insufficient("verify_more_reps", romReps.length, { reps: romReps.length });
  const scored = reps.filter((r) => r.formScore !== null);
  const form = scored.length >= R.quality.minReps
    ? ok(Math.round(scored.reduce((a, r) => a + Math.min(100, Math.max(0, r.formScore!)), 0) / scored.length), scored.length, { reps: scored.length })
    : insufficient("verify_more_reps", scored.length, { reps: scored.length });

  // Consistency: planned days trained over the window (recovery after pain excused).
  let consistency: StatResult;
  if (!enoughHistory) consistency = insufficient("train_for_a_week");
  else {
    const perWeek = Math.min(6, Math.max(1, input.trainingDaysPerWeek ?? 3));
    const painDays = new Set(input.workouts.filter((w) => w.painLevel === "serious").flatMap((w) => [0, 1, 2, 3].map((i) => addDays(w.localDate, i))));
    const trainedDays = new Set(recent.map((w) => w.localDate));
    // The day being evaluated may still be in progress: untrained, it is pending, not missed.
    let excused = trainedDays.has(input.asOf) ? 0 : 1;
    for (let i = 1; i < windowDays; i++) {
      const d = addDays(input.asOf, -i);
      if (painDays.has(d) && !trainedDays.has(d)) excused++;
    }
    const expected = (perWeek * Math.max(0, windowDays - excused)) / 7;
    consistency = expected <= 0 ? ok(100, trainedDays.size, { trainedDays: trainedDays.size, plannedDays: 0 }) : ok(score(trainedDays.size / expected), trainedDays.size, { trainedDays: trainedDays.size, plannedDays: Math.round(expected) });
  }

  const stats: Record<BodyQuestStat, StatResult> = { strength, muscle, endurance, mobility, form, consistency };
  const values = BODY_QUEST_STATS.map((k) => stats[k].value).filter((v): v is number => v !== null);
  const overall = values.length >= STAGE_REQUIREMENTS.foundation.stats ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const meets = (s: BodyQuestStage) => {
    const req = STAGE_REQUIREMENTS[s];
    return (overall ?? 0) >= req.overall && values.length >= req.stats && historyWeeks >= req.weeks;
  };
  let stage: BodyQuestStage = "starter";
  for (const s of BODY_QUEST_STAGES) if (meets(s)) stage = s;
  const nextStage = BODY_QUEST_STAGES[BODY_QUEST_STAGES.indexOf(stage) + 1] ?? null;
  const next = nextStage
    ? {
        stage: nextStage,
        requirements: [
          { kind: "overall" as const, needed: STAGE_REQUIREMENTS[nextStage].overall, have: overall ?? 0 },
          { kind: "stats" as const, needed: STAGE_REQUIREMENTS[nextStage].stats, have: values.length },
          { kind: "weeks" as const, needed: STAGE_REQUIREMENTS[nextStage].weeks, have: historyWeeks },
        ].map((r) => ({ ...r, met: r.have >= r.needed })),
      }
    : null;

  return { engineVersion: BODY_QUEST_ENGINE_VERSION, asOf: input.asOf, stage, overall, stats, statsWithData: values.length, historyWeeks, next };
}

export function stageIndex(stage: BodyQuestStage): number {
  return BODY_QUEST_STAGES.indexOf(stage);
}
