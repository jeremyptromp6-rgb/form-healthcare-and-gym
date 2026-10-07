import type { CoachContext, CoachTopic, RawCoachOutput } from "./coach";
import { GOAL_FOCUS } from "./coach";

/**
 * Deterministic coaching — the fallback when no AI provider is available, and the safety net
 * when an AI answer fails validation. It is rules over the same facts, labelled as rules (never
 * presented as AI), and it writes facts as {{placeholders}} so it passes the same validator.
 *
 * Every branch is evidence-based (it cites the facts it used) and safety-first: recovery after
 * reported pain outranks everything; rest days stay rest days; nutrition advice never goes below
 * the user's safe minimum and never names foods (so it can't collide with an allergy).
 */

type Out = RawCoachOutput;

const ev = (fact: string, claim: string) => ({ fact, claim });

export function deterministicCoach(ctx: CoachContext, topic: CoachTopic, message: string | null = null): Out {
  const f = ctx.facts;
  const n = (k: string) => (typeof f[k] === "number" ? (f[k] as number) : null);
  const has = (k: string) => f[k] !== undefined;
  const goal = String(f["profile.goal"] ?? "unset") as keyof typeof GOAL_FOCUS;

  // Recovery first, whatever was asked.
  if (ctx.safety.recovering) {
    return {
      message:
        "You reported serious pain in a recent session, so today is for recovery, not training. Rest, keep moving gently if it feels fine, and get it checked by a doctor or physiotherapist before you train that area again.",
      category: "recovery",
      priority: "high",
      evidence: [ev("training.seriousPainLast7Days", "Serious pain reported in the last 7 days")],
      actions: [{ id: "log_food", label: "Log today's food" }],
      confidence: "high",
    };
  }

  const t = topic === "chat" ? topicFromMessage(message) : topic;
  switch (t) {
    case "form":
      return formCoaching(ctx);
    case "nutrition":
      return nutritionCoaching(ctx, goal);
    case "pr":
      return prCoaching(ctx);
    case "body_quest":
      return bodyQuestCoaching(ctx);
    case "progression":
      return progressionCoaching(ctx);
    case "consistency":
    case "weekly_report":
      return consistencyCoaching(ctx);
    case "workout":
      return workoutCoaching(ctx, goal);
    default:
      return dailyCoaching(ctx, goal, n, has);
  }
}

/** Routes a chat message to the topic it is most likely about (rules only — no understanding implied). */
export function topicFromMessage(message: string | null): CoachTopic {
  const m = (message ?? "").toLowerCase();
  if (/\b(form|technique|depth|knees?|back|posture|range|rom)\b/.test(m)) return "form";
  if (/\b(eat|food|protein|calorie|kcal|meal|diet|nutrition|hungry|water|drink)\b/.test(m)) return "nutrition";
  if (/\b(pr|record|personal best|heavier|stronger)\b/.test(m)) return "pr";
  if (/\b(body quest|stage|stats?)\b/.test(m)) return "body_quest";
  if (/\b(level|xp|rank)\b/.test(m)) return "progression";
  if (/\b(streak|consisten|miss|skip|routine|schedule)\b/.test(m)) return "consistency";
  if (/\b(workout|train|session|exercise|sets?|reps?)\b/.test(m)) return "workout";
  return "daily_insight";
}

function emptyUser(): Out {
  return {
    message: "There's no training logged yet, so there's nothing to judge — just a place to start. Log your first workout, even a short one, and the coaching gets specific from there.",
    category: "general",
    priority: "normal",
    evidence: [ev("training.workoutsLast28Days", "Workouts in the last 4 weeks")],
    actions: [{ id: "open_train", label: "Start your first workout" }],
    confidence: "high",
  };
}

