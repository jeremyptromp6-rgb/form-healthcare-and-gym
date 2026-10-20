import { describe, expect, it } from "vitest";
import {
  activeDurationMinutes,
  canPerform,
  EXERCISE_BY_ID,
  EXERCISES,
  exerciseAnalyzer,
  FOCUS_AREAS,
  FOCUS_MUSCLES,
  isRankBumpNote,
  jointAngleDeg,
  liveRepCounter,
  normalizeFocusAreas,
  PROFILE_LIMITS,
  rankTierFor,
  MovementStateMachine,
  repVerifier,
  restRemainingSeconds,
  ROM_SPECS,
  romAnalyzer,
  ruleBasedGenerator,
  formAnalyzer,
  verifyReps,
  type AngleSample,
  type GenerationInput,
  type PoseKeypoint,
} from "../src";

describe("exercise library", () => {
  it("includes the required starter exercises with full metadata", () => {
    for (const id of ["bodyweight_squat", "push_up", "bicep_curl", "lunge"]) {
      const e = EXERCISE_BY_ID.get(id)!;
      expect(e, id).toBeDefined();
      expect(e.primaryMuscles.length).toBeGreaterThan(0);
      expect(e.instructions.length).toBeGreaterThan(1);
      expect(e.safety.length).toBeGreaterThan(0);
      expect(e.targetReps.min).toBeLessThan(e.targetReps.max);
    }
    expect(EXERCISE_BY_ID.get("bodyweight_squat")!.name).toBe("Bodyweight Squat");
  });

  it("covers the whole body with a wide, well-formed library", () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(100);
    const trained = new Set(EXERCISES.flatMap((e) => e.primaryMuscles));
    for (const m of ["chest", "back", "lats", "shoulders", "traps", "biceps", "triceps", "forearms", "core", "glutes", "quads", "hamstrings", "calves"]) {
      expect(trained.has(m as never), m).toBe(true);
    }
    for (const e of EXERCISES) {
      expect(e.id, e.id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
      expect(e.instructions.length, e.id).toBeGreaterThan(1);
      expect(e.safety.length, e.id).toBeGreaterThan(0);
      expect(e.targetReps.min, e.id).toBeLessThan(e.targetReps.max);
      expect(e.primaryMuscles.length, e.id).toBeGreaterThan(0);
      expect(e.secondaryMuscles.filter((m) => e.primaryMuscles.includes(m)), e.id).toEqual([]);
      expect(e.loadable, e.id).toBe(e.loadIncrementKg > 0);
      expect(e.equipment.length, e.id).toBeGreaterThan(0);
    }
    // The original library keeps its ids.
    for (const id of ["bodyweight_squat", "push_up", "bicep_curl", "lunge", "glute_bridge", "goblet_squat", "squat", "deadlift", "bench_press", "overhead_press", "row", "band_row", "cable_row", "lat_pulldown", "pull_up"]) {
      expect(EXERCISE_BY_ID.has(id), id).toBe(true);
    }
  });

  it("claims camera support only where ROM rules exist, with a visibility setup", () => {
    for (const e of EXERCISES) {
      expect(e.cameraVerifiable, e.id).toBe(e.id in ROM_SPECS);
      if (e.cameraVerifiable) expect(e.camera!.setup).toMatch(/frame/);
    }
    expect(EXERCISES.filter((e) => e.cameraVerifiable).map((e) => e.id).sort()).toEqual(Object.keys(ROM_SPECS).sort());
  });

  it("has unique ids and gym equipment coverage", () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    const needsGym = EXERCISES.filter((e) => !canPerform(e, []));
    expect(needsGym.map((e) => e.id)).toEqual(expect.arrayContaining(["squat", "bench_press", "lat_pulldown"]));
  });

  it("checks equipment alternatives, including all-of requirements", () => {
    const squat = EXERCISE_BY_ID.get("squat")!; // barbell AND rack
    expect(canPerform(squat, ["barbell"])).toBe(false);
    expect(canPerform(squat, ["barbell", "squat_rack"])).toBe(true);
    const curl = EXERCISE_BY_ID.get("bicep_curl")!; // any of dumbbells / bands / ...
    expect(canPerform(curl, ["resistance_bands"])).toBe(true);
    expect(canPerform(curl, [])).toBe(false);
    expect(canPerform(EXERCISE_BY_ID.get("push_up")!, [])).toBe(true);
  });
});

