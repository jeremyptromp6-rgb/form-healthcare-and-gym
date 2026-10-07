import { addDays, dayNumber, daysBetween, type DateKey } from "../shared/dates";

/**
 * "What should I do today?" — a transparent, rule-based suggestion from the user's plan and
 * real history. It is not an AI and never claims to be: every suggestion states its reason.
 * Recovery always beats volume.
 */

export type TodayKind = "recover" | "done_today" | "weekly_goal_met" | "rest_suggested" | "train";

export interface TodaySuggestion {
  kind: TodayKind;
  title: string;
  reason: string;
}

export function suggestToday(input: {
  today: DateKey;
  weekStart: DateKey;
  plannedDaysPerWeek: number | null;
  /** Local dates with at least one workout (any order, duplicates allowed). */
  workoutDates: DateKey[];
  /** Local dates on which the user reported serious pain. */
  seriousPainDates: DateKey[];
}): TodaySuggestion {
  const { today, weekStart } = input;
  const days = new Set(input.workoutDates.filter((d) => d <= today));
  const thisWeek = [...days].filter((d) => d >= weekStart).length;
  const planned = input.plannedDaysPerWeek;

  const recentPain = input.seriousPainDates.some((d) => d <= today && daysBetween(d, today) <= 2);
  if (recentPain) {
    return {
      kind: "recover",
      title: "Rest and recover",
      reason: "You reported serious pain recently. Let it settle, and see a professional if it doesn't improve.",
    };
  }
  if (days.has(today)) {
    return { kind: "done_today", title: "You've trained today", reason: "Nice work. Refuel, hydrate and recover — that's where progress happens." };
  }
  if (planned !== null && thisWeek >= planned) {
    return {
      kind: "weekly_goal_met",
      title: "Weekly goal done",
      reason: `You've hit your ${planned} planned ${planned === 1 ? "session" : "sessions"} this week. Rest or keep it light.`,
    };
  }

  const daysLeftInWeek = 7 - (dayNumber(today) - dayNumber(weekStart)); // including today
  const sessionsLeft = planned === null ? null : planned - thisWeek;
  const trainedYesterday = days.has(addDays(today, -1));
  // Suggest rest after a training day only when the plan still fits in the days left.
  if (trainedYesterday && sessionsLeft !== null && sessionsLeft < daysLeftInWeek) {
    return {
      kind: "rest_suggested",
      title: "Rest day",
      reason: `You trained yesterday and have ${sessionsLeft} ${sessionsLeft === 1 ? "session" : "sessions"} left over ${daysLeftInWeek} days. A rest day fits.`,
    };
  }
  return {
    kind: "train",
    title: "Train today",
    reason:
      sessionsLeft === null
        ? "Log a workout to start building your streak."
        : `${thisWeek} of ${planned} planned sessions done this week.`,
  };
}