function dailyCoaching(ctx: CoachContext, goal: keyof typeof GOAL_FOCUS, n: (k: string) => number | null, has: (k: string) => boolean): Out {
  const f = ctx.facts;
  if (n("training.workoutsLast28Days") === 0) return emptyUser();

  // Progress at risk: train within a day to keep the level.
  const within = n("progression.trainWithinDays");
  if (within !== null && within <= 1 && !ctx.safety.trainedToday) {
    return {
      message: "Train today to keep Level {{progression.level}} — your last workout was {{training.daysSinceLastWorkout}} days ago. Any session counts; a short one beats none.",
      category: "consistency",
      priority: "high",
      evidence: [ev("progression.trainWithinDays", "Days left to keep your level"), ev("training.daysSinceLastWorkout", "Days since your last workout")],
      actions: [{ id: "open_train", label: "Start a workout" }],
      confidence: "high",
    };
  }

  // Already trained today: recovery and fuel.
  if (ctx.safety.trainedToday) {
    if (ctx.safety.hasTargets && (n("nutrition.today.proteinRemainingG") ?? 0) > 20) {
      return {
        message: "Good session today. You still have {{nutrition.today.proteinRemainingG}} g of protein to go — spread it over your next meals so your training turns into progress.",
        category: "nutrition",
        priority: "normal",
        evidence: [ev("training.trainedToday", "Trained today"), ev("nutrition.today.proteinRemainingG", "Protein left today (g)")],
        actions: [{ id: "log_food", label: "Log a meal" }],
        confidence: "high",
      };
    }
    return {
      message: "You've trained today — that's the work done. Recovery is where it pays off: eat well, drink water and sleep. Your next session can wait for tomorrow.",
      category: "recovery",
      priority: "low",
      evidence: [ev("training.trainedToday", "Trained today")],
      actions: [{ id: "open_progress", label: "See your progress" }],
      confidence: "high",
    };
  }

  // Plan met: rest days are planned.
  if (ctx.safety.planMetThisWeek) {
    return {
      message: "You've done {{training.doneThisWeek}} of {{training.plannedThisWeek}} planned sessions this week — the plan is met. Rest days are part of it; enjoy them.",
      category: "consistency",
      priority: "low",
      evidence: [ev("training.doneThisWeek", "Sessions this week"), ev("training.plannedThisWeek", "Planned this week")],
      actions: [{ id: "open_progress", label: "See your week" }],
      confidence: "high",
    };
  }

  // Behind on the plan with days running out.
  const remaining = n("training.remainingThisWeek") ?? 0;
  const daysLeft = n("training.daysLeftThisWeek") ?? 7;
  if (remaining > 0 && remaining >= daysLeft) {
    return {
      message: "{{training.remainingThisWeek}} sessions left this week and {{training.daysLeftThisWeek}} days to do them — today is a good day to train. Keep it {{profile.experience}}-friendly and focused on {{profile.goal}}.",
      category: "consistency",
      priority: "high",
      evidence: [ev("training.remainingThisWeek", "Sessions left this week"), ev("training.daysLeftThisWeek", "Days left this week")],
      actions: [{ id: "open_train", label: "Start today's workout" }],
      confidence: "high",
    };
  }

  // Close to an achievement.
  if (has("achievements.next.title") && (n("achievements.next.remaining") ?? 99) <= Math.max(1, Math.ceil((n("achievements.next.target") ?? 1) * 0.25))) {
    return {
      message: "You're close to {{achievements.next.title}}: {{achievements.next.progress}} of {{achievements.next.target}} done. It comes from training as you normally would — no shortcuts needed.",
      category: "progression",
      priority: "normal",
      evidence: [ev("achievements.next.progress", "Progress"), ev("achievements.next.target", "Target")],
      actions: [{ id: "open_achievements", label: "See achievements" }],
      confidence: "high",
    };
  }

  return {
    message: `A steady week so far: {{training.doneThisWeek}} of {{training.plannedThisWeek}} planned sessions. Your next one keeps the focus on ${GOAL_FOCUS[goal]}.`,
    category: "daily_insight",
    priority: "normal",
    evidence: [ev("training.doneThisWeek", "Sessions this week"), ev("training.plannedThisWeek", "Planned this week")],
    actions: [{ id: "open_train", label: "Plan your next workout" }],
    confidence: "medium",
  };
  void f;
}

