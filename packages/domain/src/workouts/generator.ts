import type { PainLevel } from "../progression/progressionEngine";
import { dayNumber, type DateKey } from "../shared/dates";
import type { Equipment, ExperienceLevel, PrimaryGoal } from "../users/profileOptions";
import { canPerform, EXERCISES, suitableFor, type Exercise, type MovementPattern } from "./exercises";

/**
 * Workout generation. Generators are pluggable: anything implementing WorkoutGenerator can
 * replace the rule-based v1 (e.g. an adaptive generator) without touching the API or app.
 * Generators must be deterministic — the same inputs always produce the same plan.
 */

export interface ExercisePerformance {
  localDate: DateKey;
  painLevel: PainLevel;
  sets: { reps: number; loadKg: number }[];
  /** Mean ROM of camera-verified reps last time, when available (form data). */
  averageRomPercent: number | null;
}

export interface GenerationInput {
  date: DateKey;
  goal: PrimaryGoal | null;
  experience: ExperienceLevel | null;
  equipment: Equipment[];
  trainingDaysPerWeek: number | null;
  /** Sessions already completed this week (rotates upper/lower splits). */
  sessionsThisWeek: number;
  daysSinceLastWorkout: number | null;
  recentSeriousPain: boolean;
  /** Most recent performance per exercise id. */
  previous: Record<string, ExercisePerformance>;
}

export type ProgressionDecision = "new" | "repeat" | "increase_load" | "increase_reps" | "deload" | "hold_for_rom" | "hold_for_form";

export interface PlannedExercise {
  exerciseId: string;
  name: string;
  sets: number;
  targetReps: { min: number; max: number };
  /** Suggested load; null when bodyweight or when there's no history to base it on. */
  targetLoadKg: number | null;
  restSeconds: number;
  progression: ProgressionDecision;
  note: string | null;
  cameraVerifiable: boolean;
}

export interface WorkoutPlan {
  generator: { id: string; version: number };
  date: DateKey;
  title: string;
  focus: "full_body" | "upper" | "lower";
  exercises: PlannedExercise[];
  estimatedMinutes: number;
  notes: string[];
}

export interface WorkoutGenerator {
  readonly id: string;
  readonly version: number;
  generate(input: GenerationInput): WorkoutPlan;
}

// ---- Rule-based generator (v1) ---------------------------------------------------------

interface Scheme {
  reps: { min: number; max: number };
  sets: number;
  restSeconds: number;
  label: string;
}

const SCHEMES: Record<PrimaryGoal | "default", Scheme> = {
  build_muscle: { reps: { min: 8, max: 12 }, sets: 3, restSeconds: 90, label: "Build Muscle" },
  get_stronger: { reps: { min: 4, max: 6 }, sets: 4, restSeconds: 150, label: "Strength" },
  lose_fat: { reps: { min: 10, max: 15 }, sets: 3, restSeconds: 60, label: "Fat Loss" },
  get_lean: { reps: { min: 10, max: 15 }, sets: 3, restSeconds: 60, label: "Lean" },
  improve_fitness: { reps: { min: 12, max: 15 }, sets: 2, restSeconds: 45, label: "Fitness" },
  improve_health: { reps: { min: 10, max: 12 }, sets: 2, restSeconds: 75, label: "Health" },
  default: { reps: { min: 10, max: 12 }, sets: 2, restSeconds: 75, label: "Foundations" },
};

type Slot = MovementPattern[];

const FULL_BODY: Slot[] = [["squat", "lunge"], ["push_horizontal", "push_vertical"], ["pull_horizontal", "pull_vertical", "elbow_flexion"], ["hinge", "lunge"]];
const LOWER: Slot[] = [["squat"], ["hinge"], ["lunge"]];
const UPPER: Slot[] = [["push_horizontal"], ["pull_horizontal", "pull_vertical"], ["push_vertical"], ["elbow_flexion"]];

const RETURNING_AFTER_DAYS = 14;
const MIN_ROM_TO_PROGRESS = 80;

/** Rounds a reduced load DOWN to the equipment step, so a deload is never rounded back up to the old load. */
function deloadTo(value: number, step: number): number {
  return step > 0 ? Math.max(step, Math.floor(value / step + 1e-9) * step) : value;
}

/** Loadable with the equipment the user actually has (a lunge is bodyweight-only without dumbbells). */
export function loadableWith(exercise: Exercise, equipment: readonly Equipment[]): boolean {
  return exercise.loadable && exercise.equipment.some((alt) => alt.every((x) => x !== "bodyweight" && equipment.includes(x)));
}

function pick(slot: Slot, candidates: Exercise[], input: GenerationInput, used: Set<string>, goal: PrimaryGoal | null): Exercise | null {
  const options = candidates.filter((e) => !used.has(e.id));
  if (options.length === 0) return null;
  const experience = input.experience ?? "beginner";
  const score = (e: Exercise) =>
    // The slot's first pattern is what the slot is for; later ones are fallbacks.
    (e.pattern === slot[0] ? 8 : 0) +
    // Strength goals prefer movements the user can load; newer lifters prefer camera-verifiable
    // ones (so their reps can be verified); everyone gets movements matched to their level.
    (goal === "get_stronger" || goal === "build_muscle" ? (loadableWith(e, input.equipment) ? 4 : 0) : 0) +
    (experience !== "advanced" && e.cameraVerifiable ? 2 : 0) +
    (e.difficulty === experience ? 1 : 0) +
    (input.previous[e.id] ? 1 : 0);
  const best = Math.max(...options.map(score));
  const top = options.filter((e) => score(e) === best);
  // Deterministic variety: rotate among equally good options by date.
  return top[dayNumber(input.date) % top.length]!;
}

