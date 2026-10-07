/**
 * AchievementEngine. Definitions are configurable content; progress is computed only from
 * authoritative server data; unlocks are permanent, idempotent records whose XP flows through the
 * progression ledger. Nothing here rewards unsafe behaviour: sessions with serious pain never count,
 * and nutrition only counts days on track with the target (never below the safe minimum).
 */

export const ACHIEVEMENT_METRICS = [
  /** Camera-verified reps, all time (pain-free sessions). */
  "total_verified_reps",
  /** Pain-free workouts completed, all time. */
  "workouts_completed",
  /** Verified reps the server scored 85+, all time (pain-free sessions). */
  "good_form_reps",
  /** Longest run of consecutive weeks that met the training plan. */
  "weekly_consistency_streak",
  /** Personal records that beat an earlier record. */
  "prs_beaten",
  /** Finished days within 10% of the calorie target. */
  "nutrition_on_track_days",
] as const;
export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];
export type AchievementMetrics = Record<AchievementMetric, number>;

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  metric: AchievementMetric;
  threshold: number;
  xpReward: number;
  /** What the user needs before this can progress at all (shown, never hidden). */
  requires?: "camera" | "nutrition_targets";
}

export interface UserAchievement {
  userId: string;
  achievementId: string;
  unlockedAt: string;
}

export type AchievementIssue = "invalid_id" | "unknown_metric" | "threshold_out_of_range" | "reward_out_of_range";

export function validateAchievementDefinition(a: AchievementDefinition): AchievementIssue[] {
  const issues: AchievementIssue[] = [];
  if (!/^[a-z0-9_]{1,40}$/.test(a.id)) issues.push("invalid_id");
  if (!(ACHIEVEMENT_METRICS as readonly string[]).includes(a.metric)) issues.push("unknown_metric");
  if (!Number.isInteger(a.threshold) || a.threshold < 1 || a.threshold > 1_000_000) issues.push("threshold_out_of_range");
  if (!Number.isInteger(a.xpReward) || a.xpReward < 0 || a.xpReward > 500) issues.push("reward_out_of_range");
  return issues;
}

/** Live achievement catalog. */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  { id: "first_rep", title: "First Rep", description: "Complete your first camera-verified rep.", metric: "total_verified_reps", threshold: 1, xpReward: 10, requires: "camera" },
  { id: "first_workout", title: "First Workout", description: "Finish your first workout.", metric: "workouts_completed", threshold: 1, xpReward: 20 },
  { id: "form_master", title: "Form Master", description: "Do 100 verified reps with great form (85+).", metric: "good_form_reps", threshold: 100, xpReward: 75, requires: "camera" },
  { id: "consistent", title: "Consistent", description: "Meet your weekly training plan 4 weeks in a row.", metric: "weekly_consistency_streak", threshold: 4, xpReward: 100 },
  { id: "pr_breaker", title: "PR Breaker", description: "Beat one of your personal records.", metric: "prs_beaten", threshold: 1, xpReward: 40, requires: "camera" },
  { id: "nutrition_on_track", title: "Nutrition On Track", description: "Finish 7 days within 10% of your calorie target.", metric: "nutrition_on_track_days", threshold: 7, xpReward: 60, requires: "nutrition_targets" },
  { id: "hundred_club", title: "Hundred Club", description: "Reach 100 camera-verified reps.", metric: "total_verified_reps", threshold: 100, xpReward: 50, requires: "camera" },
];

export type AchievementState = "locked" | "in_progress" | "unlocked";

export interface AchievementStatus {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  requires: AchievementDefinition["requires"] | null;
  state: AchievementState;
  /** Progress toward the threshold, from real data (capped at the threshold). */
  progress: number;
  target: number;
  unlockedAt: string | null;
}

/**
 * Evaluates every achievement. An unlock is permanent: once recorded it stays unlocked even if the
 * underlying data later changes. `newlyUnlocked` lists achievements that reach their threshold now
 * and have no unlock record yet.
 */
export function evaluateAchievements(
  defs: readonly AchievementDefinition[],
  metrics: AchievementMetrics,
  unlocked: ReadonlyMap<string, string>,
): { statuses: AchievementStatus[]; newlyUnlocked: AchievementDefinition[] } {
  const statuses: AchievementStatus[] = [];
  const newlyUnlocked: AchievementDefinition[] = [];
  for (const d of defs) {
    const value = Math.max(0, Math.floor(metrics[d.metric] ?? 0));
    const at = unlocked.get(d.id) ?? null;
    const reached = value >= d.threshold;
    if (reached && !at) newlyUnlocked.push(d);
    const state: AchievementState = at || reached ? "unlocked" : value > 0 ? "in_progress" : "locked";
    statuses.push({
      id: d.id,
      title: d.title,
      description: d.description,
      xpReward: d.xpReward,
      requires: d.requires ?? null,
      state,
      progress: state === "unlocked" ? d.threshold : Math.min(value, d.threshold),
      target: d.threshold,
      unlockedAt: at,
    });
  }
  return { statuses, newlyUnlocked };
}
