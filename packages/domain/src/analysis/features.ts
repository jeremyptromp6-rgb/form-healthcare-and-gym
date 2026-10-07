import type { PoseKeypoint } from "../camera/pose";

/**
 * Per-frame form features, measured from pixel-space landmarks of one body side in a side view.
 * These are 2D proxies — FORM reports them as coaching cues, not biomechanical measurements.
 * A feature is omitted (never guessed) when its landmarks aren't clearly visible.
 */

export type FeatureName =
  /** Angle of the hip→shoulder line from vertical (0 = upright). */
  | "torsoLeanDeg"
  /** Hip angle shoulder–hip–knee. */
  | "hipDeg"
  /** Knee travel past the toes, in shin lengths (+ = ahead of the toes). */
  | "kneeTravel"
  /** Heel height above the toes, in shin lengths (+ = heel lifted). */
  | "heelLift"
  /** Shoulder–hip–ankle angle (180 = straight body line). */
  | "bodyLineDeg"
  /** Hip offset from the shoulder–ankle line, in body lengths (+ = sagging, − = piking). */
  | "hipSag"
  /** Forearm (wrist→elbow) angle from vertical (0 = elbow stacked over the wrist). */
  | "forearmTiltDeg"
  /** Upper arm vs torso: hip–shoulder–elbow angle (0 = elbow pinned to the side). */
  | "upperArmDeg";

export type FrameFeatures = Partial<Record<FeatureName, number>>;

export const FEATURE_NAMES: readonly FeatureName[] = ["torsoLeanDeg", "hipDeg", "kneeTravel", "heelLift", "bodyLineDeg", "hipSag", "forearmTiltDeg", "upperArmDeg"];

export type FeatureFamily = "squat" | "lunge" | "push_up" | "curl";

/** Landmarks must be at least this confident to feed a form feature (stricter than angle sampling). */
export const FEATURE_MIN_CONFIDENCE = 0.5;

type P = { x: number; y: number };

const deg = (rad: number) => (rad * 180) / Math.PI;
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** Angle ABC at B in degrees. */
function angleAt(a: P, b: P, c: P): number | null {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (n === 0) return null;
  return deg(Math.acos(Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / n))));
}

/** Angle of the vector from→to measured from straight up (image y grows downward). */
function fromVertical(from: P, to: P): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  return deg(Math.atan2(Math.abs(dx), -dy));
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/**
 * Extracts the features a family's form rules use, from one side's landmarks (pixel space).
 * `side` is the body side the primary joint angle was measured on.
 */
export function extractFeatures(family: FeatureFamily, keypoints: readonly PoseKeypoint[], side: "left" | "right"): FrameFeatures {
  const pts = new Map(keypoints.filter((k) => k.confidence >= FEATURE_MIN_CONFIDENCE).map((k) => [k.name, k]));
  const get = (joint: string) => pts.get(`${side}_${joint}`);
  const shoulder = get("shoulder");
  const hip = get("hip");
  const knee = get("knee");
  const ankle = get("ankle");
  const heel = get("heel");
  const foot = get("foot");
  const elbow = get("elbow");
  const wrist = get("wrist");
  const out: FrameFeatures = {};
  const set = (name: FeatureName, v: number | null, dp = 1) => {
    if (v !== null && Number.isFinite(v)) out[name] = round(v, dp);
  };

  if (shoulder && hip) set("torsoLeanDeg", fromVertical(hip, shoulder));

  // Facing direction along x: toes point forward; fall back to nose vs ear.
  const nose = pts.get("nose");
  const ear = get("ear");
  let dir = 0;
  if (foot && heel && Math.abs(foot.x - heel.x) > 1) dir = Math.sign(foot.x - heel.x);
  else if (nose && ear && Math.abs(nose.x - ear.x) > 1) dir = Math.sign(nose.x - ear.x);

  if (family === "squat" || family === "lunge") {
    if (shoulder && hip && knee) set("hipDeg", angleAt(shoulder, hip, knee));
    const shin = knee && ankle ? dist(knee, ankle) : 0;
    if (shin > 0 && knee && foot && dir !== 0) set("kneeTravel", ((knee.x - foot.x) * dir) / shin, 2);
    if (shin > 0 && heel && foot) set("heelLift", (foot.y - heel.y) / shin, 2);
  }

  if (family === "push_up" && shoulder && hip && ankle) {
    set("bodyLineDeg", angleAt(shoulder, hip, ankle));
    const len = dist(shoulder, ankle);
    if (len > 0 && Math.abs(ankle.x - shoulder.x) > 1) {
      const t = (hip.x - shoulder.x) / (ankle.x - shoulder.x);
      const lineY = shoulder.y + t * (ankle.y - shoulder.y);
      set("hipSag", (hip.y - lineY) / len, 3);
    }
  }
  if (family === "push_up" && elbow && wrist) set("forearmTiltDeg", fromVertical(wrist, elbow));

  if (family === "curl" && hip && shoulder && elbow) set("upperArmDeg", angleAt(hip, shoulder, elbow));

  return out;
}