function progressionFor(exercise: Exercise, reps: { min: number; max: number }, input: GenerationInput) {
  const prev = input.previous[exercise.id];
  const loadable = loadableWith(exercise, input.equipment);
  if (!prev || prev.sets.length === 0) {
    return {
      decision: "new" as const,
      targetLoadKg: null,
      reps,
      note: loadable ? `Choose a weight you can lift for ${reps.max} reps with good form.` : null,
    };
  }
  const lastLoad = Math.max(...prev.sets.map((s) => s.loadKg));
  const allHitTop = prev.sets.every((s) => s.reps >= reps.max);
  const missedMin = prev.sets.some((s) => s.reps < reps.min);

  if (prev.painLevel === "serious" || input.recentSeriousPain) {
    return {
      decision: "deload" as const,
      targetLoadKg: loadable && lastLoad > 0 ? deloadTo(lastLoad * 0.8, exercise.loadIncrementKg) : null,
      reps,
      note: "Lighter than last time after reported pain. Stop if it hurts.",
    };
  }
  if (input.daysSinceLastWorkout !== null && input.daysSinceLastWorkout >= RETURNING_AFTER_DAYS) {
    return {
      decision: "deload" as const,
      targetLoadKg: loadable && lastLoad > 0 ? deloadTo(lastLoad * 0.9, exercise.loadIncrementKg) : null,
      reps,
      note: "Easing back in after a break.",
    };
  }
  if (prev.averageRomPercent !== null && prev.averageRomPercent < MIN_ROM_TO_PROGRESS) {
    return {
      decision: "hold_for_rom" as const,
      targetLoadKg: loadable && lastLoad > 0 ? lastLoad : null,
      reps,
      note: `Last time your range of motion averaged ${prev.averageRomPercent}%. Own full range before adding more.`,
    };
  }
  if (allHitTop) {
    if (loadable && lastLoad > 0) {
      return { decision: "increase_load" as const, targetLoadKg: lastLoad + exercise.loadIncrementKg, reps, note: `You hit ${reps.max} reps on every set — up ${exercise.loadIncrementKg} kg.` };
    }
    const bump = { min: reps.min + 2, max: reps.max + 2 };
    return { decision: "increase_reps" as const, targetLoadKg: null, reps: bump, note: "You hit the top of the range — aim for 2 more reps." };
  }
  return {
    decision: "repeat" as const,
    targetLoadKg: loadable && lastLoad > 0 ? lastLoad : null,
    reps,
    note: missedMin ? "Same as last time — aim to hit the full rep range." : null,
  };
}

export const ruleBasedGenerator: WorkoutGenerator = {
  id: "rule_based",
  version: 1,
  generate(input) {
    const goal = input.goal;
    const scheme = SCHEMES[goal ?? "default"];
    const experience = input.experience ?? "beginner";

    const days = input.trainingDaysPerWeek ?? 3;
    const focus: WorkoutPlan["focus"] = days <= 3 ? "full_body" : input.sessionsThisWeek % 2 === 0 ? "lower" : "upper";
    const slots = focus === "full_body" ? FULL_BODY : focus === "lower" ? LOWER : UPPER;

    const available = EXERCISES.filter((e) => canPerform(e, input.equipment) && suitableFor(e, experience));
    const used = new Set<string>();
    const notes: string[] = [];

    let sets = experience === "beginner" ? Math.min(scheme.sets, 3) : experience === "advanced" ? Math.min(scheme.sets + 1, 5) : scheme.sets;
    const returning = input.daysSinceLastWorkout !== null && input.daysSinceLastWorkout >= RETURNING_AFTER_DAYS;
    if (input.recentSeriousPain) {
      sets = 2;
      notes.push("You reported serious pain recently. Keep this session light and stop if pain returns — or rest today.");
    } else if (returning) {
      sets = Math.max(2, sets - 1);
      notes.push("Welcome back. Volume and loads are eased back for your first session after a break.");
    }

    const exercises: PlannedExercise[] = [];
    for (const slot of slots) {
      const exercise = pick(slot, available.filter((e) => slot.includes(e.pattern)), input, used, goal);
      if (!exercise) continue;
      used.add(exercise.id);
      // Bodyweight movements can't be made easier with load, so they keep their own rep range.
      const baseReps = loadableWith(exercise, input.equipment) ? scheme.reps : exercise.targetReps;
      const p = progressionFor(exercise, baseReps, input);
      exercises.push({
        exerciseId: exercise.id,
        name: exercise.name,
        sets,
        targetReps: p.reps,
        targetLoadKg: p.targetLoadKg,
        restSeconds: scheme.restSeconds,
        progression: p.decision,
        note: exercise.perSide ? [p.note, "Reps are per leg."].filter(Boolean).join(" ") : p.note,
        cameraVerifiable: exercise.cameraVerifiable,
      });
    }

    const secondsPerRep = 4;
    const workSeconds = exercises.reduce((a, e) => a + e.sets * (((e.targetReps.min + e.targetReps.max) / 2) * secondsPerRep * (EXERCISES.find((x) => x.id === e.exerciseId)?.perSide ? 2 : 1) + e.restSeconds), 0);
    const focusLabel = focus === "full_body" ? "Full Body" : focus === "upper" ? "Upper Body" : "Lower Body";

    return {
      generator: { id: this.id, version: this.version },
      date: input.date,
      title: `${focusLabel} · ${scheme.label}`,
      focus,
      exercises,
      estimatedMinutes: Math.max(10, Math.round(workSeconds / 60) + 5),
      notes,
    };
  },
};
