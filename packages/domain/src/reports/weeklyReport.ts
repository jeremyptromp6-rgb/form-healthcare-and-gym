/**
 * Weekly progress report (FORM Pro). A summary of one finished week (Monday–Sunday, the user's
 * own days) from authoritative records only: workouts, verified reps, form and range of motion,
 * records beaten, nutrition and protein, XP and Body Quest. Every number is a count or average of
 * stored data; a section with no data says so instead of showing zeros as achievements.
 */

export interface WeekTraining {
  workouts: number;
  trainingDays: number;
  plannedDays: number | null;
  minutes: number;
  verifiedReps: number;
  /** Rep-weighted mean over camera-verified reps; null when none. */
  averageFormScore: number | null;
  averageRomPercent: number | null;
}

export interface WeeklyReportInput {
  weekStart: string;
  weekEnd: string;
  training: WeekTraining;
  previousTraining: WeekTraining | null;
  recordsBeaten: { exercise: string; label: string; display: string }[];
  nutrition: { daysLogged: number; hasTargets: boolean; proteinDaysMet: number; daysOnTarget: number; daysBelowSafeMinimum: number };
  xp: { earned: number; levelAtEnd: number; rankAtEnd: string };
  bodyQuest: { stageAtStart: string | null; stageAtEnd: string | null; overallAtStart: number | null; overallAtEnd: number | null } | null;
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  training: WeekTraining & { change: { workouts: number; verifiedReps: number; formScore: number | null } | null };
  recordsBeaten: WeeklyReportInput["recordsBeaten"];
  nutrition: WeeklyReportInput["nutrition"];
  xp: WeeklyReportInput["xp"];
  bodyQuest: WeeklyReportInput["bodyQuest"];
  /** What went well, in plain words — only things the data shows. */
  highlights: string[];
  /** The single most useful focus for next week, derived by rules from the same data. */
  focus: string;
  empty: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildWeeklyReport(i: WeeklyReportInput): WeeklyReport {
  const t = i.training;
  const p = i.previousTraining;
  const highlights: string[] = [];
  const empty = t.workouts === 0 && i.nutrition.daysLogged === 0;

  if (t.workouts > 0) highlights.push(`${plural(t.workouts, "workout")} on ${plural(t.trainingDays, "day")}${t.plannedDays ? ` (plan: ${t.plannedDays})` : ""}, ${t.minutes} minutes in total.`);
  if (t.verifiedReps > 0) highlights.push(`${t.verifiedReps} camera-verified reps${t.averageFormScore !== null ? ` at an average form score of ${t.averageFormScore}` : ""}${t.averageRomPercent !== null ? ` and ${t.averageRomPercent}% range of motion` : ""}.`);
  if (p && t.averageFormScore !== null && p.averageFormScore !== null && t.averageFormScore >= p.averageFormScore + 3) highlights.push(`Form improved from ${p.averageFormScore} to ${t.averageFormScore} on last week.`);
  if (i.recordsBeaten.length) highlights.push(`${plural(i.recordsBeaten.length, "record")} beaten: ${i.recordsBeaten.slice(0, 3).map((r) => `${r.exercise} ${r.label.toLowerCase()} ${r.display}`).join(", ")}.`);
  if (i.nutrition.daysLogged > 0 && i.nutrition.hasTargets) highlights.push(`Protein target met on ${i.nutrition.proteinDaysMet} of ${plural(i.nutrition.daysLogged, "logged day")}.`);
  if (i.xp.earned > 0) highlights.push(`${i.xp.earned} XP earned — level ${i.xp.levelAtEnd}, ${i.xp.rankAtEnd}.`);
  const bq = i.bodyQuest;
  if (bq && bq.stageAtStart && bq.stageAtEnd && bq.stageAtEnd !== bq.stageAtStart) highlights.push(`Body Quest: reached ${bq.stageAtEnd}.`);
  else if (bq && bq.overallAtStart !== null && bq.overallAtEnd !== null && bq.overallAtEnd > bq.overallAtStart) highlights.push(`Body Quest overall up from ${bq.overallAtStart} to ${bq.overallAtEnd}.`);

  // One focus, in priority order: safety, then the biggest gap the data shows.
  let focus: string;
  if (i.nutrition.daysBelowSafeMinimum > 0) focus = `Eat enough: ${plural(i.nutrition.daysBelowSafeMinimum, "day")} came in under your safe minimum. Recovery and progress need fuel.`;
  else if (t.workouts === 0) focus = "Get one session in. A short workout this week restarts your momentum.";
  else if (t.plannedDays && t.trainingDays < t.plannedDays) focus = `Consistency: ${t.trainingDays} of ${t.plannedDays} planned days. Pick the days now and protect them.`;
  else if (t.averageFormScore !== null && t.averageFormScore < 75) focus = `Form: your average was ${t.averageFormScore}. Keep the same loads and make every rep cleaner before adding weight.`;
  else if (i.nutrition.hasTargets && i.nutrition.daysLogged > 0 && i.nutrition.proteinDaysMet < Math.ceil(i.nutrition.daysLogged / 2)) focus = `Protein: met on ${i.nutrition.proteinDaysMet} of ${i.nutrition.daysLogged} logged days. Add a protein source to the meal you most often skip it in.`;
  else if (t.verifiedReps === 0) focus = "Verify a set with the camera, so coaching can look at your form, not just your minutes.";
  else focus = "Keep going: the plan is working. Progress when your reps and form earn it.";

  return {
    weekStart: i.weekStart,
    weekEnd: i.weekEnd,
    training: { ...t, change: p ? { workouts: t.workouts - p.workouts, verifiedReps: t.verifiedReps - p.verifiedReps, formScore: t.averageFormScore !== null && p.averageFormScore !== null ? t.averageFormScore - p.averageFormScore : null } : null },
    recordsBeaten: i.recordsBeaten,
    nutrition: i.nutrition,
    xp: i.xp,
    bodyQuest: i.bodyQuest,
    highlights,
    focus,
    empty,
  };
}
