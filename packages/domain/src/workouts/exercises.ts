import { ROM_SPECS } from "../analysis/repVerification";
import type { Equipment, ExperienceLevel } from "../users/profileOptions";

/**
 * Exercise library. Each entry carries what the Workout Engine, the generator and the
 * camera pipeline need. Camera support is derived from the ROM specs the Rep Verification
 * Engine actually implements, so the library can never claim camera support that doesn't exist.
 *
 * Equipment is a list of alternatives; each alternative lists everything it needs together.
 * `[["bodyweight"]]` means no equipment. Gym movements plug in by adding entries — nothing else changes.
 */

export type MuscleGroup =
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "chest"
  | "back"
  | "lats"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "core";

export type MovementPattern =
  | "squat"
  | "hinge"
  | "lunge"
  | "push_horizontal"
  | "push_vertical"
  | "pull_horizontal"
  | "pull_vertical"
  | "elbow_flexion";

export interface ExerciseDefinition {
  id: string;
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment[][];
  pattern: MovementPattern;
  difficulty: ExperienceLevel;
  /** Can external load be added (and should the app ask for a weight)? */
  loadable: boolean;
  /** Load step used for progression suggestions, kg. */
  loadIncrementKg: number;
  /** Default rep range; the generator adjusts it by goal. */
  targetReps: { min: number; max: number };
  perSide: boolean;
  instructions: string[];
  safety: string[];
  camera: { joint: "knee" | "elbow"; view: "side" | "front"; setup: string } | null;
}

export interface Exercise extends ExerciseDefinition {
  /** Kept for existing clients: "weighted" when the exercise always needs a load. */
  kind: "bodyweight" | "weighted";
  cameraVerifiable: boolean;
}

const FULL_BODY_SIDE = "Place the phone 2–3 m away at hip height, side-on, with your whole body in frame and good light.";
const UPPER_SIDE = "Place the phone 1.5–2 m away, side-on, with your working arm, shoulder and hip in frame.";

