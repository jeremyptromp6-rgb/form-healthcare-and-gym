import type { DateKey } from "../shared/dates";

/**
 * Quests: short daily and weekly goals built only from healthy behaviours. Definitions are
 * content; progress is always computed from the user's real logged activity, and each
 * completed quest awards XP exactly once per period through the XP ledger.
 *
 * Safety is enforced at definition time: quests may only measure healthy behaviours, and
 * targets are capped so no quest rewards excessive volume or restriction. There is no
 * "train every day" quest — a week always leaves at least one rest day.
 */

export const QUEST_METRICS = [
  "verified_reps",
  "workouts_completed",
  "meals_logged",
  "protein_target_days",
  "active_days",
  "water_target_days",
  "food_log_days",
  /** Verified reps with a form score of at least 85. */
  "good_form_reps",
  /** Personal records awarded (verified reps only; never ones held for review). */
  "prs_awarded",
] as const;
export type QuestMetric = (typeof QUEST_METRICS)[number];
export type QuestCadence = "daily" | "weekly";

export interface QuestDefinition {
  id: string;
  title: string;
  cadence: QuestCadence;
  metric: QuestMetric;
  target: number;
  xpReward: number;
  /** What the quest needs to be achievable; it is not offered without it. */
  requires?: "nutrition_targets" | "camera_verification";
}

export interface UserQuest {
  userId: string;
  questId: string;
  /** Daily: the date key. Weekly: the date key of the week's Monday. */
  periodKey: DateKey;
  progress: number;
  target: number;
  status: "active" | "completed" | "expired";
  completedAt: string | null;
}

/** Upper bounds per metric and cadence. A week always leaves at least one rest day. */
const MAX_TARGET: Record<QuestMetric, Record<QuestCadence, number>> = {
  verified_reps: { daily: 300, weekly: 1500 },
  workouts_completed: { daily: 1, weekly: 6 },
  meals_logged: { daily: 6, weekly: 35 },
  protein_target_days: { daily: 1, weekly: 7 },
  active_days: { daily: 1, weekly: 6 },
  water_target_days: { daily: 1, weekly: 7 },
  food_log_days: { daily: 1, weekly: 7 },
  good_form_reps: { daily: 150, weekly: 600 },
  prs_awarded: { daily: 3, weekly: 5 },
};

export type QuestIssue = "unknown_metric" | "target_out_of_range" | "reward_out_of_range" | "invalid_id";

export function validateQuestDefinition(q: QuestDefinition): QuestIssue[] {
  const issues: QuestIssue[] = [];
  if (!/^[a-z0-9_]{1,40}$/.test(q.id)) issues.push("invalid_id");
  if (!(QUEST_METRICS as readonly string[]).includes(q.metric)) return [...issues, "unknown_metric"];
  const max = MAX_TARGET[q.metric][q.cadence];
  if (!Number.isInteger(q.target) || q.target < 1 || max === undefined || q.target > max) issues.push("target_out_of_range");
  if (!Number.isInteger(q.xpReward) || q.xpReward < 1 || q.xpReward > 200) issues.push("reward_out_of_range");
  return issues;
}

/** Live quest catalog. Every entry must pass validateQuestDefinition (enforced by tests). */
export const QUESTS: readonly QuestDefinition[] = [
  { id: "daily_log_meals", title: "Log 3 meals", cadence: "daily", metric: "meals_logged", target: 3, xpReward: 10 },
  { id: "daily_protein", title: "Hit your protein target", cadence: "daily", metric: "protein_target_days", target: 1, xpReward: 15, requires: "nutrition_targets" },
  { id: "daily_water", title: "Reach your water goal", cadence: "daily", metric: "water_target_days", target: 1, xpReward: 10 },
  { id: "weekly_train", title: "Consistency: train {n} days this week", cadence: "weekly", metric: "active_days", target: 3, xpReward: 50 },
  { id: "weekly_protein", title: "Protein Target: hit it on 4 days", cadence: "weekly", metric: "protein_target_days", target: 4, xpReward: 40, requires: "nutrition_targets" },
  { id: "weekly_log_food", title: "Log food on 5 days", cadence: "weekly", metric: "food_log_days", target: 5, xpReward: 40 },
  { id: "weekly_verified_reps", title: "Complete 100 camera-verified reps", cadence: "weekly", metric: "verified_reps", target: 100, xpReward: 40, requires: "camera_verification" },
  { id: "weekly_form_master", title: "Form Master: 30 reps with great form", cadence: "weekly", metric: "good_form_reps", target: 30, xpReward: 50, requires: "camera_verification" },
  { id: "weekly_personal_best", title: "Personal Best: set a new record", cadence: "weekly", metric: "prs_awarded", target: 1, xpReward: 40, requires: "camera_verification" },
];

export interface ActiveQuest extends QuestDefinition {
  periodKey: DateKey;
}

/**
 * The quests a user is offered for a day. The weekly training quest follows the user's own
 * plan (their training days per week, capped so a rest day always remains).
 */
export function questsFor(input: {
  today: DateKey;
  weekStart: DateKey;
  trainingDaysPerWeek: number | null;
  hasNutritionTargets: boolean;
  cameraVerificationAvailable: boolean;
}): ActiveQuest[] {
  return QUESTS.filter((q) => {
    if (q.requires === "nutrition_targets") return input.hasNutritionTargets;
    if (q.requires === "camera_verification") return input.cameraVerificationAvailable;
    return true;
  }).map((q) => {
    const periodKey = q.cadence === "daily" ? input.today : input.weekStart;
    if (q.id === "weekly_train") {
      const n = Math.min(MAX_TARGET.active_days.weekly, Math.max(1, input.trainingDaysPerWeek ?? q.target));
      return { ...q, target: n, title: q.title.replace("{n}", String(n)), periodKey };
    }
    return { ...q, periodKey };
  });
}

export type QuestMetrics = Record<QuestMetric, number>;

export interface QuestProgress {
  id: string;
  title: string;
  cadence: QuestCadence;
  periodKey: DateKey;
  progress: number;
  target: number;
  xpReward: number;
  completed: boolean;
}

export function evaluateQuest(q: ActiveQuest, metrics: QuestMetrics): QuestProgress {
  const progress = Math.max(0, Math.floor(metrics[q.metric] ?? 0));
  return {
    id: q.id,
    title: q.title,
    cadence: q.cadence,
    periodKey: q.periodKey,
    progress: Math.min(progress, q.target),
    target: q.target,
    xpReward: q.xpReward,
    completed: progress >= q.target,
  };
}
