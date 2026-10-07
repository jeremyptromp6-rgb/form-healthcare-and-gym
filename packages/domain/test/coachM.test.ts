import { describe, expect, it } from "vitest";
import {
  buildCoachContext,
  buildNutritionContext,
  buildPersonalization,
  COACH_TOPICS,
  deterministicCoach,
  topicFromMessage,
  ungroundedNumbers,
  validateCoachOutput,
  type CoachContextInput,
  type RawCoachOutput,
} from "../src";
import { prefsFixture, profileFixture } from "./fixtures";

const TODAY = "2026-09-30"; // Wednesday

function input(over: Partial<CoachContextInput> = {}, opts: { profile?: Parameters<typeof profileFixture>[0]; prefs?: Parameters<typeof prefsFixture>[0] } = {}): CoachContextInput {
  const profile = profileFixture({ trainingDaysPerWeek: 3, ...opts.profile });
  return {
    now: { localDate: TODAY, localTime: "18:30", weekday: "Wednesday" },
    personalization: buildPersonalization({ asOf: TODAY, profile, preferences: prefsFixture(opts.prefs), goalHistory: [{ primaryGoal: profile.primaryGoal!, effectiveFrom: "2026-09-01" }] }),
    hasTargets: true,
    workouts: [
      {
        localDate: "2026-09-28",
        durationMinutes: 45,
        painLevel: "none",
        xp: 60,
        exercises: [{ exerciseId: "squat", name: "Barbell Back Squat", sets: 3, reps: 24, verifiedReps: 24, topLoadKg: 60, avgFormScore: 91, avgRomPercent: 97 }],
      },
      { localDate: "2026-09-21", durationMinutes: 30, painLevel: "none", xp: 35, exercises: [{ exerciseId: "push_up", name: "Push-up", sets: 2, reps: 20, verifiedReps: 0, topLoadKg: 0, avgFormScore: null, avgRomPercent: null }] },
    ],
    formIssues: [{ exerciseId: "squat", name: "Barbell Back Squat", code: "knee_alignment", cue: "Push your knees out over your toes.", count: 7 }],
    progression: { level: 4, rank: "Rookie", totalXp: 520, xpToNextLevel: 80, nextRank: { name: "Starter", minLevel: 5 }, trainWithinDays: 4, recovering: false },
    nutrition: buildNutritionContext({
      today: TODAY,
      days: [{ date: TODAY, totals: { entries: 2, kcal: 900, proteinG: 60, carbsG: 90, fatG: 30, estimatedKcalShare: 0, measuredKcalShare: 1 } as never }],
      targets: { targetKcal: 2600, proteinG: 160, carbsG: 300, fatG: 80, safeFloorKcal: 1800 } as never,
      water: { totalMl: 1000, targetMl: 2800 },
    }),
    bodyQuest: { stage: "foundation", overall: 46, stats: { strength: null, muscle: 30, endurance: 56, mobility: 97, form: 91, consistency: 68 }, nextStage: "builder", unmet: [{ kind: "weeks", needed: 4, have: 3 }] },
    records: [{ exercise: "Barbell Back Squat", label: "Heaviest weight", display: "60 kg", previousDisplay: "55 kg", localDate: "2026-09-28" }],
    achievements: { unlocked: ["First Workout"], next: { title: "Form Master", progress: 80, target: 100 } },
    streaks: { workout: { current: 1, longest: 6, plannedRestDays: 2 }, weekly: { current: 0, target: 3, metThisWeek: false }, nutrition: { current: 0, available: true }, quest: { current: 0 } },
    quests: [{ title: "Log 3 meals", cadence: "daily", progress: 2, target: 3, completed: false }],
    ...over,
  };
}

const raw = (over: Partial<RawCoachOutput>): RawCoachOutput => ({
  message: "Hello",
  category: "general",
  priority: "normal",
  evidence: [{ fact: "training.workoutsLast7Days", claim: "Workouts this week" }],
  actions: [],
  confidence: "medium",
  ...over,
});
const meta = { topic: "chat" as const, generatedAt: "2026-09-30T17:30:00Z", provider: { type: "real_ai" as const, name: "Claude" } };
const check = (ctx: ReturnType<typeof buildCoachContext>, over: Partial<RawCoachOutput>) => validateCoachOutput(raw(over), ctx, meta);
const reasons = (r: ReturnType<typeof validateCoachOutput>) => (r.ok ? [] : r.reasons.join(" "));