const DEFINITIONS: ExerciseDefinition[] = [
  {
    id: "bodyweight_squat",
    name: "Bodyweight Squat",
    primaryMuscles: ["quads", "glutes"],
    secondaryMuscles: ["hamstrings", "core"],
    equipment: [["bodyweight"]],
    pattern: "squat",
    difficulty: "beginner",
    loadable: false,
    loadIncrementKg: 0,
    targetReps: { min: 10, max: 20 },
    perSide: false,
    instructions: [
      "Stand with feet shoulder-width apart, toes turned out slightly.",
      "Brace your core and sit your hips back and down.",
      "Go as low as you can with a neutral spine — thighs at least parallel if comfortable.",
      "Drive through your whole foot to stand tall.",
    ],
    safety: ["Keep knees tracking over your toes.", "Stop if you feel sharp knee or hip pain."],
    camera: { joint: "knee", view: "side", setup: FULL_BODY_SIDE },
  },
  {
    id: "push_up",
    name: "Push-Up",
    primaryMuscles: ["chest", "triceps"],
    secondaryMuscles: ["shoulders", "core"],
    equipment: [["bodyweight"]],
    pattern: "push_horizontal",
    difficulty: "beginner",
    loadable: false,
    loadIncrementKg: 0,
    targetReps: { min: 6, max: 15 },
    perSide: false,
    instructions: [
      "Hands just wider than shoulders, body in a straight line from head to heels.",
      "Lower your chest towards the floor, elbows about 45° from your body.",
      "Press back up until your arms are straight.",
      "Too hard? Elevate your hands on a bench or do them from your knees.",
    ],
    safety: ["Don't let your hips sag.", "Stop if you feel shoulder or wrist pain."],
    camera: { joint: "elbow", view: "side", setup: FULL_BODY_SIDE },
  },
  {
    id: "bicep_curl",
    name: "Bicep Curl",
    primaryMuscles: ["biceps"],
    secondaryMuscles: [],
    equipment: [["dumbbells"], ["resistance_bands"], ["barbell"], ["cable_machine"], ["kettlebell"]],
    pattern: "elbow_flexion",
    difficulty: "beginner",
    loadable: true,
    loadIncrementKg: 1,
    targetReps: { min: 8, max: 15 },
    perSide: false,
    instructions: [
      "Stand tall, arms straight, palms facing forward.",
      "Keep your elbows pinned to your sides and curl the weight up.",
      "Squeeze at the top, then lower slowly under control until your arms are straight.",
    ],
    safety: ["Don't swing your back to lift the weight — choose a lighter load."],
    camera: { joint: "elbow", view: "side", setup: UPPER_SIDE },
  },
  {
    id: "lunge",
    name: "Lunge",
    primaryMuscles: ["quads", "glutes"],
    secondaryMuscles: ["hamstrings", "core"],
    equipment: [["bodyweight"], ["dumbbells"], ["kettlebell"]],
    pattern: "lunge",
    difficulty: "beginner",
    loadable: true,
    loadIncrementKg: 2,
    targetReps: { min: 8, max: 12 },
    perSide: true,
    instructions: [
      "Stand tall, then step forward with one leg.",
      "Lower until both knees are bent about 90°, back knee just above the floor.",
      "Push through your front foot to return. Alternate legs.",
    ],
    safety: ["Keep your front knee over your ankle.", "Hold a support for balance if you need it."],
    camera: { joint: "knee", view: "side", setup: FULL_BODY_SIDE },
  },
  {
    id: "glute_bridge",
    name: "Glute Bridge",
    primaryMuscles: ["glutes"],
    secondaryMuscles: ["hamstrings", "core"],
    equipment: [["bodyweight"]],
    pattern: "hinge",
    difficulty: "beginner",
    loadable: false,
    loadIncrementKg: 0,
    targetReps: { min: 12, max: 20 },
    perSide: false,
    instructions: ["Lie on your back, knees bent, feet flat.", "Drive through your heels to lift your hips until knees, hips and shoulders line up.", "Pause, then lower slowly."],
    safety: ["Squeeze your glutes rather than arching your lower back."],
    camera: null,
  },
  {
    id: "goblet_squat",
    name: "Goblet Squat",
    primaryMuscles: ["quads", "glutes"],
    secondaryMuscles: ["core"],
    equipment: [["dumbbells"], ["kettlebell"]],
    pattern: "squat",
    difficulty: "beginner",
    loadable: true,
    loadIncrementKg: 2,
    targetReps: { min: 8, max: 12 },
    perSide: false,
    instructions: ["Hold a dumbbell or kettlebell at your chest.", "Squat down between your knees, chest up.", "Stand by driving through your whole foot."],
    safety: ["Keep the weight close to your chest."],
    camera: { joint: "knee", view: "side", setup: FULL_BODY_SIDE },
  },
  {
    id: "squat",
    name: "Barbell Back Squat",
    primaryMuscles: ["quads", "glutes"],
    secondaryMuscles: ["hamstrings", "core"],
    equipment: [["barbell", "squat_rack"]],
    pattern: "squat",
    difficulty: "intermediate",
    loadable: true,
    loadIncrementKg: 5,
    targetReps: { min: 5, max: 10 },
    perSide: false,
    instructions: ["Set the bar on your upper back in a rack.", "Brace, sit down and back to at least parallel.", "Drive up, keeping your chest proud."],
    safety: ["Always set safety bars at the right height.", "Never squat heavy without safeties or a spotter."],
    camera: { joint: "knee", view: "side", setup: FULL_BODY_SIDE },
  },
  {
    id: "deadlift",
    name: "Deadlift",
    primaryMuscles: ["hamstrings", "glutes", "back"],
    secondaryMuscles: ["core", "quads"],
    equipment: [["barbell"]],
    pattern: "hinge",
    difficulty: "intermediate",
    loadable: true,
    loadIncrementKg: 5,
    targetReps: { min: 3, max: 8 },
    perSide: false,
    instructions: ["Bar over mid-foot, grip just outside your legs.", "Brace, keep your back neutral and push the floor away.", "Lock out with your glutes, then lower under control."],
    safety: ["Never round your lower back under load.", "Stop immediately with sharp back pain."],
    camera: null,
  },
  {
    id: "bench_press",
    name: "Bench Press",
    primaryMuscles: ["chest", "triceps"],
    secondaryMuscles: ["shoulders"],
    equipment: [["barbell", "bench"], ["dumbbells", "bench"]],
    pattern: "push_horizontal",
    difficulty: "intermediate",
    loadable: true,
    loadIncrementKg: 2.5,
    targetReps: { min: 5, max: 10 },
    perSide: false,
    instructions: ["Lie on the bench, eyes under the bar, feet flat.", "Lower to your mid-chest under control.", "Press up and slightly back."],
    safety: ["Use a spotter or safety arms for heavy sets."],
    camera: null,
  },
  {
    id: "overhead_press",
    name: "Overhead Press",
    primaryMuscles: ["shoulders", "triceps"],
    secondaryMuscles: ["core"],
    equipment: [["barbell"], ["dumbbells"], ["kettlebell"]],
    pattern: "push_vertical",
    difficulty: "intermediate",
    loadable: true,
    loadIncrementKg: 2.5,
    targetReps: { min: 5, max: 10 },
    perSide: false,
    instructions: ["Start with the weight at your shoulders.", "Brace your core and press straight overhead.", "Lower under control."],
    safety: ["Don't lean back excessively — squeeze your glutes."],
    camera: null,
  },
  {
    id: "row",
    name: "Bent-Over Row",
    primaryMuscles: ["back", "lats"],
    secondaryMuscles: ["biceps"],
    equipment: [["barbell"], ["dumbbells"], ["kettlebell"]],
    pattern: "pull_horizontal",
    difficulty: "beginner",
    loadable: true,
    loadIncrementKg: 2.5,
    targetReps: { min: 8, max: 12 },
    perSide: false,
    instructions: ["Hinge forward with a flat back.", "Pull the weight towards your lower ribs.", "Lower under control."],
    safety: ["Keep your back neutral throughout."],
    camera: null,
  },
  {
    id: "band_row",
    name: "Band Row",
    primaryMuscles: ["back", "lats"],
    secondaryMuscles: ["biceps"],
    equipment: [["resistance_bands"]],
    pattern: "pull_horizontal",
    difficulty: "beginner",
    loadable: false,
    loadIncrementKg: 0,
    targetReps: { min: 12, max: 20 },
    perSide: false,
    instructions: ["Anchor the band at chest height.", "Pull your elbows back, squeezing your shoulder blades.", "Return slowly."],
    safety: ["Check the band and anchor before every set."],
    camera: null,
  },
  {
    id: "cable_row",
    name: "Seated Cable Row",
    primaryMuscles: ["back", "lats"],
    secondaryMuscles: ["biceps"],
    equipment: [["cable_machine"], ["machines"]],
    pattern: "pull_horizontal",
    difficulty: "beginner",
    loadable: true,
    loadIncrementKg: 2.5,
    targetReps: { min: 8, max: 12 },
    perSide: false,
    instructions: ["Sit tall with a slight knee bend.", "Pull the handle to your stomach.", "Return slowly without rounding forward."],
    safety: ["Don't jerk the weight with your lower back."],
    camera: null,
  },
  {
    id: "lat_pulldown",
    name: "Lat Pulldown",
    primaryMuscles: ["lats"],
    secondaryMuscles: ["biceps", "back"],
    equipment: [["cable_machine"], ["machines"]],
    pattern: "pull_vertical",
    difficulty: "beginner",
    loadable: true,
    loadIncrementKg: 2.5,
    targetReps: { min: 8, max: 12 },
    perSide: false,
    instructions: ["Grip the bar just wider than shoulders.", "Pull it to your upper chest, elbows down.", "Return with control."],
    safety: ["Pull to the front, never behind your neck."],
    camera: null,
  },
  {
    id: "pull_up",
    name: "Pull-Up",
    primaryMuscles: ["lats"],
    secondaryMuscles: ["biceps", "back"],
    equipment: [["pull_up_bar"]],
    pattern: "pull_vertical",
    difficulty: "intermediate",
    loadable: false,
    loadIncrementKg: 0,
    targetReps: { min: 3, max: 10 },
    perSide: false,
    instructions: ["Hang with straight arms, grip just wider than shoulders.", "Pull until your chin clears the bar.", "Lower all the way down."],
    safety: ["Use a band for assistance if you can't do a full rep."],
    camera: null,
  },
];

export const EXERCISES: readonly Exercise[] = DEFINITIONS.map((e) => ({
  ...e,
  kind: e.equipment.some((alt) => alt.includes("bodyweight")) ? "bodyweight" : "weighted",
  // Camera support exists only where the Rep Verification Engine has ROM rules for it.
  cameraVerifiable: e.id in ROM_SPECS && e.camera !== null,
}));

export const EXERCISE_BY_ID: ReadonlyMap<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]));

/** True if the user's equipment satisfies at least one of the exercise's alternatives. */
export function canPerform(exercise: Pick<ExerciseDefinition, "equipment">, available: readonly Equipment[]): boolean {
  const have = new Set<Equipment>([...available, "bodyweight"]);
  return exercise.equipment.some((alt) => alt.every((e) => have.has(e)));
}

const LEVEL: Record<ExperienceLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };

export function suitableFor(exercise: Pick<ExerciseDefinition, "difficulty">, experience: ExperienceLevel): boolean {
  return LEVEL[exercise.difficulty] <= LEVEL[experience];
}
