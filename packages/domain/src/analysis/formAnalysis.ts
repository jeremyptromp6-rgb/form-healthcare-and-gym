import type { FeatureFamily, FeatureName } from "./features";
import { ROM_SPECS, type AngleSample, type RomSpec, type VerifiedRep } from "./repVerification";

/**
 * Form analysis: a deterministic 0–100 score per verified rep from the frames of that rep.
 * Rules are 2D side-view heuristics with explicit thresholds — coaching cues, not clinical
 * measurement. A rule whose landmarks weren't visible for most of the rep is skipped (listed as
 * not assessed) instead of guessed. Form never changes whether a rep is verified; it scores it.
 */

export type FormIssueCode =
  | "depth"
  | "extension"
  | "tempo"
  | "torso_lean"
  | "knee_alignment"
  | "heel_lift"
  | "body_line"
  | "elbow_position"
  | "elbow_stability"
  | "torso_swing";

export interface FormIssue {
  code: FormIssueCode;
  message: string;
  severity: "minor" | "major";
  /** Points deducted from 100. */
  penalty: number;
}

export interface RepForm {
  score: number;
  /** Most important first. */
  issues: FormIssue[];
  /** Checks that had enough visible landmarks to run. */
  assessed: FormIssueCode[];
  /** Verified, near-full range and no issues. */
  perfect: boolean;
}

type Stat = "max" | "min" | "range" | "atBottom";

type Rule =
  | { kind: "feature"; code: FormIssueCode; message: string; feature: FeatureName; stat: Stat; limit: number; over: "above" | "below"; perUnit: number; cap: number }
  | { kind: "rom"; code: "depth"; message: string; minRom: number; perUnit: number; cap: number }
  | { kind: "extension"; code: "extension"; message: string; slackDeg: number; perUnit: number; cap: number }
  | { kind: "tempo"; code: "tempo"; message: string; minDurationMs: number; cap: number };

const TEMPO = (minDurationMs: number): Rule => ({ kind: "tempo", code: "tempo", message: "Control the movement", minDurationMs, cap: 10 });
const DEPTH = (message: string): Rule => ({ kind: "rom", code: "depth", message, minRom: 90, perUnit: 1, cap: 20 });
const EXTENSION: Rule = { kind: "extension", code: "extension", message: "Complete the full range", slackDeg: 5, perUnit: 1, cap: 15 };

export const FORM_RULES: Record<FeatureFamily, readonly Rule[]> = {
  squat: [
    DEPTH("Go slightly deeper"),
    { kind: "feature", code: "torso_lean", message: "Keep your back neutral", feature: "torsoLeanDeg", stat: "max", limit: 50, over: "above", perUnit: 1.2, cap: 25 },
    { kind: "feature", code: "knee_alignment", message: "Keep your knee aligned over your foot", feature: "kneeTravel", stat: "max", limit: 0.5, over: "above", perUnit: 40, cap: 15 },
    { kind: "feature", code: "heel_lift", message: "Keep your heels down", feature: "heelLift", stat: "max", limit: 0.15, over: "above", perUnit: 60, cap: 15 },
    TEMPO(1200),
  ],
  lunge: [
    DEPTH("Go slightly deeper"),
    { kind: "feature", code: "knee_alignment", message: "Keep your knee aligned over your ankle", feature: "kneeTravel", stat: "max", limit: 0.35, over: "above", perUnit: 40, cap: 20 },
    { kind: "feature", code: "torso_lean", message: "Keep your torso upright for balance", feature: "torsoLeanDeg", stat: "max", limit: 25, over: "above", perUnit: 1.2, cap: 20 },
    TEMPO(1200),
  ],
  push_up: [
    { kind: "feature", code: "body_line", message: "Keep your body in a straight line", feature: "bodyLineDeg", stat: "min", limit: 160, over: "below", perUnit: 1.5, cap: 30 },
    { kind: "feature", code: "elbow_position", message: "Keep your elbows over your wrists", feature: "forearmTiltDeg", stat: "atBottom", limit: 30, over: "above", perUnit: 0.8, cap: 15 },
    DEPTH("Go slightly deeper"),
    EXTENSION,
    TEMPO(1000),
  ],
  curl: [
    { kind: "feature", code: "elbow_stability", message: "Keep your elbows stable", feature: "upperArmDeg", stat: "range", limit: 20, over: "above", perUnit: 1.2, cap: 25 },
    { kind: "feature", code: "torso_swing", message: "Control the movement — don't swing", feature: "torsoLeanDeg", stat: "range", limit: 10, over: "above", perUnit: 1.5, cap: 20 },
    DEPTH("Complete the full range"),
    EXTENSION,
    TEMPO(1200),
  ],
};

