import { computeTrend, METRICS, TREND, type Trend } from "../progressAnalytics/progressAnalytics";
import type { FormIssueCode } from "./formAnalysis";

/**
 * Form intelligence (FORM Pro) — what the camera has measured for one exercise over time.
 *
 * Built only from stored camera-verified reps: their form score, range of motion and detected
 * issues (2D side-view coaching heuristics). It reports history, trends, which technique issues are
 * becoming more or less frequent, how evenly reps were performed, and how form held up as the load
 * changed. It does not claim joint forces, muscle activation or injury risk — nothing the camera
 * can't see.
 */

export interface FormRepRow {
  workoutId: string;
  localDate: string;
  /** Load of the set the rep belonged to. */
  loadKg: number;
  formScore: number | null;
  romPercent: number | null;
  issues: FormIssueCode[];
}

export const ISSUE_LABELS: Record<FormIssueCode, string> = {
  depth: "Depth",
  extension: "Full extension",
  tempo: "Tempo control",
  torso_lean: "Torso position",
  knee_alignment: "Knee alignment",
  heel_lift: "Heels down",
  body_line: "Body line",
  elbow_position: "Elbow position",
  elbow_stability: "Elbow steadiness",
  torso_swing: "Torso swing",
};

export interface FormSession {
  localDate: string;
  workoutId: string;
  topLoadKg: number;
  verifiedReps: number;
  formScore: number | null;
  romPercent: number | null;
  /** Spread (standard deviation) of form scores across the session's reps: lower = more even reps. */
  repSpread: number | null;
}

export interface FormIntelligence {
  sessions: FormSession[];
  formTrend: Trend;
  romTrend: Trend;
  /** Issue frequency (share of reps) in the earlier vs the more recent half of sessions. */
  issues: { code: FormIssueCode; label: string; earlierPercent: number; recentPercent: number; change: "fewer" | "more" | "steady" }[];
  /** Mean form and ROM at each load used (loaded exercises). */
  byLoad: { loadKg: number; sessions: number; reps: number; formScore: number | null; romPercent: number | null }[];
  /** Plain statements of what the data shows; empty when there isn't enough. */
  insights: string[];
  reps: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null) => (n === null ? null : Math.round(n));

export function formIntelligence(rows: readonly FormRepRow[], range: { from: string; to: string }): FormIntelligence {
  const inRange = rows.filter((r) => r.localDate >= range.from && r.localDate <= range.to);
  const byWorkout = new Map<string, FormRepRow[]>();
  for (const r of inRange) byWorkout.set(r.workoutId, [...(byWorkout.get(r.workoutId) ?? []), r]);

  const sessions: FormSession[] = [...byWorkout.entries()]
    .map(([workoutId, reps]) => {
      const scores = reps.map((r) => r.formScore).filter((x): x is number => x !== null);
      const m = mean(scores);
      const spread = scores.length >= 3 && m !== null ? Math.sqrt(scores.reduce((a, s) => a + (s - m) ** 2, 0) / scores.length) : null;
      return {
        localDate: reps[0]!.localDate,
        workoutId,
        topLoadKg: Math.max(0, ...reps.map((r) => r.loadKg)),
        verifiedReps: reps.length,
        formScore: round(m),
        romPercent: round(mean(reps.map((r) => r.romPercent).filter((x): x is number => x !== null))),
        repSpread: spread === null ? null : Math.round(spread * 10) / 10,
      };
    })
    .sort((a, b) => (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0));

  const formTrend = computeTrend(sessions.filter((s) => s.formScore !== null).map((s) => ({ date: s.localDate, value: s.formScore! })), METRICS.form, range);
  const romTrend = computeTrend(sessions.filter((s) => s.romPercent !== null).map((s) => ({ date: s.localDate, value: s.romPercent! })), METRICS.rom, range);

  // Issues: earlier half of sessions vs recent half (needs at least two sessions).
  const issues: FormIntelligence["issues"] = [];
  if (sessions.length >= 2) {
    const half = Math.floor(sessions.length / 2);
    const earlierIds = new Set(sessions.slice(0, half).map((s) => s.workoutId));
    const earlier = inRange.filter((r) => earlierIds.has(r.workoutId));
    const recent = inRange.filter((r) => !earlierIds.has(r.workoutId));
    const share = (reps: FormRepRow[], code: FormIssueCode) => (reps.length ? Math.round((reps.filter((r) => r.issues.includes(code)).length / reps.length) * 100) : 0);
    const codes = new Set(inRange.flatMap((r) => r.issues));
    for (const code of codes) {
      const e = share(earlier, code);
      const n = share(recent, code);
      issues.push({ code, label: ISSUE_LABELS[code] ?? code, earlierPercent: e, recentPercent: n, change: n <= e - 10 ? "fewer" : n >= e + 10 ? "more" : "steady" });
    }
    issues.sort((a, b) => b.recentPercent - a.recentPercent);
  }

  const loads = new Map<number, FormRepRow[]>();
  for (const r of inRange) loads.set(r.loadKg, [...(loads.get(r.loadKg) ?? []), r]);
  const byLoad = [...loads.entries()]
    .map(([loadKg, reps]) => ({
      loadKg,
      sessions: new Set(reps.map((r) => r.workoutId)).size,
      reps: reps.length,
      formScore: round(mean(reps.map((r) => r.formScore).filter((x): x is number => x !== null))),
      romPercent: round(mean(reps.map((r) => r.romPercent).filter((x): x is number => x !== null))),
    }))
    .sort((a, b) => a.loadKg - b.loadKg);

  const insights: string[] = [];
  if (formTrend.direction === TREND.IMPROVING && formTrend.from !== null && formTrend.to !== null) insights.push(`Form has improved from about ${Math.round(formTrend.from)} to ${Math.round(formTrend.to)} over ${formTrend.points} sessions.`);
  if (formTrend.direction === TREND.DECLINING && formTrend.from !== null && formTrend.to !== null) insights.push(`Form has slipped from about ${Math.round(formTrend.from)} to ${Math.round(formTrend.to)} — worth a lighter, cleaner session.`);
  const scored = byLoad.filter((l) => l.formScore !== null && l.reps >= 5 && l.loadKg > 0);
  if (scored.length >= 2) {
    const light = scored[0]!;
    const heavy = scored[scored.length - 1]!;
    if (heavy.formScore! <= light.formScore! - 8) insights.push(`Form drops at heavier loads: ${light.formScore} at ${light.loadKg} kg vs ${heavy.formScore} at ${heavy.loadKg} kg.`);
    else insights.push(`Form held up as the load went from ${light.loadKg} to ${heavy.loadKg} kg (${light.formScore} → ${heavy.formScore}).`);
  }
  const better = issues.find((i) => i.change === "fewer");
  if (better) insights.push(`${better.label} is improving: flagged on ${better.recentPercent}% of recent reps, down from ${better.earlierPercent}%.`);
  const worse = issues.find((i) => i.change === "more");
  if (worse) insights.push(`${worse.label} needs attention: flagged on ${worse.recentPercent}% of recent reps, up from ${worse.earlierPercent}%.`);

  return { sessions, formTrend, romTrend, issues, byLoad, insights, reps: inRange.length };
}