function workoutCoaching(ctx: CoachContext, goal: keyof typeof GOAL_FOCUS): Out {
  const f = ctx.facts;
  if (f["training.lastWorkoutDate"] === undefined) return emptyUser();
  const ex = f["workouts.0.exercises.0.name"];
  const verified = (f["workouts.0.exercises.0.verifiedReps"] as number | undefined) ?? 0;
  const form = f["workouts.0.exercises.0.formScore"] as number | undefined;
  if (ex && verified > 0 && form !== undefined) {
    const good = form >= 85;
    return {
      message: good
        ? `Your last session: {{workouts.0.exercises.0.name}} with a form score of {{workouts.0.exercises.0.formScore}} across {{workouts.0.exercises.0.verifiedReps}} verified reps. That's solid — next time, keep the same quality and add a little: one more rep per set, or the smallest weight step.`
        : `Your last session: {{workouts.0.exercises.0.name}} scored {{workouts.0.exercises.0.formScore}} for form. Before adding weight, repeat this load and make every rep cleaner — quality first, then progress.`,
      category: "workout",
      priority: "normal",
      evidence: [ev("workouts.0.exercises.0.formScore", "Form score, last session"), ev("workouts.0.exercises.0.verifiedReps", "Verified reps, last session")],
      actions: [{ id: "view_exercise", label: "Exercise tips", exerciseId: String(ctx.recentExercises[0]?.exerciseId ?? "") }, { id: "open_train", label: "Plan the next session" }],
      confidence: "high",
    };
  }
  return {
    message: `Your last session was {{workouts.0.durationMinutes}} ${f["workouts.0.durationMinutes"] === 1 ? "minute" : "minutes"} on {{workouts.0.date}}. To make progress toward ${GOAL_FOCUS[goal]}, try verifying a set with the camera next time — then coaching can talk about your form, not just your minutes.`,
    category: "workout",
    priority: "normal",
    evidence: [ev("workouts.0.durationMinutes", "Last session length (minutes)"), ev("workouts.0.date", "Last session date")],
    actions: [{ id: "open_train", label: "Plan the next session" }],
    confidence: "medium",
  };
}

function formCoaching(ctx: CoachContext): Out {
  const f = ctx.facts;
  if (f["form.issues.0.cue"] !== undefined) {
    return {
      message: "The camera flagged the same thing {{form.issues.0.count}} times on {{form.issues.0.exercise}}: {{form.issues.0.cue}} Slow the rep down and own that position before adding weight.",
      category: "form",
      priority: "normal",
      evidence: [ev("form.issues.0.count", "Times flagged in the last 4 weeks"), ev("form.issues.0.exercise", "Exercise")],
      actions: [{ id: "view_exercise", label: "See how to fix it", exerciseId: String(f["form.issues.0.exerciseId"] ?? "") }],
      confidence: "high",
    };
  }
  if ((f["form.verifiedRepsLast28Days"] as number) > 0 && f["form.averageScore"] !== undefined) {
    return {
      message: "Your verified reps average a form score of {{form.averageScore}} with no repeated issues — keep filming a set each session so it stays that way as the weight goes up.",
      category: "form",
      priority: "low",
      evidence: [ev("form.averageScore", "Average form score, last 4 weeks"), ev("form.verifiedRepsLast28Days", "Verified reps, last 4 weeks")],
      actions: [{ id: "open_train", label: "Train with the camera" }],
      confidence: "high",
    };
  }
  return {
    message: "There are no camera-verified reps in the last 4 weeks, so there's no form data to coach from yet. Film one set next session — the camera scores every rep and points out what to fix.",
    category: "form",
    priority: "normal",
    evidence: [ev("form.verifiedRepsLast28Days", "Verified reps, last 4 weeks")],
    actions: [{ id: "open_train", label: "Try a verified set" }],
    confidence: "high",
  };
}