describe("workout generator (rule-based v1)", () => {
  const base: GenerationInput = {
    date: "2026-09-28",
    goal: "build_muscle",
    experience: "beginner",
    equipment: ["bodyweight"],
    trainingDaysPerWeek: 3,
    sessionsThisWeek: 0,
    daysSinceLastWorkout: null,
    recentSeriousPain: false,
    previous: {},
  };
  const ids = (input: GenerationInput) => ruleBasedGenerator.generate(input).exercises.map((e) => e.exerciseId);

  it("builds a full-body bodyweight session from what the user can do", () => {
    const plan = ruleBasedGenerator.generate(base);
    expect(plan.focus).toBe("full_body");
    expect(plan.generator).toEqual({ id: "rule_based", version: 1 });
    for (const e of plan.exercises) expect(canPerform(EXERCISE_BY_ID.get(e.exerciseId)!, ["bodyweight"])).toBe(true);
    expect(ids(base)).toEqual(expect.arrayContaining(["bodyweight_squat", "push_up"]));
    expect(new Set(ids(base)).size).toBe(plan.exercises.length);
    expect(plan.estimatedMinutes).toBeGreaterThanOrEqual(10);
  });

  it("uses gym equipment when available, and only movements suited to the user's experience", () => {
    const gym = { ...base, equipment: ["barbell", "squat_rack", "bench", "dumbbells", "cable_machine", "machines"] as GenerationInput["equipment"] };
    expect(ids(gym)).not.toContain("squat"); // intermediate lift, beginner user
    expect(ids({ ...gym, experience: "intermediate", goal: "get_stronger" })).toContain("squat");
  });

  it("sets reps, sets and rest by goal", () => {
    const withDb = { ...base, equipment: ["dumbbells"] as GenerationInput["equipment"], experience: "intermediate" as const };
    const loaded = (goal: GenerationInput["goal"]) => ruleBasedGenerator.generate({ ...withDb, goal }).exercises.find((e) => EXERCISE_BY_ID.get(e.exerciseId)!.loadable)!;
    expect(loaded("get_stronger")).toMatchObject({ targetReps: { min: 4, max: 6 }, sets: 4, restSeconds: 150 });
    expect(loaded("build_muscle")).toMatchObject({ targetReps: { min: 8, max: 12 }, sets: 3, restSeconds: 90 });
    expect(loaded("lose_fat")).toMatchObject({ targetReps: { min: 10, max: 15 }, restSeconds: 60 });
  });

  it("splits upper/lower for 4+ days a week, alternating by sessions done", () => {
    const four = { ...base, trainingDaysPerWeek: 4, equipment: ["dumbbells", "bench", "pull_up_bar"] as GenerationInput["equipment"], experience: "intermediate" as const };
    expect(ruleBasedGenerator.generate({ ...four, sessionsThisWeek: 0 }).focus).toBe("lower");
    expect(ruleBasedGenerator.generate({ ...four, sessionsThisWeek: 1 }).focus).toBe("upper");
  });

  describe("focus areas", () => {
    const gym = {
      ...base,
      trainingDaysPerWeek: 4,
      experience: "intermediate" as const,
      equipment: ["bodyweight", "dumbbells", "barbell", "bench", "squat_rack", "cable_machine", "machines", "pull_up_bar"] as GenerationInput["equipment"],
    };
    const primary = (input: GenerationInput, muscles: string[]) =>
      ruleBasedGenerator.generate(input).exercises.filter((e) => EXERCISE_BY_ID.get(e.exerciseId)!.primaryMuscles.some((m) => muscles.includes(m))).length;

    it("changes nothing without a focus, or with full body", () => {
      const plain = ruleBasedGenerator.generate(gym);
      for (const focusAreas of [null, [], ["full_body"]] as GenerationInput["focusAreas"][]) {
        expect(ruleBasedGenerator.generate({ ...gym, focusAreas })).toEqual(plain);
      }
    });

    it("leads with the focus side two sessions in three and still trains the other half", () => {
      const focusOf = (n: number, focusAreas: GenerationInput["focusAreas"], days = 4) => ruleBasedGenerator.generate({ ...gym, trainingDaysPerWeek: days, focusAreas, sessionsThisWeek: n }).focus;
      expect([0, 1, 2].map((n) => focusOf(n, ["chest"]))).toEqual(["upper", "lower", "upper"]);
      expect([0, 1, 2].map((n) => focusOf(n, ["glutes"]))).toEqual(["lower", "upper", "lower"]);
      // Three days: the middle session stays full body, so legs are never dropped.
      expect([0, 1, 2].map((n) => focusOf(n, ["chest"], 3))).toEqual(["upper", "full_body", "upper"]);
      // A focus on both halves keeps the plain alternation.
      expect([0, 1].map((n) => focusOf(n, ["chest", "legs"]))).toEqual(["lower", "upper"]);
    });

    it("weights a session towards the chosen muscles", () => {
      const upper = { ...gym, sessionsThisWeek: 0 };
      const chestPlan = ruleBasedGenerator.generate({ ...upper, focusAreas: ["chest"] });
      expect(chestPlan.focus).toBe("upper");
      expect(chestPlan.title).toContain("Chest focus");
      expect(primary({ ...upper, focusAreas: ["chest"] }, ["chest"])).toBeGreaterThan(primary(upper, ["chest"]));
      expect(chestPlan.exercises.length).toBeGreaterThan(ruleBasedGenerator.generate(upper).exercises.length);
      const lower = { ...gym, sessionsThisWeek: 0 };
      expect(ruleBasedGenerator.generate({ ...lower, focusAreas: ["glutes"] }).focus).toBe("lower");
      expect(primary({ ...lower, focusAreas: ["glutes"] }, ["glutes"])).toBeGreaterThanOrEqual(primary(lower, ["glutes"]));
      expect(primary({ ...lower, focusAreas: ["glutes"] }, ["glutes"])).toBeGreaterThanOrEqual(2);
    });

    it("never puts a leg-focus movement on an upper day", () => {
      const plan = ruleBasedGenerator.generate({ ...gym, sessionsThisWeek: 1, focusAreas: ["legs"], trainingDaysPerWeek: 5 });
      // Sessions 0 and 1 of a leg focus: lower then upper; the upper day has no focus extras and stays upper-body.
      expect(plan.focus).toBe("upper");
      expect(plan.title).not.toContain("focus");
    });

    it("validates the choice: up to three, de-duplicated, full body alone", () => {
      expect(normalizeFocusAreas(["chest", "chest", "back"])).toEqual(["chest", "back"]);
      expect(normalizeFocusAreas(["full_body"])).toEqual(["full_body"]);
      expect(() => normalizeFocusAreas([])).toThrow();
      expect(() => normalizeFocusAreas(["chest", "back", "arms", "core"])).toThrow(`up to ${PROFILE_LIMITS.focusAreasMax}`);
      expect(() => normalizeFocusAreas(["full_body", "chest"])).toThrow();
    });

    it("maps every offered area to muscles that exist in the library", () => {
      const muscles = new Set(EXERCISES.flatMap((e) => [...e.primaryMuscles, ...e.secondaryMuscles]));
      for (const a of FOCUS_AREAS) {
        if (a.key === "full_body") expect(FOCUS_MUSCLES[a.key]).toEqual([]);
        else expect(FOCUS_MUSCLES[a.key].some((m) => muscles.has(m))).toBe(true);
      }
    });

    it("is deterministic and keeps variety within the focus", () => {
      const input = { ...gym, focusAreas: ["chest", "back", "arms"] as GenerationInput["focusAreas"] };
      const a = ruleBasedGenerator.generate(input);
      expect(a).toEqual(ruleBasedGenerator.generate(input));
      expect(new Set(a.exercises.map((e) => e.exerciseId)).size).toBe(a.exercises.length);
    });
  });

  it("progresses from previous performance: load up when every set hit the top", () => {
    const input = { ...base, equipment: ["dumbbells"] as GenerationInput["equipment"] };
    const firstLoaded = ruleBasedGenerator.generate(input).exercises.find((e) => EXERCISE_BY_ID.get(e.exerciseId)!.loadable)!;
    expect(firstLoaded).toMatchObject({ progression: "new", targetLoadKg: null });
    const id = firstLoaded.exerciseId;
    const inc = EXERCISE_BY_ID.get(id)!.loadIncrementKg;
    const withHistory = (reps: number[]) => ({ ...input, previous: { [id]: { localDate: "2026-09-26", painLevel: "none" as const, averageRomPercent: null, sets: reps.map((r) => ({ reps: r, loadKg: 10 })) } } });
    const find = (i: GenerationInput) => ruleBasedGenerator.generate(i).exercises.find((e) => e.exerciseId === id)!;
    expect(find(withHistory([12, 12, 12]))).toMatchObject({ progression: "increase_load", targetLoadKg: 10 + inc });
    expect(find(withHistory([12, 10, 9]))).toMatchObject({ progression: "repeat", targetLoadKg: 10 });
  });

  it("adds reps rather than load for bodyweight movements", () => {
    const top = EXERCISE_BY_ID.get("push_up")!.targetReps.max;
    const p = ruleBasedGenerator
      .generate({ ...base, previous: { push_up: { localDate: "2026-09-26", painLevel: "none", averageRomPercent: null, sets: [{ reps: top, loadKg: 0 }] } } })
      .exercises.find((e) => e.exerciseId === "push_up")!;
    expect(p).toMatchObject({ progression: "increase_reps", targetLoadKg: null, targetReps: { min: 8, max: top + 2 } });
  });

  it("never progresses after pain, a long break, or short range of motion — and deloads never round back up", () => {
    const input = { ...base, equipment: ["dumbbells"] as GenerationInput["equipment"], goal: "improve_fitness" as const };
    const id = ruleBasedGenerator.generate(input).exercises.find((e) => EXERCISE_BY_ID.get(e.exerciseId)!.loadable)!.exerciseId;
    const step = EXERCISE_BY_ID.get(id)!.loadIncrementKg;
    const hist = (over: object) => ({ [id]: { localDate: "2026-09-20", painLevel: "none" as const, averageRomPercent: null, sets: [{ reps: 15, loadKg: 10 }], ...over } });
    const find = (i: GenerationInput) => ruleBasedGenerator.generate(i).exercises.find((e) => e.exerciseId === id)!;
    const afterPain = find({ ...input, previous: hist({ painLevel: "serious" }) });
    const afterBreak = find({ ...input, daysSinceLastWorkout: 20, previous: hist({}) });
    expect(afterPain).toMatchObject({ progression: "deload", targetLoadKg: Math.floor(8 / step) * step });
    expect(afterBreak).toMatchObject({ progression: "deload" });
    expect(afterBreak.targetLoadKg!).toBeLessThan(10); // regression: 10 × 0.9 with a 2.5 kg step used to round back to 10
    expect(find({ ...input, previous: hist({ averageRomPercent: 70 }) })).toMatchObject({ progression: "hold_for_rom", targetLoadKg: 10 });
    const pain = ruleBasedGenerator.generate({ ...input, recentSeriousPain: true });
    expect(pain.exercises.every((e) => e.sets === 2)).toBe(true);
    expect(pain.notes.join(" ")).toMatch(/serious pain/);
  });

  it("is deterministic", () => {
    expect(ruleBasedGenerator.generate(base)).toEqual(ruleBasedGenerator.generate(base));
  });
});

