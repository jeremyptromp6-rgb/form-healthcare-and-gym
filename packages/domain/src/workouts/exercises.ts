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
  | "forearms"
  | "traps"
  | "core";

export type MovementPattern =
  | "squat"
  | "hinge"
  | "lunge"
  | "push_horizontal"
  | "push_vertical"
  | "pull_horizontal"
  | "pull_vertical"
  | "elbow_flexion"
  | "elbow_extension"
  | "core"
  | "calf_raise"
  | "isolation"
  | "grip"
  | "conditioning";

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

type Eq = Equipment[][];
const BW: Eq = [["bodyweight"]];
const DB: Eq = [["dumbbells"]];
const BB: Eq = [["barbell"]];
const KB: Eq = [["kettlebell"]];
const CABLE: Eq = [["cable_machine"]];
const MACHINE: Eq = [["machines"]];
const BAND: Eq = [["resistance_bands"]];
const BAR: Eq = [["pull_up_bar"]];

/**
 * Compact entry for the wider library: same shape as the hand-written ones below. `step` is the load
 * step in kg (0 = not loadable); `how` and `safety` are "|"-separated lists. Hold and carry moves count
 * seconds or steps in `reps`. No camera tracking: camera support only comes with ROM rules.
 */
function lib(
  id: string,
  name: string,
  primaryMuscles: MuscleGroup[],
  secondaryMuscles: MuscleGroup[],
  equipment: Eq,
  pattern: MovementPattern,
  difficulty: ExperienceLevel,
  step: number,
  reps: [number, number],
  how: string,
  safety: string,
  perSide = false,
): ExerciseDefinition {
  return {
    id,
    name,
    primaryMuscles,
    secondaryMuscles,
    equipment,
    pattern,
    difficulty,
    loadable: step > 0,
    loadIncrementKg: step,
    targetReps: { min: reps[0], max: reps[1] },
    perSide,
    instructions: how.split("|"),
    safety: safety.split("|"),
    camera: null,
  };
}

