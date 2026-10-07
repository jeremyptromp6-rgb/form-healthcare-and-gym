import { EXERCISE_BY_ID } from "./exercises";
import { loadableWith, ruleBasedGenerator, type GenerationInput, type PlannedExercise, type WorkoutGenerator, type WorkoutPlan } from "./generator";

/**
 * Adaptive training (FORM Pro) — "progress when earned".
 *
 * Starts from the rule-based plan (its safety rules — deload after pain, ease back after a break,
 * hold for range of motion — always stand), then looks further back than one session, at the
 * user's own recorded reps, load, camera-verified form and range of motion, and recent consistency:
 *
 * - progress only when reps hit the top of the range AND form and ROM (when measured) are strong;
 * - reps or load went up but form fell → hold the load and clean it up, don't stack more weight;
 * - two sessions short of the range at the same load → a small step back to rebuild;
 * - training less often than planned → one set fewer, loads kept, so the plan fits real life.
 *
 * Every adaptation explains itself with the numbers it used. Without camera data it says so and
 * falls back to performance alone — it never invents a form score.
 */

export interface ExerciseSession {
  localDate: string;
  painLevel: "none" | "mild" | "serious";
  sets: { reps: number; loadKg: number }[];
  /** Rep-weighted mean form score of camera-verified reps; null when none were verified. */
  formScore: number | null;
  /** Mean range of motion of verified reps; null when none were verified. */
  romPercent: number | null;
  verifiedReps: number;
}

export interface AdaptiveInput extends GenerationInput {
  /** Up to the last 4 sessions per exercise, newest first. */
  history: Record<string, ExerciseSession[]>;
  /** Planned vs completed training days over the last 14 days. */
  consistency: { plannedDays: number; completedDays: number };
}

export const ADAPTIVE_RULES = {
  /** Form at or above this (with ROM) earns progression. */
  progressFormScore: 80,
  /** "Strong" form, named in the explanation. */
  strongFormScore: 85,
  progressRomPercent: 90,
  /** A form drop this large while performance rose means the extra came at form's expense. */
  formDropPoints: 8,
  /** Below this share of planned sessions over 14 days, volume comes down a set. */
  lowConsistencyShare: 0.5,
  stallDeloadFactor: 0.9,
} as const;

const topLoad = (s: ExerciseSession) => Math.max(0, ...s.sets.map((x) => x.loadKg));
const totalReps = (s: ExerciseSession) => s.sets.reduce((a, x) => a + x.reps, 0);
const kg = (n: number) => `${Math.round(n * 10) / 10} kg`;

function stepDown(value: number, step: number): number {
  return step > 0 ? Math.max(step, Math.floor((value * ADAPTIVE_RULES.stallDeloadFactor) / step + 1e-9) * step) : value;
}

function adapt(e: PlannedExercise, input: AdaptiveInput): PlannedExercise {
  const h = input.history[e.exerciseId] ?? [];
  const latest = h[0];
  // Safety decisions from the base plan always stand; brand-new exercises have nothing to adapt.
  if (!latest || e.progression === "deload" || e.progression === "new") return e;
  const prior = h[1];
  const exercise = EXERCISE_BY_ID.get(e.exerciseId);
  const loadable = exercise ? loadableWith(exercise, input.equipment) : false;
  const last = topLoad(latest);
  const hold = (note: string, progression: PlannedExercise["progression"] = "hold_for_form"): PlannedExercise => ({
    ...e,
    progression,
    targetLoadKg: loadable && last > 0 ? last : null,
    targetReps: e.progression === "increase_reps" ? { min: e.targetReps.min - 2, max: e.targetReps.max - 2 } : e.targetReps,
    note,
  });

  // Performance rose but form fell: the extra came at form's expense.
  if (prior && latest.formScore !== null && prior.formScore !== null && latest.formScore <= prior.formScore - ADAPTIVE_RULES.formDropPoints) {
    const up = topLoad(latest) > topLoad(prior) ? `load went up to ${kg(last)}` : totalReps(latest) > totalReps(prior) ? `reps went up to ${totalReps(latest)}` : null;
    if (up) return hold(`Your ${up}, but form dropped from ${prior.formScore} to ${latest.formScore}. Repeat this and make every rep clean before adding more.`);
  }

  // Stalled: two sessions in a row short of the range at the same load.
  if (prior && loadable && last > 0 && topLoad(prior) === last) {
    const short = (s: ExerciseSession) => s.sets.some((x) => x.reps < e.targetReps.min);
    if (short(latest) && short(prior) && exercise) {
      return { ...e, progression: "deload", targetLoadKg: stepDown(last, exercise.loadIncrementKg), note: `Two sessions short of ${e.targetReps.min} reps at ${kg(last)} — a little lighter to rebuild, then climb again.` };
    }
  }

  if (e.progression === "increase_load" || e.progression === "increase_reps") {
    if (latest.formScore === null) {
      return { ...e, note: `${e.note ?? ""} Track a set with the camera so progress can account for your form.`.trim() };
    }
    if (latest.formScore < ADAPTIVE_RULES.progressFormScore) {
      return hold(`You hit the top of the range, but form averaged ${latest.formScore}. Progress once it's ${ADAPTIVE_RULES.progressFormScore}+.`);
    }
    if (latest.romPercent !== null && latest.romPercent < ADAPTIVE_RULES.progressRomPercent) {
      return hold(`You hit the top of the range at ${latest.romPercent}% range of motion. Own the full range before adding more.`, "hold_for_rom");
    }
    const strong = latest.formScore >= ADAPTIVE_RULES.strongFormScore ? "strong" : "solid";
    const rom = latest.romPercent !== null ? `, range ${latest.romPercent}%` : "";
    return { ...e, note: `Earned: top of the range on every set with ${strong} form (${latest.formScore}${rom}). ${e.note ?? ""}`.trim() };
  }
  return e;
}

export const adaptiveGenerator = {
  id: "adaptive",
  version: 1,
  generate(input: AdaptiveInput): WorkoutPlan {
    const base = ruleBasedGenerator.generate(input);
    let exercises = base.exercises.map((e) => adapt(e, input));
    const notes = [...base.notes];
    const { plannedDays, completedDays } = input.consistency;
    const lowConsistency = plannedDays >= 2 && completedDays / plannedDays < ADAPTIVE_RULES.lowConsistencyShare && !input.recentSeriousPain;
    if (lowConsistency) {
      exercises = exercises.map((e) => (e.sets > 2 ? { ...e, sets: e.sets - 1 } : e));
      notes.push(`You've trained ${completedDays} of ${plannedDays} planned days in the last two weeks. One set fewer per exercise today, same loads — showing up matters more than volume.`);
    }
    return { ...base, generator: { id: this.id, version: this.version }, exercises, notes };
  },
} satisfies WorkoutGenerator & { generate(input: AdaptiveInput): WorkoutPlan };
