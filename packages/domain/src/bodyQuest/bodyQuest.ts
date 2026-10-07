import { dayNumber, type DateKey } from "../shared/dates";

/**
 * Body-composition goal plans: the models and safety rules for a weight goal over time. Body Quest
 * itself (stages and stats) is in bodyQuestEngine.ts and deliberately does not use body weight.
 */

export type BodyQuestGoal = "lose_fat" | "build_muscle" | "recomposition" | "maintain";

export interface BodyQuest {
  id: string;
  userId: string;
  goal: BodyQuestGoal;
  status: "active" | "completed" | "abandoned";
  startDate: DateKey;
  targetDate: DateKey;
  startWeightKg: number;
  targetWeightKg: number;
}

export interface BodyMeasurement {
  userId: string;
  localDate: DateKey;
  weightKg: number | null;
  waistCm: number | null;
}

export interface BodyQuestPlan {
  goal: BodyQuestGoal;
  startDate: DateKey;
  targetDate: DateKey;
  startWeightKg: number;
  targetWeightKg: number;
  heightCm: number;
  ageYears: number;
}

export type BodyQuestIssue =
  | "too_short"
  | "too_long"
  | "invalid_measurements"
  | "minor_weight_loss"
  | "wrong_direction"
  | "loss_rate_unsafe"
  | "gain_rate_unsafe"
  | "target_underweight"
  | "maintain_range";

export const BODY_QUEST_LIMITS = {
  minDays: 28,
  maxDays: 365,
  /** Max weekly loss: the smaller of 1% of start weight and 1 kg. */
  maxWeeklyLossFraction: 0.01,
  maxWeeklyLossKg: 1,
  maxWeeklyGainFraction: 0.005,
  minTargetBmi: 18.5,
  maintainToleranceKg: 2,
} as const;

export function validateBodyQuestPlan(plan: BodyQuestPlan): { ok: boolean; issues: BodyQuestIssue[]; weeklyChangeKg: number } {
  const L = BODY_QUEST_LIMITS;
  const issues: BodyQuestIssue[] = [];
  const days = dayNumber(plan.targetDate) - dayNumber(plan.startDate);
  const valid = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;

  if (!valid(plan.startWeightKg, 30, 300) || !valid(plan.targetWeightKg, 30, 300) || !valid(plan.heightCm, 120, 240) || !valid(plan.ageYears, 13, 100)) {
    return { ok: false, issues: ["invalid_measurements"], weeklyChangeKg: 0 };
  }
  if (days < L.minDays) issues.push("too_short");
  if (days > L.maxDays) issues.push("too_long");

  const change = plan.targetWeightKg - plan.startWeightKg;
  const weeklyChangeKg = days > 0 ? Math.round((change / (days / 7)) * 100) / 100 : 0;
  const targetBmi = plan.targetWeightKg / (plan.heightCm / 100) ** 2;

  switch (plan.goal) {
    case "lose_fat": {
      if (plan.ageYears < 18) issues.push("minor_weight_loss");
      if (change >= 0) issues.push("wrong_direction");
      const maxLoss = Math.min(plan.startWeightKg * L.maxWeeklyLossFraction, L.maxWeeklyLossKg);
      if (days > 0 && -weeklyChangeKg > maxLoss) issues.push("loss_rate_unsafe");
      if (targetBmi < L.minTargetBmi) issues.push("target_underweight");
      break;
    }
    case "build_muscle": {
      if (change < 0) issues.push("wrong_direction");
      if (days > 0 && weeklyChangeKg > plan.startWeightKg * L.maxWeeklyGainFraction) issues.push("gain_rate_unsafe");
      break;
    }
    case "recomposition":
    case "maintain":
      if (Math.abs(change) > L.maintainToleranceKg) issues.push("maintain_range");
      if (targetBmi < L.minTargetBmi) issues.push("target_underweight");
      break;
  }
  return { ok: issues.length === 0, issues, weeklyChangeKg };
}