describe("rank-scaled difficulty", () => {
  const gym = ["barbell", "squat_rack", "bench", "dumbbells", "cable_machine", "machines"] as GenerationInput["equipment"];
  const base: GenerationInput = {
    date: "2026-09-28",
    goal: "build_muscle",
    experience: "intermediate",
    equipment: gym,
    trainingDaysPerWeek: 3,
    sessionsThisWeek: 0,
    daysSinceLastWorkout: 2,
    recentSeriousPain: false,
    previous: {},
  };
  const at = (rankTier: number | null, over: Partial<GenerationInput> = {}) => ruleBasedGenerator.generate({ ...base, ...over, rankTier });
  const [ROOKIE, STARTER, ATHLETE, IRON, ELITE, MASTER, CHAMPION] = [0, 1, 2, 3, 4, 5, 6];
  const topReps = (tier: number | null, over: Partial<GenerationInput> = {}) => at(tier, over).exercises.map((e) => e.targetReps.max);
  const totalSets = (tier: number | null, over: Partial<GenerationInput> = {}) => at(tier, over).exercises.reduce((a, e) => a + e.sets, 0);

  it("changes nothing without rank info or at Rookie", () => {
    const plain = ruleBasedGenerator.generate(base);
    expect(at(null)).toEqual(plain);
    expect(at(ROOKIE)).toEqual(plain);
    expect(plain.notes.some(isRankBumpNote)).toBe(false);
  });

  it("raises rep ceilings by one per tier up to +3, and the same exercises are planned", () => {
    const r = topReps(ROOKIE);
    expect(topReps(STARTER)).toEqual(r.map((x) => x + 1));
    expect(topReps(ATHLETE)).toEqual(r.map((x) => x + 2));
    expect(topReps(IRON)).toEqual(r.map((x) => x + 3));
    for (const tier of [ELITE, MASTER, CHAMPION, 20, 99]) expect(topReps(tier)).toEqual(topReps(IRON));
    expect(at(IRON).exercises.map((e) => e.exerciseId)).toEqual(at(ROOKIE).exercises.map((e) => e.exerciseId));
    expect(at(ATHLETE).notes.find(isRankBumpNote)).toMatch(/^Athlete rank: \+2 reps/);
  });

  it("adds one set on main lifts from Iron, never above 4 sets (5 advanced), identical at Champion and beyond", () => {
    expect(totalSets(ATHLETE)).toBe(totalSets(ROOKIE));
    expect(totalSets(IRON)).toBeGreaterThan(totalSets(ROOKIE));
    const rookie = at(ROOKIE).exercises;
    for (const [i, e] of at(IRON).exercises.entries()) {
      expect(e.sets - rookie[i]!.sets).toBeLessThanOrEqual(1);
      expect(e.sets).toBeLessThanOrEqual(4);
    }
    expect(at(CHAMPION).exercises).toEqual(at(IRON).exercises);
    expect(at(99).exercises).toEqual(at(CHAMPION).exercises);
    for (const e of at(CHAMPION, { experience: "advanced", goal: "get_stronger" }).exercises) expect(e.sets).toBeLessThanOrEqual(5);
    for (const e of at(CHAMPION, { goal: "get_stronger" }).exercises) expect(e.sets).toBeLessThanOrEqual(4);
  });

  it("keeps heavy strength rep ranges to +1 and never bumps hold exercises", () => {
    for (const e of at(CHAMPION, { goal: "get_stronger" }).exercises) {
      const base = EXERCISE_BY_ID.get(e.exerciseId)!.loadable ? 6 : EXERCISE_BY_ID.get(e.exerciseId)!.targetReps.max;
      expect(e.targetReps.max).toBeLessThanOrEqual(base + (base <= 6 ? 1 : 3));
    }
    const bodyweight = { equipment: ["bodyweight"] as GenerationInput["equipment"], focusAreas: ["core"] as GenerationInput["focusAreas"] };
    const holds = (tier: number) => at(tier, bodyweight).exercises.filter((e) => EXERCISE_BY_ID.get(e.exerciseId)!.targetReps.max >= 30);
    expect(holds(CHAMPION)).toEqual(holds(ROOKIE));
  });

  it("suppresses the bump for beginners, serious pain, a long break and unknown experience", () => {
    const rookie = (over: Partial<GenerationInput>) => at(ROOKIE, over);
    for (const over of [{ experience: "beginner" as const }, { experience: null }, { recentSeriousPain: true }, { daysSinceLastWorkout: 20 }]) {
      const plan = at(CHAMPION, over);
      expect(plan.exercises).toEqual(rookie(over).exercises);
      expect(plan.notes.some(isRankBumpNote)).toBe(false);
    }
  });

  it("leaves deloads and holds alone", () => {
    const squat = at(ROOKIE).exercises[0]!;
    const previous = { [squat.exerciseId]: { localDate: "2026-09-26", painLevel: "serious" as const, sets: [{ reps: 8, loadKg: 60 }], averageRomPercent: null } };
    const withPain = at(CHAMPION, { previous }).exercises.find((e) => e.exerciseId === squat.exerciseId)!;
    expect(withPain.progression).toBe("deload");
    expect(withPain).toEqual(at(ROOKIE, { previous }).exercises.find((e) => e.exerciseId === squat.exerciseId));
    const lowRom = { [squat.exerciseId]: { localDate: "2026-09-26", painLevel: "none" as const, sets: [{ reps: 8, loadKg: 60 }], averageRomPercent: 60 } };
    const held = at(CHAMPION, { previous: lowRom }).exercises.find((e) => e.exerciseId === squat.exerciseId)!;
    expect(held.progression).toBe("hold_for_rom");
    expect(held).toEqual(at(ROOKIE, { previous: lowRom }).exercises.find((e) => e.exerciseId === squat.exerciseId));
  });

  it("drops the extra set rather than exceed the session length", () => {
    const roomy = at(IRON, { sessionMinutes: 120 });
    expect(roomy.exercises.reduce((a, e) => a + e.sets, 0)).toBeGreaterThan(totalSets(ROOKIE));
    const tight = at(IRON, { sessionMinutes: 5 });
    expect(tight.exercises.map((e) => e.sets)).toEqual(at(ROOKIE).exercises.map((e) => e.sets));
    expect(tight.notes.find(isRankBumpNote)).not.toMatch(/set/);
    expect(at(IRON, { sessionMinutes: roomy.estimatedMinutes - 1 }).estimatedMinutes).toBeLessThanOrEqual(roomy.estimatedMinutes);
  });

  it("takes a slightly bigger load step only from Master, and only up to 5% of the last load", () => {
    const squat = at(ROOKIE).exercises.find((e) => EXERCISE_BY_ID.get(e.exerciseId)!.loadable)!;
    const ex = EXERCISE_BY_ID.get(squat.exerciseId)!;
    const next = (tier: number, loadKg: number) => {
      const previous = { [ex.id]: { localDate: "2026-09-26", painLevel: "none" as const, sets: [{ reps: 99, loadKg }, { reps: 99, loadKg }], averageRomPercent: null } };
      return at(tier, { previous }).exercises.find((e) => e.exerciseId === ex.id)!.targetLoadKg!;
    };
    const heavy = ex.loadIncrementKg * 60; // the doubled step is well under 5%
    const light = ex.loadIncrementKg * 4; // doubled step would be 50%
    expect(next(ROOKIE, heavy)).toBe(heavy + ex.loadIncrementKg);
    expect(next(ELITE, heavy)).toBe(heavy + ex.loadIncrementKg);
    expect(next(MASTER, heavy)).toBe(heavy + ex.loadIncrementKg * 2);
    expect(next(CHAMPION, heavy) - heavy).toBeLessThanOrEqual(heavy * 0.05);
    expect(next(CHAMPION, light)).toBe(light + ex.loadIncrementKg);
  });

  it("is deterministic and pure", () => {
    expect(at(IRON)).toEqual(at(IRON));
    expect(rankTierFor("Iron")).toBe(3);
    expect(rankTierFor("Champion")).toBe(6);
    expect(rankTierFor("nope")).toBeNull();
  });
});

