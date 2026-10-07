import { extractFeatures } from "../analysis/features";
import { assessRepForm, EXERCISE_FAMILY, type RepForm } from "../analysis/formAnalysis";
import { MovementStateMachine, ROM_SPECS, verifyReps, type AngleSample, type RepTrace, type RepVerificationResult, type RomSpec, type VerifiedRep } from "../analysis/repVerification";
import { EXERCISE_BY_ID } from "../workouts/exercises";
import type { PoseKeypoint } from "./pose";

/**
 * Camera analysis contracts. The pipeline is:
 *
 *   PoseProvider (frames → keypoints)
 *     → ExerciseAnalyzer (keypoints → joint angle + form features per frame)
 *       → MovementStateMachine (angles → rep events, live)
 *         → RepVerifier (recorded trace → verified reps, server-side, authoritative)
 *           → FormAnalyzer (rep frames → 0–100 form score) · ROMAnalyzer (reps → ROM summary)
 *
 * Everything below the PoseProvider is real, deterministic geometry and rules. Pose providers
 * run on the user's device (the web app ships MediaPipe; see camera/livePose.ts for the live
 * consumer) — frames never reach the API, which only ever sees derived angle/feature traces.
 */

// ---- ExerciseAnalyzer ---------------------------------------------------------------

const MIN_KEYPOINT_CONFIDENCE = 0.3;

/** Angle ABC in degrees (at vertex B), 0–180. */
export function jointAngleDeg(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number | null {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const n1 = Math.hypot(v1.x, v1.y);
  const n2 = Math.hypot(v2.x, v2.y);
  if (n1 === 0 || n2 === 0) return null;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

const JOINTS = {
  knee: ["hip", "knee", "ankle"],
  elbow: ["shoulder", "elbow", "wrist"],
} as const;

export interface ExerciseAnalyzer {
  exerciseId: string;
  spec: RomSpec;
  /**
   * One sample from one frame's keypoints (pixel space): the primary joint angle plus form
   * features from the same side, or null if the joint isn't clearly visible.
   */
  sample(keypoints: PoseKeypoint[], tMs: number): AngleSample | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Builds the analyzer for a camera-supported exercise. Uses the more confidently visible body
 * side — except lunges, which measure the front leg (the one whose ankle is further forward)
 * when both legs are visible. Returns null for exercises without camera support.
 */
export function exerciseAnalyzer(exerciseId: string): ExerciseAnalyzer | null {
  const exercise = EXERCISE_BY_ID.get(exerciseId);
  const spec = (ROM_SPECS as Record<string, RomSpec>)[exerciseId];
  const family = EXERCISE_FAMILY[exerciseId];
  if (!exercise?.camera || !spec || !family) return null;
  const [a, b, c] = JOINTS[exercise.camera.joint];
  return {
    exerciseId,
    spec,
    sample(keypoints, tMs) {
      const find = (name: string) => keypoints.find((k) => k.name === name);
      const candidates: { side: "left" | "right"; angle: number; confidence: number; ankleX: number }[] = [];
      for (const side of ["left", "right"] as const) {
        const pts = [find(`${side}_${a}`), find(`${side}_${b}`), find(`${side}_${c}`)];
        if (pts.some((p) => !p || p.confidence < MIN_KEYPOINT_CONFIDENCE)) continue;
        const angle = jointAngleDeg(pts[0]!, pts[1]!, pts[2]!);
        if (angle === null) continue;
        candidates.push({ side, angle, confidence: Math.min(...pts.map((p) => p!.confidence)), ankleX: pts[2]!.x });
      }
      if (candidates.length === 0) return null;
      let best = candidates.reduce((x, y) => (y.confidence > x.confidence ? y : x));
      if (family === "lunge" && candidates.length === 2) {
        const dir = facing(keypoints);
        if (dir !== 0) best = candidates.reduce((x, y) => (y.ankleX * dir > x.ankleX * dir ? y : x));
      }
      const features = extractFeatures(family, keypoints, best.side);
      return { tMs, angleDeg: round1(best.angle), confidence: Math.round(best.confidence * 1000) / 1000, ...(Object.keys(features).length ? { features } : {}) };
    },
  };
}

/** +1 facing right, −1 facing left, 0 unknown (toes, else nose vs ears). */
function facing(keypoints: PoseKeypoint[]): number {
  const find = (name: string) => keypoints.find((k) => k.name === name && k.confidence >= 0.5);
  for (const side of ["left", "right"]) {
    const foot = find(`${side}_foot`);
    const heel = find(`${side}_heel`);
    if (foot && heel && Math.abs(foot.x - heel.x) > 1) return Math.sign(foot.x - heel.x);
  }
  const nose = find("nose");
  const ear = find("left_ear") ?? find("right_ear");
  return nose && ear && Math.abs(nose.x - ear.x) > 1 ? Math.sign(nose.x - ear.x) : 0;
}

// ---- Live rep counting --------------------------------------------------------------

/** Minimal live counter: feed frames, get rep events as they happen (see LiveRepVerifier for the full coach). */
export function liveRepCounter(exerciseId: string) {
  const analyzer = exerciseAnalyzer(exerciseId);
  if (!analyzer) return null;
  const machine = new MovementStateMachine(analyzer.spec);
  return {
    push(keypoints: PoseKeypoint[], tMs: number) {
      const s = analyzer.sample(keypoints, tMs);
      return s ? machine.push(s) : [];
    },
    result: () => machine.result(),
  };
}

// ---- RepVerifier ---------------------------------------------------------------------

/** Server-side, authoritative verification of a recorded trace. The client's live count is never trusted. */
export interface RepVerifier {
  verify(exerciseId: string, trace: RepTrace): RepVerificationResult | null;
}

export const repVerifier: RepVerifier = {
  verify(exerciseId, trace) {
    const spec = (ROM_SPECS as Record<string, RomSpec>)[exerciseId];
    return spec ? verifyReps(trace, spec) : null;
  },
};

// ---- ROMAnalyzer ----------------------------------------------------------------------

export interface RomSummary {
  averageRomPercent: number;
  minRomPercent: number;
  /** Fraction of reps reaching full ROM (100%). */
  fullRangeShare: number;
}

export interface ROMAnalyzer {
  analyze(reps: readonly Pick<VerifiedRep, "romPercent">[]): RomSummary | null;
}

export const romAnalyzer: ROMAnalyzer = {
  analyze(reps) {
    if (reps.length === 0) return null;
    const roms = reps.map((r) => r.romPercent);
    return {
      averageRomPercent: Math.round(roms.reduce((a, b) => a + b, 0) / roms.length),
      minRomPercent: Math.min(...roms),
      fullRangeShare: Math.round((roms.filter((r) => r >= 100).length / roms.length) * 100) / 100,
    };
  },
};

// ---- FormAnalyzer ---------------------------------------------------------------------

/** Scores a verified rep from its frames (see analysis/formAnalysis for the rules). */
export interface FormAnalyzer {
  analyze(exerciseId: string, rep: VerifiedRep, samples: readonly AngleSample[]): RepForm | null;
}

export const formAnalyzer: FormAnalyzer = { analyze: assessRepForm };