function nutritionCoaching(ctx: CoachContext, goal: keyof typeof GOAL_FOCUS): Out {
  const f = ctx.facts;
  if (!ctx.safety.hasTargets || f["nutrition.targets.kcal"] === undefined) {
    return {
      message: "Without your body profile there are no safe targets to coach against. Add your height, weight and age and nutrition coaching can get specific — and keep you above your safe minimum.",
      category: "nutrition",
      priority: "normal",
      evidence: [ev("profile.hasNutritionTargets", "Nutrition targets set")],
      actions: [{ id: "edit_profile", label: "Add body details", section: "body" }],
      confidence: "high",
    };
  }
  if ((f["nutrition.last7Days.daysBelowSafeFloor"] as number) > 0) {
    return {
      message: "On {{nutrition.last7Days.daysBelowSafeFloor}} of the last 7 days you finished below your safe minimum of {{nutrition.targets.safeMinimumKcal}} kcal. Eating enough comes first — it fuels training and recovery. Aim to reach at least your minimum every day.",
      category: "nutrition",
      priority: "high",
      evidence: [ev("nutrition.last7Days.daysBelowSafeFloor", "Days below your safe minimum"), ev("nutrition.targets.safeMinimumKcal", "Your safe minimum (kcal)")],
      actions: [{ id: "open_meal_plan", label: "Plan your meals" }],
      confidence: "high",
    };
  }
  const proteinLeft = (f["nutrition.today.proteinRemainingG"] as number | undefined) ?? 0;
  if ((f["nutrition.today.entries"] as number) > 0 && proteinLeft > 20) {
    const why = goal === "build_muscle" || goal === "get_stronger" ? "Protein is what turns your training into muscle." : goal === "lose_fat" || goal === "get_lean" ? "Protein helps you keep muscle while you lean out." : "Protein supports recovery between sessions.";
    return {
      message: `You've had {{nutrition.today.proteinG}} g of protein of your {{nutrition.targets.proteinG}} g target, so {{nutrition.today.proteinRemainingG}} g to go. ${why} A protein source you can eat at each remaining meal gets you there.`,
      category: "nutrition",
      priority: "normal",
      evidence: [ev("nutrition.today.proteinG", "Protein today (g)"), ev("nutrition.targets.proteinG", "Protein target (g)")],
      actions: [{ id: "log_food", label: "Log a meal" }],
      confidence: "high",
    };
  }
  if ((f["nutrition.last7Days.daysLogged"] as number) === 0) {
    return {
      message: "No food logged in the last 7 days, so there is nothing to coach from yet. Log what you eat today — even roughly — and nutrition coaching can start.",
      category: "nutrition",
      priority: "normal",
      evidence: [ev("nutrition.last7Days.daysLogged", "Days with food logged")],
      actions: [{ id: "log_food", label: "Log food" }],
      confidence: "high",
    };
  }
  return {
    message: "This week you met your protein target on {{nutrition.last7Days.daysMeetingProtein}} of {{nutrition.last7Days.daysLogged}} logged days. Logging most days is what makes the numbers trustworthy — keep it simple and consistent.",
    category: "nutrition",
    priority: "low",
    evidence: [ev("nutrition.last7Days.daysMeetingProtein", "Days meeting protein"), ev("nutrition.last7Days.daysLogged", "Days logged")],
    actions: [{ id: "log_food", label: "Log food" }],
    confidence: "medium",
  };
}

function prCoaching(ctx: CoachContext): Out {
  const f = ctx.facts;
  if ((f["records.recentCount"] as number) > 0) {
    return {
      message: "New record: {{records.0.exercise}} — {{records.0.label}}, {{records.0.value}} (up from {{records.0.previous}}). Next time, repeat it with clean form before trying the next small step; steady beats big jumps.",
      category: "pr",
      priority: "normal",
      evidence: [ev("records.0.value", "Your new record"), ev("records.0.previous", "Previous best")],
      actions: [{ id: "open_progress", label: "See your records" }],
      confidence: "high",
    };
  }
  return {
    message: "No records beaten in the last month yet. Records come from camera-verified sets: pick one lift, film it each session, and add one rep or the smallest weight step only when every rep looks clean.",
    category: "pr",
    priority: "normal",
    evidence: [ev("records.recentCount", "Records beaten this month")],
    actions: [{ id: "open_train", label: "Train with the camera" }],
    confidence: "high",
  };
}

