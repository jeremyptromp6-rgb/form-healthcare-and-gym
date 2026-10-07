import { BODY_QUEST_STATS, type BodyQuestResult, type BodyQuestStat } from "./bodyQuestEngine";

/**
 * Body Quest insights (FORM Pro): how each stat has moved week by week (from the immutable weekly
 * snapshots), which stat is holding the user back, and exactly what moves it — stated in the same
 * terms the engine scores it, with the user's own numbers. No projections or predicted dates.
 */

export interface StatInsight {
  stat: BodyQuestStat;
  value: number | null;
  /** Weekly values, oldest first (null = not measurable that week). */
  history: { weekStart: string; value: number | null }[];
  /** Change against the snapshot about four weeks earlier; null without one. */
  change4w: number | null;
  /** What the engine scores, with the user's current inputs. */
  lever: string;
}

export interface BodyQuestInsights {
  stats: StatInsight[];
  /** The lowest measured stat — where effort pays most — or null when nothing is measured yet. */
  focus: { stat: BodyQuestStat; value: number; lever: string } | null;
  strongest: { stat: BodyQuestStat; value: number } | null;
}

const LABEL: Record<BodyQuestStat, string> = { strength: "Strength", muscle: "Muscle", endurance: "Endurance", mobility: "Mobility", form: "Form", consistency: "Consistency" };

function lever(stat: BodyQuestStat, detail: Record<string, number>): string {
  switch (stat) {
    case "strength":
      return "Beat your own first camera-verified result on an exercise — heavier, or more verified reps — at least a week later.";
    case "muscle":
      return `Weekly sets for each muscle group${detail.proteinDays ? ", plus hitting your protein target" : ""}${detail.setsPerWeek !== undefined ? ` (now ${detail.setsPerWeek} sets a week${detail.proteinHitPercent !== undefined ? `, protein on ${detail.proteinHitPercent}% of days` : ""})` : ""}.`;
    case "endurance":
      return `Active minutes each week, up to 150${detail.minutesPerWeek !== undefined ? ` (now ${detail.minutesPerWeek})` : ""}.`;
    case "mobility":
      return "The average range of motion of your camera-verified reps over the last 4 weeks.";
    case "form":
      return "The average form score of your camera-verified reps over the last 4 weeks.";
    case "consistency":
      return "Training on your planned days (recovery days after reported pain don't count against you).";
  }
}

export function bodyQuestInsights(live: Pick<BodyQuestResult, "stats">, snapshots: readonly { weekStart: string; stats: Partial<Record<BodyQuestStat, number | null>> }[]): BodyQuestInsights {
  const ordered = [...snapshots].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const stats: StatInsight[] = BODY_QUEST_STATS.map((stat) => {
    const r = live.stats[stat];
    const history = ordered.map((s) => ({ weekStart: s.weekStart, value: s.stats[stat] ?? null }));
    const fourAgo = ordered.length >= 4 ? ordered[ordered.length - 4]!.stats[stat] ?? null : null;
    return { stat, value: r.value, history, change4w: r.value !== null && fourAgo !== null ? r.value - fourAgo : null, lever: lever(stat, r.detail) };
  });
  const measured = stats.filter((s): s is StatInsight & { value: number } => s.value !== null);
  const low = measured.length ? measured.reduce((a, s) => (s.value < a.value ? s : a)) : null;
  const high = measured.length ? measured.reduce((a, s) => (s.value > a.value ? s : a)) : null;
  return {
    stats,
    focus: low ? { stat: low.stat, value: low.value, lever: `${LABEL[low.stat]} (${low.value}) is your lowest stat. ${low.lever}` } : null,
    strongest: high ? { stat: high.stat, value: high.value } : null,
  };
}