export const EXERCISE_FAMILY: Readonly<Record<string, FeatureFamily>> = {
  squat: "squat",
  bodyweight_squat: "squat",
  goblet_squat: "squat",
  lunge: "lunge",
  push_up: "push_up",
  bicep_curl: "curl",
};

/** A feature must be visible in this share of the rep's frames (and ≥ 3 frames) to be judged. */
const MIN_COVERAGE = 0.6;
const MAJOR_PENALTY = 12;
const PERFECT_MIN_ROM = 95;

function statOf(values: { tMs: number; v: number }[], stat: Stat, bottomMs: number): number {
  const vs = values.map((x) => x.v);
  if (stat === "max") return Math.max(...vs);
  if (stat === "min") return Math.min(...vs);
  if (stat === "range") return Math.max(...vs) - Math.min(...vs);
  return values.reduce((best, x) => (Math.abs(x.tMs - bottomMs) < Math.abs(best.tMs - bottomMs) ? x : best)).v;
}

/** Scores one verified rep from the confident samples between its start and end. */
export function assessRepForm(exerciseId: string, rep: VerifiedRep, samples: readonly AngleSample[]): RepForm | null {
  const family = EXERCISE_FAMILY[exerciseId];
  const spec = (ROM_SPECS as Record<string, RomSpec>)[exerciseId];
  if (!family || !spec) return null;
  const frames = samples.filter((s) => s.tMs >= rep.startMs && s.tMs <= rep.endMs && s.confidence >= spec.minConfidence);

  const issues: FormIssue[] = [];
  const assessed: FormIssueCode[] = [];
  const add = (code: FormIssueCode, message: string, penalty: number, cap: number) => {
    const p = Math.round(Math.min(cap, penalty) * 10) / 10;
    if (p > 0) issues.push({ code, message, penalty: p, severity: p >= MAJOR_PENALTY ? "major" : "minor" });
  };

  for (const rule of FORM_RULES[family]) {
    if (rule.kind === "rom") {
      assessed.push(rule.code);
      if (rep.romPercent < rule.minRom) add(rule.code, rule.message, (rule.minRom - rep.romPercent) * rule.perUnit, rule.cap);
    } else if (rule.kind === "extension") {
      assessed.push(rule.code);
      const want = spec.fullRomTopDeg - rule.slackDeg;
      if (rep.peakAngleDeg < want) add(rule.code, rule.message, (want - rep.peakAngleDeg) * rule.perUnit, rule.cap);
    } else if (rule.kind === "tempo") {
      assessed.push(rule.code);
      if (rep.durationMs < rule.minDurationMs) add(rule.code, rule.message, ((rule.minDurationMs - rep.durationMs) / rule.minDurationMs) * 20, rule.cap);
    } else {
      const values = frames.flatMap((s) => (s.features?.[rule.feature] !== undefined ? [{ tMs: s.tMs, v: s.features[rule.feature]! }] : []));
      if (values.length < 3 || values.length < frames.length * MIN_COVERAGE) continue;
      assessed.push(rule.code);
      const v = statOf(values, rule.stat, rep.bottomMs);
      const excess = rule.over === "above" ? v - rule.limit : rule.limit - v;
      if (excess > 0) add(rule.code, rule.message, excess * rule.perUnit, rule.cap);
    }
  }

  issues.sort((a, b) => b.penalty - a.penalty);
  const score = Math.round(Math.max(0, Math.min(100, 100 - issues.reduce((a, i) => a + i.penalty, 0))));
  return { score, issues, assessed, perfect: issues.length === 0 && rep.romPercent >= PERFECT_MIN_ROM };
}

/** The cue shown for an issue on this exercise. */
export function issueMessage(exerciseId: string, code: FormIssueCode): string {
  const family = EXERCISE_FAMILY[exerciseId];
  return (family && FORM_RULES[family].find((r) => r.code === code)?.message) ?? code;
}