describe("camera contracts", () => {
  it("computes joint angles from keypoints", () => {
    expect(jointAngleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })).toBeCloseTo(180);
    expect(jointAngleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(90);
    expect(jointAngleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it("builds analyzers only for camera-supported exercises, and ignores low-confidence joints", () => {
    expect(exerciseAnalyzer("deadlift")).toBeNull();
    const a = exerciseAnalyzer("bodyweight_squat")!;
    const kp = (conf: number): PoseKeypoint[] => [
      { name: "left_hip", x: 0, y: 0, confidence: conf },
      { name: "left_knee", x: 0, y: 1, confidence: conf },
      { name: "left_ankle", x: 1, y: 1, confidence: conf },
    ];
    expect(a.sample(kp(0.9), 100)).toMatchObject({ tMs: 100, confidence: 0.9 });
    expect(a.sample(kp(0.9), 100)!.angleDeg).toBeCloseTo(90);
    expect(a.sample(kp(0.1), 100)).toBeNull();
  });

  it("the live state machine and the server verifier agree", () => {
    const spec = ROM_SPECS.bicep_curl;
    const samples: AngleSample[] = [];
    let t = 0;
    for (const bottom of [55, 90, 50]) {
      for (let i = 0; i <= 10; i++) {
        const phase = i <= 5 ? i / 5 : (10 - i) / 5;
        samples.push({ tMs: t, angleDeg: 160 - (160 - bottom) * phase, confidence: 0.9 });
        t += 150;
      }
    }
    const machine = new MovementStateMachine(spec);
    const events = samples.flatMap((s) => machine.push(s));
    expect(events.map((e) => e.type)).toEqual(["rep_verified", "rep_rejected", "rep_verified"]);
    const batch = verifyReps({ poseStatus: "ok", samples }, spec);
    expect(batch.reps).toEqual(machine.result().reps);
    expect(repVerifier.verify("bicep_curl", { poseStatus: "ok", samples })!.verifiedReps).toBe(2);
    expect(repVerifier.verify("deadlift", { poseStatus: "ok", samples })).toBeNull();
  });

  it("live counter turns keypoint frames into rep events", () => {
    const counter = liveRepCounter("push_up")!;
    const frame = (angle: number): PoseKeypoint[] => {
      const r = (angle * Math.PI) / 180;
      return [
        { name: "right_shoulder", x: 1, y: 0, confidence: 0.9 },
        { name: "right_elbow", x: 0, y: 0, confidence: 0.9 },
        { name: "right_wrist", x: Math.cos(r), y: Math.sin(r), confidence: 0.9 },
      ];
    };
    const angles = [170, 150, 120, 90, 90, 120, 150, 170];
    const events = angles.flatMap((a, i) => counter.push(frame(a), i * 200));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("rep_verified");
    expect(liveRepCounter("deadlift")).toBeNull();
  });

  it("summarises ROM and scores form only for camera exercises", () => {
    expect(romAnalyzer.analyze([])).toBeNull();
    expect(romAnalyzer.analyze([{ romPercent: 100 }, { romPercent: 80 }])).toEqual({
      averageRomPercent: 90,
      minRomPercent: 80,
      fullRangeShare: 0.5,
    });
    const rep = { index: 0, startMs: 0, bottomMs: 500, endMs: 1500, durationMs: 1500, minAngleDeg: 85, peakAngleDeg: 168, romPercent: 100 };
    expect(formAnalyzer.analyze("push_up", rep, [])).toMatchObject({ score: 100, perfect: true });
    expect(formAnalyzer.analyze("deadlift", rep, [])).toBeNull();
  });
});

describe("session timing", () => {
  const start = new Date("2026-09-28T10:00:00Z");
  it("excludes paused time, including an open pause", () => {
    expect(activeDurationMinutes({ startedAt: start, end: new Date("2026-09-28T10:45:00Z"), pausedMs: 10 * 60_000, pausedAt: null })).toBe(35);
    expect(activeDurationMinutes({ startedAt: start, end: new Date("2026-09-28T10:45:00Z"), pausedMs: 0, pausedAt: new Date("2026-09-28T10:30:00Z") })).toBe(30);
  });
  it("bounds durations", () => {
    expect(activeDurationMinutes({ startedAt: start, end: start, pausedMs: 0, pausedAt: null })).toBe(1);
    expect(activeDurationMinutes({ startedAt: start, end: new Date("2026-09-29T10:00:00Z"), pausedMs: 0, pausedAt: null })).toBe(600);
  });
  it("counts rest down", () => {
    expect(restRemainingSeconds(null, start)).toBeNull();
    expect(restRemainingSeconds(new Date("2026-09-28T10:01:30Z"), start)).toBe(90);
    expect(restRemainingSeconds(new Date("2026-09-28T09:59:00Z"), start)).toBe(0);
  });
});