describe("CoachContextBuilder", () => {
  it("sends keyed facts from authoritative data and nothing identifying", () => {
    const ctx = buildCoachContext(input());
    expect(ctx.facts).toMatchObject({
      "training.workoutsLast7Days": 1,
      "training.workoutsLast28Days": 2,
      "training.doneThisWeek": 1,
      "training.plannedThisWeek": 3,
      "training.trainedToday": false,
      "training.daysSinceLastWorkout": 2,
      "form.averageScore": 91,
      "form.issues.0.cue": "Push your knees out over your toes.",
      "nutrition.today.proteinRemainingG": 100,
      "nutrition.targets.safeMinimumKcal": 1800,
      "progression.xpToNextLevel": 80,
      "bodyQuest.stats.mobility": 97,
      "records.0.value": "60 kg",
      "streaks.workout.longest": 6,
      "now.dayPart": "evening",
    });
    const json = JSON.stringify(ctx);
    expect(json).not.toMatch(/weightKg|heightCm|ageYears|email|password|token|u1|"80"/);
    expect(ctx.facts["bodyQuest.stats.strength"]).toBeUndefined(); // unmeasured stays unmeasured
    expect(ctx.safety).toMatchObject({ recovering: false, trainedToday: false, safeFloorKcal: 1800 });
  });

  it("carries allergies and diet restrictions as hard constraints, never dislikes", () => {
    const ctx = buildCoachContext(input({}, { prefs: { allergens: ["peanuts"], customAllergies: ["kiwi"], dietaryPreferences: ["vegetarian", "high_protein"], dislikedFoods: ["olives"] } }));
    expect(ctx.food).toEqual({ allergens: ["peanuts"], customAllergies: ["kiwi"], dietRestrictions: ["vegetarian"] });
    expect(JSON.stringify(ctx)).not.toMatch(/olives/);
  });

  it("flags minors, recent serious pain and rest days as safety facts", () => {
    const pain = buildCoachContext(input({ workouts: [{ localDate: "2026-09-29", durationMinutes: 20, painLevel: "serious", xp: 0, exercises: [] }] }, { profile: { ageYears: 16, primaryGoal: "lose_fat" } }));
    expect(pain.safety).toMatchObject({ isMinor: true, recovering: true });
    expect(pain.safety.notes.join(" ")).toMatch(/under 18.*|serious pain/);
    const trained = buildCoachContext(input({ workouts: [{ localDate: TODAY, durationMinutes: 40, painLevel: "none", xp: 40, exercises: [] }] }));
    expect(trained.safety.trainedToday).toBe(true);
  });
});

describe("hallucination and numeric controls", () => {
  const ctx = buildCoachContext(input());

  it("renders facts from the domain and rejects invented numbers", () => {
    const good = check(ctx, { message: "You've trained {{training.workoutsLast7Days}} time this week and have {{nutrition.today.proteinRemainingG}} g protein left." });
    expect(good.ok && good.response.message).toBe("You've trained 1 time this week and have 100 g protein left.");
    expect(reasons(check(ctx, { message: "You trained 5 times this week." }))).toMatch(/ungrounded_numbers/);
    expect(reasons(check(ctx, { message: "You've eaten 1,450 kcal today." }))).toMatch(/ungrounded_numbers/);
    expect(check(ctx, { message: "You've had 900 kcal so far." }).ok).toBe(true); // a literal that matches the fact is fine
    expect(reasons(check(ctx, { message: "Level {{progression.fake}} soon." }))).toMatch(/unknown_fact/);
  });

  it("allows bounded prescriptions and rejects out-of-range ones", () => {
    expect(ungroundedNumbers("Do 3 sets of 8 reps, rest 90 seconds, 20–30 g protein per meal.", ctx.facts)).toEqual([]);
    expect(ungroundedNumbers("Do 12 sets of 50 reps.", ctx.facts)).toEqual(["12 set", "50 rep"]);
    expect(ungroundedNumbers("Eat 1200 kcal.", ctx.facts)).toEqual(["1200 kcal"]);
  });

  it("requires real evidence and real data behind PR, streak, workout and nutrition claims", () => {
    expect(reasons(check(ctx, { evidence: [{ fact: "training.made_up", claim: "x" }] }))).toMatch(/unknown_evidence/);
    expect(reasons(check(ctx, { evidence: [] }))).toMatch(/no_evidence/);
    const noRecords = buildCoachContext(input({ records: [] }));
    expect(reasons(check(noRecords, { message: "You just set a new PR on squats!" }))).toMatch(/pr_claim_without_record/);
    expect(check(ctx, { message: "You set a new PR: {{records.0.value}}." }).ok).toBe(true);
    const noStreak = buildCoachContext(input({ streaks: { workout: { current: 0, longest: 0, plannedRestDays: 2 }, weekly: { current: 0, target: 3, metThisWeek: false }, nutrition: { current: 0, available: true }, quest: { current: 0 } } }));
    expect(reasons(check(noStreak, { message: "Keep your streak alive!" }))).toMatch(/streak_claim_without_streak/);
    expect(reasons(check(ctx, { message: "Great job, you trained today." }))).toMatch(/workout_claim_not_today/);
    const noFood = buildCoachContext(input({ nutrition: null }));
    expect(reasons(check(noFood, { message: "You've eaten well today." }))).toMatch(/nutrition_claim_without_logs/);
  });
});