function bodyQuestCoaching(ctx: CoachContext): Out {
  const f = ctx.facts;
  if (f["bodyQuest.stage"] === undefined) return emptyUser();
  if (f["bodyQuest.next.stats.needed"] !== undefined) {
    return {
      message: "You're at {{bodyQuest.stage}} with {{bodyQuest.statsMeasured}} of 6 stats measured. Reaching {{bodyQuest.nextStage}} needs {{bodyQuest.next.stats.needed}} — the quickest way to unlock more is verifying a few sets with the camera, which measures form and mobility.",
      category: "body_quest",
      priority: "normal",
      evidence: [ev("bodyQuest.statsMeasured", "Stats measured"), ev("bodyQuest.next.stats.needed", "Stats needed for the next stage")],
      actions: [{ id: "open_body_quest", label: "Open Body Quest" }],
      confidence: "high",
    };
  }
  if (f["bodyQuest.next.weeks.needed"] !== undefined) {
    return {
      message: "{{bodyQuest.nextStage}} needs {{bodyQuest.next.weeks.needed}} weeks of training history — you have {{bodyQuest.next.weeks.have}}. There's no shortcut here: keep training on plan and it comes.",
      category: "body_quest",
      priority: "low",
      evidence: [ev("bodyQuest.next.weeks.needed", "Weeks needed"), ev("bodyQuest.next.weeks.have", "Weeks so far")],
      actions: [{ id: "open_body_quest", label: "Open Body Quest" }],
      confidence: "high",
    };
  }
  return {
    message: "You're at {{bodyQuest.stage}}. Your overall score is {{bodyQuest.overall}} — raise your lowest stat and the stage follows. Body Quest measures what you can do, not how you look.",
    category: "body_quest",
    priority: "low",
    evidence: [ev("bodyQuest.stage", "Current stage")],
    actions: [{ id: "open_body_quest", label: "Open Body Quest" }],
    confidence: "medium",
  };
}

function progressionCoaching(ctx: CoachContext): Out {
  const f = ctx.facts;
  return {
    message:
      f["progression.nextRank"] !== undefined
        ? "You're Level {{progression.level}} ({{progression.rank}}), {{progression.xpToNextLevel}} XP from Level {{progression.nextLevel}}. {{progression.nextRank}} comes at Level {{progression.nextRankLevel}}. XP comes from real training and consistent eating — not from doing more than your plan."
        : "You're Level {{progression.level}} ({{progression.rank}}), {{progression.xpToNextLevel}} XP from Level {{progression.nextLevel}}. XP comes from real training and consistent eating — not from doing more than your plan.",
    category: "progression",
    priority: "low",
    evidence: [ev("progression.level", "Current level"), ev("progression.xpToNextLevel", "XP to the next level")],
    actions: [{ id: "open_progress", label: "See your progress" }],
    confidence: "high",
  };
}

function consistencyCoaching(ctx: CoachContext): Out {
  const f = ctx.facts;
  if (f["training.lastWorkoutDate"] === undefined) return emptyUser();
  return {
    message: ctx.safety.planMetThisWeek
      ? "Plan met this week: {{training.doneThisWeek}} of {{training.plannedThisWeek}}. Your training streak is {{streaks.workout.current}} days, and rest days in your plan never break it."
      : "{{training.doneThisWeek}} of {{training.plannedThisWeek}} planned sessions done this week. Your training streak is {{streaks.workout.current}} days — up to {{streaks.workout.plannedRestDays}} rest days in a row keep it going, so rest is part of the plan.",
    category: "consistency",
    priority: "normal",
    evidence: [ev("training.doneThisWeek", "Sessions this week"), ev("streaks.workout.current", "Training streak (days)")],
    actions: [ctx.safety.planMetThisWeek ? { id: "open_progress", label: "See your week" } : { id: "open_train", label: "Plan a session" }],
    confidence: "high",
  };
}