const LIBRARY: ExerciseDefinition[] = [
  // Chest
  lib("incline_bench_press", "Incline Bench Press", ["chest", "shoulders"], ["triceps"], [["barbell", "bench"], ["dumbbells", "bench"]], "push_horizontal", "intermediate", 2.5, [6, 10], "Set the bench to a low incline, eyes under the bar, feet flat.|Lower the weight to your upper chest under control.|Press up until your arms are straight.", "Use a spotter or safety arms for heavy sets."),
  lib("dumbbell_bench_press", "Dumbbell Bench Press", ["chest", "triceps"], ["shoulders"], [["dumbbells", "bench"]], "push_horizontal", "beginner", 2, [8, 12], "Lie on the bench with a dumbbell in each hand over your chest.|Lower them to the sides of your chest, elbows about 45° from your body.|Press back up and squeeze your chest.", "Kick the dumbbells up and set them down carefully."),
  lib("incline_dumbbell_press", "Incline Dumbbell Press", ["chest", "shoulders"], ["triceps"], [["dumbbells", "bench"]], "push_horizontal", "intermediate", 2, [8, 12], "Set the bench to a low incline and hold the dumbbells at your upper chest.|Press them up and slightly together.|Lower slowly to a deep, comfortable stretch.", "Don't let your elbows flare out hard."),
  lib("dumbbell_fly", "Dumbbell Fly", ["chest"], ["shoulders"], [["dumbbells", "bench"]], "isolation", "intermediate", 1, [10, 15], "Lie on the bench with the dumbbells above your chest, palms facing in.|With soft elbows, open your arms wide in a smooth arc.|Squeeze your chest to bring them back together.", "Go light and stop when you feel a deep chest stretch, not shoulder strain."),
  lib("cable_crossover", "Cable Crossover", ["chest"], ["shoulders"], CABLE, "isolation", "intermediate", 2.5, [10, 15], "Set both pulleys high and step forward with a slight lean.|With soft elbows, sweep your hands down and together in front of you.|Return slowly until you feel your chest stretch.", "Keep your torso still — don't swing the weight."),
  lib("machine_chest_press", "Machine Chest Press", ["chest", "triceps"], ["shoulders"], MACHINE, "push_horizontal", "beginner", 2.5, [8, 12], "Adjust the seat so the handles are at mid-chest.|Press forward until your arms are almost straight.|Return slowly without letting the stack touch.", "Keep your back against the pad."),
  lib("pec_deck", "Pec Deck", ["chest"], ["shoulders"], MACHINE, "isolation", "beginner", 2.5, [10, 15], "Sit tall with your back on the pad and forearms on the arms.|Bring your arms together in front of your chest.|Open slowly until you feel a gentle stretch.", "Don't let the arms pull your shoulders back too far."),
  lib("incline_push_up", "Incline Push-Up", ["chest", "triceps"], ["shoulders", "core"], BW, "push_horizontal", "beginner", 0, [8, 20], "Place your hands on a bench or sturdy surface, body in a straight line.|Lower your chest to the edge.|Press back up. The higher the surface, the easier it is.", "Make sure the surface can't slide."),
  lib("knee_push_up", "Knee Push-Up", ["chest", "triceps"], ["shoulders", "core"], BW, "push_horizontal", "beginner", 0, [8, 20], "Kneel with your hands just wider than your shoulders, hips in line.|Lower your chest towards the floor.|Press back up while keeping your body straight from knees to head.", "Pad your knees if the floor is hard."),
  lib("diamond_push_up", "Diamond Push-Up", ["triceps", "chest"], ["shoulders", "core"], BW, "push_horizontal", "intermediate", 0, [6, 15], "Place your hands under your chest with thumbs and fingers forming a diamond.|Lower your chest to your hands with elbows close to your body.|Press back up.", "Drop to your knees if your wrists or elbows complain."),
  // Back
  lib("one_arm_dumbbell_row", "One-Arm Dumbbell Row", ["lats", "back"], ["biceps", "forearms"], DB, "pull_horizontal", "beginner", 2, [8, 12], "Support one hand and a knee on a bench, back flat.|Pull the dumbbell towards your hip, elbow close to your body.|Lower until your arm is straight.", "Keep your back flat and don't twist.", true),
  lib("t_bar_row", "T-Bar Row", ["back", "lats"], ["biceps", "core"], BB, "pull_horizontal", "intermediate", 2.5, [8, 12], "Straddle the bar, hinge forward with a flat back.|Pull the handle to your chest.|Lower under control.", "Never round your lower back."),
  lib("inverted_row", "Inverted Row", ["back", "lats"], ["biceps", "core"], BAR, "pull_horizontal", "beginner", 0, [6, 15], "Hang under a low, sturdy bar with a straight body.|Pull your chest to the bar.|Lower slowly. Bend your knees to make it easier.", "Use a bar that is fixed and rated for your weight."),
  lib("chin_up", "Chin-Up", ["lats", "biceps"], ["back", "forearms"], BAR, "pull_vertical", "intermediate", 0, [3, 10], "Hang with your palms facing you, hands shoulder-width apart.|Pull until your chin clears the bar.|Lower all the way down.", "Use a band or the assisted machine if you can't do a full rep."),
  lib("assisted_pull_up", "Assisted Pull-Up", ["lats"], ["biceps", "back"], MACHINE, "pull_vertical", "beginner", 2.5, [6, 12], "Kneel on the pad and grip the bar just wider than your shoulders.|Pull your chest up to the bar.|Lower under control.", "Use enough assistance to keep every rep smooth."),
  lib("close_grip_pulldown", "Close-Grip Pulldown", ["lats"], ["biceps", "back"], [["cable_machine"], ["machines"]], "pull_vertical", "beginner", 2.5, [8, 12], "Grip the close handle and sit with your thighs under the pads.|Pull it to your upper chest, elbows down and back.|Return with control.", "Don't lean back to swing the weight."),
  lib("straight_arm_pulldown", "Straight-Arm Pulldown", ["lats"], ["triceps", "core"], CABLE, "pull_vertical", "intermediate", 2.5, [10, 15], "Stand facing the high pulley, arms straight, hinge slightly.|Sweep the bar down to your thighs, arms staying straight.|Return slowly until you feel your lats stretch.", "Keep your ribs down and don't arch your back."),
  lib("face_pull", "Face Pull", ["back", "shoulders"], ["traps", "biceps"], [["cable_machine"], ["resistance_bands"]], "pull_horizontal", "beginner", 2.5, [12, 20], "Set the rope at face height and step back.|Pull the rope towards your face, elbows high and wide.|Squeeze your shoulder blades, then return slowly.", "Use a light load — this is a control exercise."),
  lib("single_arm_cable_row", "Single-Arm Cable Row", ["lats", "back"], ["biceps", "core"], CABLE, "pull_horizontal", "beginner", 2.5, [8, 12], "Stand or sit square to the cable with a single handle.|Pull your elbow past your side.|Return slowly without twisting.", "Keep your hips and shoulders square.", true),
  lib("superman", "Superman", ["back", "glutes"], ["hamstrings"], BW, "core", "beginner", 0, [10, 15], "Lie face down with your arms stretched forward.|Lift your arms, chest and legs a few centimetres off the floor.|Pause, then lower slowly.", "Keep your neck long and look at the floor."),
  lib("back_extension", "Back Extension", ["back", "glutes"], ["hamstrings"], [["bodyweight"], ["machines"]], "core", "beginner", 0, [10, 15], "Set the pad at hip height and cross your arms.|Lower your torso with a flat back.|Raise until your body is in a straight line.", "Don't hyperextend at the top."),
  lib("rack_pull", "Rack Pull", ["back", "glutes"], ["hamstrings", "traps", "forearms"], [["barbell", "squat_rack"]], "hinge", "intermediate", 5, [3, 8], "Set the bar at knee height in a rack.|Brace, keep your back flat and stand tall.|Lower the bar back to the pins under control.", "Never round your lower back under load."),
  lib("dumbbell_shrug", "Dumbbell Shrug", ["traps"], ["forearms", "shoulders"], DB, "isolation", "beginner", 2, [10, 15], "Stand tall with a dumbbell in each hand at your sides.|Lift your shoulders straight up towards your ears.|Pause, then lower slowly.", "Don't roll your shoulders."),
  lib("rear_delt_fly", "Rear Delt Fly", ["shoulders", "back"], ["traps"], DB, "isolation", "beginner", 1, [10, 15], "Hinge forward with a flat back and the dumbbells hanging.|With soft elbows, raise your arms out to the sides.|Lower slowly.", "Go light and keep your neck relaxed."),
  // Shoulders
  lib("dumbbell_shoulder_press", "Dumbbell Shoulder Press", ["shoulders", "triceps"], ["core"], DB, "push_vertical", "beginner", 2, [8, 12], "Hold the dumbbells at shoulder height, palms forward.|Press them overhead until your arms are straight.|Lower to your shoulders.", "Brace your core and don't arch your lower back."),
  lib("seated_dumbbell_press", "Seated Dumbbell Press", ["shoulders", "triceps"], ["chest"], [["dumbbells", "bench"]], "push_vertical", "beginner", 2, [8, 12], "Sit upright with your back supported, dumbbells at your shoulders.|Press them overhead.|Lower under control.", "Keep your back against the pad."),
  lib("arnold_press", "Arnold Press", ["shoulders", "triceps"], ["chest", "core"], DB, "push_vertical", "intermediate", 2, [8, 12], "Start with the dumbbells in front of your chest, palms facing you.|Rotate your palms out as you press overhead.|Reverse the movement on the way down.", "Use a lighter weight than your normal press."),
  lib("lateral_raise", "Lateral Raise", ["shoulders"], ["traps"], [["dumbbells"], ["resistance_bands"]], "isolation", "beginner", 1, [10, 15], "Stand tall with a light weight in each hand.|Raise your arms out to the sides to shoulder height.|Lower slowly.", "Don't swing — if you have to, go lighter."),
  lib("front_raise", "Front Raise", ["shoulders"], ["chest"], [["dumbbells"], ["resistance_bands"]], "isolation", "beginner", 1, [10, 15], "Hold the weights in front of your thighs.|Raise your arms forward to shoulder height.|Lower slowly.", "Keep your torso still."),
  lib("upright_row", "Upright Row", ["shoulders", "traps"], ["biceps"], [["barbell"], ["dumbbells"]], "pull_vertical", "intermediate", 2.5, [8, 12], "Hold the weight in front of your thighs with a shoulder-width grip.|Pull it up along your body to chest height, elbows leading.|Lower under control.", "Stop at chest height and stop if your shoulders pinch."),
  lib("push_press", "Push Press", ["shoulders", "triceps"], ["quads", "core"], BB, "push_vertical", "advanced", 2.5, [3, 8], "Hold the bar at your shoulders.|Dip slightly at the knees, then drive up and press the bar overhead.|Lower to your shoulders under control.", "Keep your ribs down and the bar over your mid-foot."),
  lib("machine_shoulder_press", "Machine Shoulder Press", ["shoulders", "triceps"], ["chest"], MACHINE, "push_vertical", "beginner", 2.5, [8, 12], "Adjust the seat so the handles are at shoulder height.|Press up until your arms are almost straight.|Lower slowly.", "Keep your back against the pad."),
  lib("cable_lateral_raise", "Cable Lateral Raise", ["shoulders"], ["traps"], CABLE, "isolation", "intermediate", 1, [10, 15], "Stand side-on to a low pulley, handle in your far hand.|Raise your arm out to the side to shoulder height.|Lower under control.", "Don't lean away to cheat the lift.", true),
  lib("pike_push_up", "Pike Push-Up", ["shoulders", "triceps"], ["chest", "core"], BW, "push_vertical", "intermediate", 0, [6, 12], "Start in a push-up position, then walk your feet in to make an upside-down V.|Bend your elbows to lower the top of your head towards the floor.|Press back up.", "Keep your head in line with your arms."),
  // Biceps
  lib("hammer_curl", "Hammer Curl", ["biceps", "forearms"], [], DB, "elbow_flexion", "beginner", 1, [8, 15], "Stand tall with palms facing each other.|Curl the dumbbells up, keeping your elbows pinned.|Lower slowly.", "Don't swing your back to lift the weight."),
  lib("barbell_curl", "Barbell Curl", ["biceps"], ["forearms"], BB, "elbow_flexion", "beginner", 2.5, [8, 12], "Hold the bar with an underhand grip, shoulder-width apart.|Curl it up without moving your elbows.|Lower under control.", "Choose a weight you can lift without leaning back."),
  lib("concentration_curl", "Concentration Curl", ["biceps"], ["forearms"], [["dumbbells", "bench"]], "elbow_flexion", "beginner", 1, [8, 12], "Sit on a bench with your elbow braced against your inner thigh.|Curl the dumbbell up towards your shoulder.|Lower slowly.", "Keep your upper arm still.", true),
  lib("cable_curl", "Cable Curl", ["biceps"], ["forearms"], CABLE, "elbow_flexion", "beginner", 2.5, [10, 15], "Face the low pulley and hold the bar with an underhand grip.|Curl it up, elbows by your sides.|Lower slowly to keep tension.", "Stand tall — don't rock."),
  lib("incline_dumbbell_curl", "Incline Dumbbell Curl", ["biceps"], ["forearms"], [["dumbbells", "bench"]], "elbow_flexion", "intermediate", 1, [8, 12], "Sit back on an incline bench with your arms hanging.|Curl the dumbbells up without moving your elbows forward.|Lower to a full stretch.", "Go light — the stretch is deep."),
  lib("band_curl", "Band Curl", ["biceps"], ["forearms"], BAND, "elbow_flexion", "beginner", 0, [12, 20], "Stand on the band with your feet hip-width apart.|Curl your hands up to your shoulders.|Lower slowly against the tension.", "Check the band for nicks before every set."),
  // Triceps
  lib("triceps_pushdown", "Triceps Pushdown", ["triceps"], [], CABLE, "elbow_extension", "beginner", 2.5, [10, 15], "Stand at the high pulley, elbows pinned to your sides.|Press the bar or rope down until your arms are straight.|Return slowly to chest height.", "Keep your elbows still."),
  lib("overhead_triceps_extension", "Overhead Triceps Extension", ["triceps"], ["core"], [["dumbbells"], ["kettlebell"]], "elbow_extension", "beginner", 1, [8, 15], "Hold one weight with both hands overhead.|Bend your elbows to lower it behind your head.|Straighten your arms to return.", "Keep your ribs down and your elbows close to your head."),
  lib("skull_crusher", "Skull Crusher", ["triceps"], ["shoulders"], [["barbell", "bench"], ["dumbbells", "bench"]], "elbow_extension", "intermediate", 2.5, [8, 12], "Lie on a bench with the weight above your chest, arms straight.|Bend your elbows to lower it towards your forehead.|Extend your arms to return.", "Use a spotter or a light load, and keep your elbows in."),
  lib("close_grip_bench_press", "Close-Grip Bench Press", ["triceps", "chest"], ["shoulders"], [["barbell", "bench"]], "push_horizontal", "intermediate", 2.5, [6, 10], "Lie on the bench and grip the bar about shoulder-width apart.|Lower to your lower chest, elbows tucked in.|Press back up.", "Use a spotter or safety arms for heavy sets."),
  lib("bench_dip", "Bench Dip", ["triceps"], ["chest", "shoulders"], [["bench"]], "elbow_extension", "beginner", 0, [8, 15], "Sit on the edge of a bench, hands beside your hips, legs out.|Slide off and bend your elbows to lower your body.|Press back up.", "Keep your hips close to the bench and stop if your shoulders ache."),
  lib("triceps_kickback", "Triceps Kickback", ["triceps"], ["shoulders"], DB, "elbow_extension", "beginner", 1, [10, 15], "Hinge forward with your upper arm tucked along your side.|Straighten your arm behind you.|Bend it back slowly.", "Keep your upper arm still.", true),
  lib("band_pushdown", "Band Pushdown", ["triceps"], [], BAND, "elbow_extension", "beginner", 0, [12, 20], "Anchor the band high and hold it at chest height, elbows by your sides.|Press down until your arms are straight.|Return slowly.", "Check the band and anchor before every set."),
  lib("machine_dip", "Assisted Dip", ["triceps", "chest"], ["shoulders"], MACHINE, "push_vertical", "intermediate", 2.5, [6, 12], "Kneel on the pad and grip the handles with straight arms.|Lower until your elbows reach about 90°.|Press back up.", "Stop if you feel any shoulder pinch."),
  // Forearms and grip
  lib("wrist_curl", "Wrist Curl", ["forearms"], [], [["dumbbells"], ["barbell"]], "grip", "beginner", 1, [12, 20], "Rest your forearms on your thighs, palms up, wrists over your knees.|Curl the weight up using only your wrists.|Lower slowly.", "Use a light weight and a full, pain-free range."),
  lib("reverse_wrist_curl", "Reverse Wrist Curl", ["forearms"], [], [["dumbbells"], ["barbell"]], "grip", "beginner", 1, [12, 20], "Rest your forearms on your thighs, palms down, wrists over your knees.|Lift the back of your hands up.|Lower slowly.", "Use a light weight."),
  lib("reverse_curl", "Reverse Curl", ["forearms", "biceps"], [], [["barbell"], ["dumbbells"]], "grip", "beginner", 2, [8, 12], "Hold the weight with an overhand grip.|Curl it up, elbows pinned to your sides.|Lower slowly.", "Don't swing your back."),
  lib("farmers_carry", "Farmer's Carry", ["forearms", "traps"], ["core", "glutes"], [["dumbbells"], ["kettlebell"]], "grip", "beginner", 2, [20, 40], "Pick up a heavy weight in each hand and stand tall.|Walk with short, steady steps for 20–40 steps.|Set the weights down under control.", "Keep your shoulders back and your core braced."),
  lib("dead_hang", "Dead Hang", ["forearms", "lats"], ["shoulders"], BAR, "grip", "beginner", 0, [20, 45], "Hang from the bar with straight arms for 20–45 seconds.|Keep your shoulders active, not shrugged to your ears.|Step down carefully.", "Step down if your grip is failing."),
  // Core
  lib("plank", "Plank", ["core"], ["shoulders", "glutes"], BW, "core", "beginner", 0, [20, 60], "Rest on your forearms and toes, body in one straight line.|Squeeze your glutes and brace your core, holding for 20–60 seconds.|Breathe steadily.", "Don't let your hips sag or pike."),
  lib("side_plank", "Side Plank", ["core"], ["shoulders", "glutes"], BW, "core", "beginner", 0, [15, 45], "Lie on your side with your elbow under your shoulder.|Lift your hips into a straight line and hold for 15–45 seconds.|Swap sides.", "Keep your hips stacked.", true),
  lib("crunch", "Crunch", ["core"], [], BW, "core", "beginner", 0, [12, 25], "Lie on your back, knees bent, hands by your head.|Curl your shoulders off the floor.|Lower slowly.", "Don't pull on your neck."),
  lib("bicycle_crunch", "Bicycle Crunch", ["core"], [], BW, "core", "beginner", 0, [16, 30], "Lie on your back, hands by your head, legs raised.|Bring one elbow towards the opposite knee while the other leg extends.|Alternate sides in a smooth pedalling motion.", "Keep your lower back pressed down."),
  lib("sit_up", "Sit-Up", ["core"], ["quads"], BW, "core", "beginner", 0, [10, 20], "Lie on your back, knees bent, feet flat.|Curl all the way up to sit tall.|Lower with control.", "Don't yank on your neck — cross your arms instead."),
  lib("lying_leg_raise", "Lying Leg Raise", ["core"], ["quads"], BW, "core", "intermediate", 0, [8, 15], "Lie on your back with your legs straight and hands under your hips.|Raise your legs until they point to the ceiling.|Lower slowly without letting your back arch.", "Bend your knees if your lower back lifts."),
  lib("hanging_knee_raise", "Hanging Knee Raise", ["core"], ["forearms", "quads"], BAR, "core", "intermediate", 0, [8, 15], "Hang from a bar with straight arms.|Raise your knees towards your chest.|Lower slowly without swinging.", "Control the lift — don't swing."),
  lib("russian_twist", "Russian Twist", ["core"], ["quads"], [["bodyweight"], ["dumbbells"]], "core", "intermediate", 2, [12, 24], "Sit with your knees bent and lean back slightly, feet raised or down.|Rotate your torso to tap the floor beside each hip.|Keep your chest tall.", "Keep your back long, not rounded."),
  lib("mountain_climber", "Mountain Climber", ["core", "quads"], ["shoulders", "chest"], BW, "conditioning", "beginner", 0, [20, 40], "Start in a high plank, hands under your shoulders.|Drive one knee towards your chest then switch quickly.|Keep your hips level.", "Slow down if your hips bounce."),
  lib("dead_bug", "Dead Bug", ["core"], ["quads"], BW, "core", "beginner", 0, [8, 16], "Lie on your back with your arms up and knees bent over your hips.|Lower the opposite arm and leg towards the floor.|Return and switch sides.", "Keep your lower back pressed into the floor."),
  lib("bird_dog", "Bird Dog", ["core", "glutes"], ["back", "shoulders"], BW, "core", "beginner", 0, [8, 12], "Start on hands and knees, back flat.|Reach one arm forward and the opposite leg back.|Return and switch sides.", "Don't rotate your hips.", true),
  lib("cable_crunch", "Cable Crunch", ["core"], [], CABLE, "core", "intermediate", 2.5, [10, 15], "Kneel facing a high pulley with the rope by your head.|Curl your ribs towards your hips.|Return slowly.", "Move your spine, not your hips."),
  lib("pallof_press", "Pallof Press", ["core"], ["shoulders"], [["cable_machine"], ["resistance_bands"]], "core", "beginner", 2.5, [8, 12], "Stand side-on to a cable at chest height, handle at your chest.|Press the handle straight out and resist the pull.|Bring it back in.", "Stay square — don't let the cable turn you.", true),
  // Glutes
  lib("hip_thrust", "Hip Thrust", ["glutes"], ["hamstrings", "core"], [["barbell", "bench"], ["dumbbells", "bench"]], "hinge", "intermediate", 5, [6, 12], "Sit with your upper back against a bench, weight across your hips.|Drive through your heels to lift your hips until your torso is level.|Pause, then lower slowly.", "Tuck your chin and don't over-arch your lower back."),
  lib("single_leg_glute_bridge", "Single-Leg Glute Bridge", ["glutes"], ["hamstrings", "core"], BW, "hinge", "intermediate", 0, [8, 15], "Lie on your back, one foot flat, the other leg raised.|Drive through your heel to lift your hips.|Lower slowly and swap legs.", "Keep your hips level.", true),
  lib("donkey_kick", "Donkey Kick", ["glutes"], ["hamstrings", "core"], BW, "isolation", "beginner", 0, [12, 20], "Start on hands and knees, back flat.|Kick one heel up towards the ceiling.|Lower slowly and repeat.", "Don't arch your lower back.", true),
  lib("fire_hydrant", "Fire Hydrant", ["glutes"], ["core"], BW, "isolation", "beginner", 0, [12, 20], "Start on hands and knees, back flat.|Lift one knee out to the side without rotating.|Lower slowly.", "Keep your hips level.", true),
  lib("cable_kickback", "Cable Kickback", ["glutes"], ["hamstrings"], CABLE, "isolation", "intermediate", 2.5, [10, 15], "Attach an ankle strap to the low pulley and face the machine.|Kick your leg straight back.|Return slowly.", "Don't swing your torso.", true),
  lib("step_up", "Step-Up", ["glutes", "quads"], ["hamstrings", "calves"], [["bench"], ["bench", "dumbbells"]], "lunge", "beginner", 2, [8, 12], "Stand facing a sturdy bench, one foot on top.|Drive through that heel to stand up on the bench.|Lower under control and repeat.", "Use a bench that can't tip or slide.", true),
  lib("banded_lateral_walk", "Banded Lateral Walk", ["glutes"], ["quads"], BAND, "isolation", "beginner", 0, [12, 24], "Place a band above your knees and sit into a quarter squat.|Step sideways, keeping tension on the band.|Take the same number of steps back.", "Keep your knees pushed out."),
  // Quads
  lib("front_squat", "Front Squat", ["quads", "glutes"], ["core"], [["barbell", "squat_rack"]], "squat", "advanced", 5, [4, 8], "Rest the bar on your front shoulders, elbows high.|Squat down keeping your torso upright.|Drive up through your whole foot.", "Always set safety bars at the right height."),
  lib("sumo_squat", "Sumo Squat", ["quads", "glutes"], ["hamstrings", "core"], [["dumbbells"], ["kettlebell"]], "squat", "beginner", 2, [8, 12], "Stand wider than your shoulders with toes turned out, weight held between your legs.|Squat down, knees tracking over your toes.|Stand by squeezing your glutes.", "Keep your chest up."),
  lib("bulgarian_split_squat", "Bulgarian Split Squat", ["quads", "glutes"], ["hamstrings", "core"], [["bench"], ["bench", "dumbbells"]], "lunge", "intermediate", 2, [8, 12], "Rest the top of your back foot on a bench behind you.|Lower straight down until your front thigh is parallel.|Drive up through your front heel.", "Hold a support if you need balance.", true),
  lib("reverse_lunge", "Reverse Lunge", ["quads", "glutes"], ["hamstrings", "core"], [["bodyweight"], ["dumbbells"], ["kettlebell"]], "lunge", "beginner", 2, [8, 12], "Stand tall, then step one foot back.|Lower until both knees are about 90°.|Push through your front foot to stand.", "Keep your front knee over your ankle.", true),
  lib("walking_lunge", "Walking Lunge", ["quads", "glutes"], ["hamstrings", "core"], [["bodyweight"], ["dumbbells"], ["kettlebell"]], "lunge", "intermediate", 2, [10, 20], "Step forward into a lunge.|Push off the back foot and step through into the next lunge.|Keep walking, alternating legs.", "Clear a safe path and keep your torso upright.", true),
  lib("leg_press", "Leg Press", ["quads", "glutes"], ["hamstrings", "calves"], MACHINE, "squat", "beginner", 5, [8, 15], "Sit with your feet shoulder-width apart on the platform.|Lower the sled until your knees are about 90°.|Press back up without locking out hard.", "Never let your lower back round off the pad."),
  lib("leg_extension", "Leg Extension", ["quads"], [], MACHINE, "isolation", "beginner", 2.5, [10, 15], "Sit with the pad on your lower shins and your back supported.|Straighten your legs fully.|Lower slowly.", "Don't swing the weight up."),
  lib("wall_sit", "Wall Sit", ["quads"], ["glutes", "calves"], BW, "squat", "beginner", 0, [20, 60], "Lean your back on a wall and slide down until your thighs are parallel.|Keep your knees over your ankles and hold for 20–60 seconds.|Slide back up.", "Stop if you feel sharp knee pain."),
  lib("jump_squat", "Jump Squat", ["quads", "glutes"], ["calves", "hamstrings"], BW, "conditioning", "intermediate", 0, [8, 15], "Squat down with your arms back.|Explode up into a jump.|Land softly and go straight into the next rep.", "Land softly with bent knees."),
  lib("hack_squat", "Hack Squat", ["quads", "glutes"], ["hamstrings"], MACHINE, "squat", "intermediate", 5, [8, 12], "Stand on the platform with your back on the pad.|Lower until your thighs are parallel.|Press back up.", "Keep your whole foot on the platform."),
  // Hamstrings
  lib("romanian_deadlift", "Romanian Deadlift", ["hamstrings", "glutes"], ["back", "core", "forearms"], BB, "hinge", "intermediate", 5, [6, 10], "Hold the bar at your thighs, knees soft.|Push your hips back, sliding the bar down your legs.|Stand tall by driving your hips forward.", "Keep the bar close and your back flat."),
  lib("dumbbell_romanian_deadlift", "Dumbbell Romanian Deadlift", ["hamstrings", "glutes"], ["back", "core", "forearms"], [["dumbbells"], ["kettlebell"]], "hinge", "beginner", 2, [8, 12], "Hold a weight in each hand at your thighs, knees soft.|Push your hips back and lower the weights along your legs.|Stand tall by driving your hips forward.", "Keep your back flat throughout."),
  lib("leg_curl", "Leg Curl", ["hamstrings"], ["calves"], MACHINE, "isolation", "beginner", 2.5, [10, 15], "Adjust the pad to sit just above your heels.|Curl your heels towards your glutes.|Lower slowly.", "Don't lift your hips off the pad."),
  lib("good_morning", "Good Morning", ["hamstrings", "glutes"], ["back", "core"], BB, "hinge", "advanced", 2.5, [6, 10], "Rest the bar on your upper back, knees soft.|Push your hips back until your torso is nearly parallel to the floor.|Stand back up.", "Use a light load and never round your back."),
  lib("single_leg_deadlift", "Single-Leg Deadlift", ["hamstrings", "glutes"], ["back", "core"], [["bodyweight"], ["dumbbells"], ["kettlebell"]], "hinge", "intermediate", 2, [8, 12], "Stand on one leg with a soft knee.|Hinge forward as the other leg lifts behind you.|Return to standing and repeat.", "Hold a support if you need balance.", true),
  lib("kettlebell_swing", "Kettlebell Swing", ["glutes", "hamstrings"], ["core", "back", "shoulders"], KB, "conditioning", "intermediate", 4, [10, 20], "Stand with the kettlebell just in front of your feet.|Hike it back, then snap your hips forward to swing it to chest height.|Let it fall and hinge again.", "The power comes from your hips, not your arms."),
  lib("sumo_deadlift", "Sumo Deadlift", ["glutes", "quads", "hamstrings"], ["back", "core", "forearms"], BB, "hinge", "intermediate", 5, [3, 8], "Stand wide with toes turned out, hands inside your knees.|Brace, push the floor apart and stand tall.|Lower under control.", "Never round your lower back under load."),
  // Calves
  lib("standing_calf_raise", "Standing Calf Raise", ["calves"], [], [["bodyweight"], ["dumbbells"]], "calf_raise", "beginner", 2, [12, 20], "Stand tall, balls of your feet on the floor or a step.|Rise as high as you can on your toes.|Lower slowly.", "Hold a support for balance."),
  lib("seated_calf_raise", "Seated Calf Raise", ["calves"], [], MACHINE, "calf_raise", "beginner", 2.5, [12, 20], "Sit with the pads on your lower thighs and the balls of your feet on the plate.|Press up as high as you can.|Lower to a full stretch.", "Control the stretch at the bottom."),
  lib("single_leg_calf_raise", "Single-Leg Calf Raise", ["calves"], [], BW, "calf_raise", "beginner", 0, [10, 15], "Stand on one foot, holding a support.|Rise onto your toes.|Lower slowly.", "Keep your standing knee soft.", true),
  // Full body
  lib("burpee", "Burpee", ["quads", "chest", "core"], ["shoulders", "triceps", "glutes"], BW, "conditioning", "intermediate", 0, [8, 15], "From standing, squat and place your hands on the floor.|Jump your feet back, do a push-up, then jump them in.|Jump up with your arms overhead.", "Step back instead of jumping if you need to."),
  lib("thruster", "Thruster", ["quads", "glutes", "shoulders"], ["triceps", "core"], [["dumbbells"], ["barbell"]], "conditioning", "intermediate", 2, [6, 12], "Hold the weight at your shoulders and squat down.|Drive up and press the weight overhead in one motion.|Lower to your shoulders and go into the next squat.", "Keep your core braced and don't lean back."),
  lib("kettlebell_clean_and_press", "Kettlebell Clean and Press", ["shoulders", "glutes"], ["triceps", "hamstrings", "core", "back"], KB, "conditioning", "intermediate", 2, [6, 10], "Hinge and swing the kettlebell up to your shoulder.|Press it overhead until your arm is straight.|Lower to your shoulder, then back to the start.", "Start light and keep your wrist straight.", true),
  lib("jumping_jack", "Jumping Jack", ["calves", "shoulders"], ["quads", "core"], BW, "conditioning", "beginner", 0, [20, 40], "Stand with your feet together and arms down.|Jump your feet apart as your arms swing overhead.|Jump back to the start.", "Land softly."),
  lib("bear_crawl", "Bear Crawl", ["shoulders", "core"], ["chest", "quads", "triceps"], BW, "conditioning", "beginner", 0, [10, 20], "Start on hands and toes with your knees just off the floor.|Crawl forward by moving opposite hand and foot together.|Keep your back flat.", "Keep your hips low and level."),
];

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
  ...LIBRARY,
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