describe("safety", () => {
  it("never lets a food that breaks an allergy or diet through", () => {
    const ctx = buildCoachContext(input({}, { prefs: { allergens: ["peanuts", "milk"], customAllergies: ["kiwi"], dietaryPreferences: ["vegan"] } }));
    for (const message of ["Try peanut butter on toast.", "Add Greek yogurt.", "A kiwi smoothie works.", "Grilled chicken is great.", "Scrambled eggs after training."]) {
      expect(reasons(check(ctx, { message }))).toMatch(/food_constraint/);
    }
    expect(check(ctx, { message: "A protein source you can eat at each meal gets you there." }).ok).toBe(true);
    expect(reasons(check(ctx, { evidence: [{ fact: "training.workoutsLast7Days", claim: "Peanut snacks help" }] }))).toMatch(/food_constraint/);
  });

  it("rejects starvation, restriction, dehydration, diagnosis and mental-state guesses", () => {
    const ctx = buildCoachContext(input());
    expect(reasons(check(ctx, { message: "Skip breakfast to speed things up." }))).toMatch(/unsafe_nutrition/);
    expect(reasons(check(ctx, { message: "Try intermittent fasting for a while." }))).toMatch(/unsafe_nutrition/);
    expect(reasons(check(ctx, { message: "Drink less water before weigh-in." }))).toMatch(/unsafe_hydration/);
    expect(reasons(check(ctx, { message: "You might have patellar tendinitis." }))).toMatch(/medical_diagnosis/);
    expect(reasons(check(ctx, { message: "You seem unmotivated lately." }))).toMatch(/mental_state_inference/);
    expect(reasons(check(ctx, { message: "See https://example.com" }))).toMatch(/link_or_contact/);
    const minor = buildCoachContext(input({}, { profile: { ageYears: 16, primaryGoal: "lose_fat" } }));
    expect(reasons(check(minor, { message: "A small calorie deficit will help." }))).toMatch(/weight_loss_advice_not_allowed/);
  });

  it("rejects dangerous progression and allows small, earned steps", () => {
    const ctx = buildCoachContext(input());
    expect(reasons(check(ctx, { message: "Next time add 20 kg to your squat." }))).toMatch(/dangerous_progression/);
    expect(reasons(check(ctx, { message: "Max out on squats this week." }))).toMatch(/dangerous_progression/);
    expect(reasons(check(ctx, { message: "Push through the pain." }))).toMatch(/dangerous_progression/);
    expect(check(ctx, { message: "Next time add 2.5 kg if every rep is clean." }).ok).toBe(true);
  });

  it("keeps rest days: no training push while recovering; training actions are withheld", () => {
    const ctx = buildCoachContext(input({ workouts: [{ localDate: "2026-09-29", durationMinutes: 20, painLevel: "serious", xp: 0, exercises: [] }] }));
    expect(reasons(check(ctx, { message: "Let's train today and push on." }))).toMatch(/training_while_recovering/);
    const r = check(ctx, { message: "Rest up.", actions: [{ id: "open_train", label: "Train" }, { id: "log_food", label: "Log food" }] });
    expect(r.ok && r.response.actions.map((a) => a.id)).toEqual(["log_food"]);
  });
});

describe("actions", () => {
  it("only routes to real screens with valid parameters", () => {
    const ctx = buildCoachContext(input({}, { profile: { equipment: ["bodyweight"] } }));
    const r = check(ctx, {
      actions: [
        { id: "hack_xp", label: "Free XP" },
        { id: "view_exercise", label: "Bench tips", exerciseId: "bench_press" }, // no barbell
        { id: "view_exercise", label: "Squat tips", exerciseId: "squat" }, // did it recently
        { id: "edit_profile", label: "Fix body", section: "passwords" },
        { id: "edit_profile", label: "Add body details", section: "body" },
      ],
    });
    expect(r.ok && r.response.actions).toEqual([
      { id: "view_exercise", label: "Squat tips", route: "/train/exercise/squat" },
      { id: "edit_profile", label: "Add body details", route: "/profile/edit/body" },
    ]);
  });
});

describe("deterministic coach", () => {
  const meta2 = { ...meta, provider: { type: "deterministic_fallback" as const, name: "FORM rules" } };

  it("produces a valid, evidence-backed response for every topic and situation", () => {
    const situations = [
      input(),
      input({ workouts: [], formIssues: [], records: [], nutrition: null, bodyQuest: null, achievements: null, streaks: null, quests: [] }),
      input({ workouts: [{ localDate: TODAY, durationMinutes: 40, painLevel: "none", xp: 40, exercises: [] }] }),
      input({ workouts: [{ localDate: "2026-09-29", durationMinutes: 20, painLevel: "serious", xp: 0, exercises: [] }] }),
      input({}, { prefs: { allergens: ["peanuts", "milk", "eggs", "fish", "soy", "gluten"], dietaryPreferences: ["vegan"] } }),
      input({}, { profile: { ageYears: 16, primaryGoal: "lose_fat" } }),
      input({ hasTargets: false, nutrition: null }),
    ];
    for (const s of situations) {
      const ctx = buildCoachContext(s);
      for (const topic of COACH_TOPICS) {
        const r = validateCoachOutput(deterministicCoach(ctx, topic, topic === "chat" ? "how is my form?" : null), ctx, { ...meta2, topic });
        expect(r.ok ? "ok" : `${topic}: ${r.reasons.join(",")}`).toBe("ok");
      }
    }
  });

  it("puts recovery first after serious pain, whatever was asked", () => {
    const ctx = buildCoachContext(input({ workouts: [{ localDate: "2026-09-29", durationMinutes: 20, painLevel: "serious", xp: 0, exercises: [] }] }));
    for (const topic of ["daily_insight", "workout", "pr"] as const) {
      const out = deterministicCoach(ctx, topic);
      expect(out.category).toBe("recovery");
      expect(out.actions.some((a) => a.id === "open_train")).toBe(false);
    }
  });

  it("coaches form from the most frequent detected issue, linking to that exercise", () => {
    const ctx = buildCoachContext(input());
    const r = validateCoachOutput(deterministicCoach(ctx, "form"), ctx, meta2);
    expect(r.ok && r.response.message).toMatch(/7 times on Barbell Back Squat: Push your knees out over your toes\./);
    expect(r.ok && r.response.actions[0]).toMatchObject({ route: "/train/exercise/squat" });
  });

  it("progresses only on clean reps, and adapts nutrition coaching to the goal", () => {
    const good = validateCoachOutput(deterministicCoach(buildCoachContext(input()), "workout"), buildCoachContext(input()), meta2);
    expect(good.ok && good.response.message).toMatch(/add a little/);
    const sloppyInput = input();
    sloppyInput.workouts[0]!.exercises[0]!.avgFormScore = 70;
    const sloppy = deterministicCoach(buildCoachContext(sloppyInput), "workout");
    expect(sloppy.message).toMatch(/Before adding weight, repeat this load/);
    const muscle = deterministicCoach(buildCoachContext(input()), "nutrition").message;
    const fat = deterministicCoach(buildCoachContext(input({}, { profile: { primaryGoal: "lose_fat" } })), "nutrition").message;
    expect(muscle).toMatch(/turns your training into muscle/);
    expect(fat).toMatch(/keep muscle while you lean out/);
  });

  it("puts eating enough first when the user has been under their safe minimum", () => {
    const i = input();
    i.nutrition = buildNutritionContext({
      today: TODAY,
      days: [
        { date: "2026-09-28", totals: { entries: 3, kcal: 1200, proteinG: 80, carbsG: 100, fatG: 30, estimatedKcalShare: 0, measuredKcalShare: 1 } as never },
        { date: "2026-09-29", totals: { entries: 3, kcal: 1300, proteinG: 80, carbsG: 100, fatG: 30, estimatedKcalShare: 0, measuredKcalShare: 1 } as never },
      ],
      targets: { targetKcal: 2600, proteinG: 160, carbsG: 300, fatG: 80, safeFloorKcal: 1800 } as never,
      water: { totalMl: 0, targetMl: 2800 },
    });
    const ctx = buildCoachContext(i);
    const r = validateCoachOutput(deterministicCoach(ctx, "nutrition"), ctx, meta2);
    expect(r.ok && r.response).toMatchObject({ priority: "high", message: expect.stringMatching(/On 2 of the last 7 days you finished below your safe minimum of 1,800 kcal/) });
  });

  it("is honest with a brand-new user, and never claims to be AI", () => {
    const ctx = buildCoachContext(input({ workouts: [], formIssues: [], records: [] }));
    const out = deterministicCoach(ctx, "daily_insight");
    expect(out.message).toMatch(/no training logged yet/);
    expect(out.message).not.toMatch(/\bAI\b|I think|I feel/);
    expect(topicFromMessage("my knees cave on squats")).toBe("form");
    expect(topicFromMessage("how much protein should I eat")).toBe("nutrition");
  });
});
