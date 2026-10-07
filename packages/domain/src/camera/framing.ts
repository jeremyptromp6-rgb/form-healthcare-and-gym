import type { PoseDetection, PoseKeypoint, PosePerson } from "./pose";

/**
 * Framing check: can this frame be analyzed for this exercise, and if not, what should the user
 * change? Pure geometry on the provider's landmarks — nothing here guesses a body that the model
 * didn't report. Rep, form and ROM consumers only receive frames that pass (`trackable`).
 */

export type FramingIssue =
  | "no_person"
  | "left_frame"
  | "multiple_people"
  | "low_light"
  | "too_close"
  | "too_far"
  | "partial_body"
  | "occluded"
  | "insufficient_landmarks";

export type BodySide = "left" | "right";

export interface CameraRequirement {
  /** Landmarks needed on one body side (without the side prefix). Either side satisfies it. */
  chain: readonly string[];
  /** Whether the whole body must be in frame (drives the too-far threshold and messages). */
  fullBody: boolean;
}

const KNEE_CHAIN: CameraRequirement = { chain: ["shoulder", "hip", "knee", "ankle"], fullBody: true };

/** What each camera-ready exercise needs to see. Keys match the ROM specs the verifier implements. */
export const CAMERA_REQUIREMENTS: Readonly<Record<string, CameraRequirement>> = {
  squat: KNEE_CHAIN,
  bodyweight_squat: KNEE_CHAIN,
  goblet_squat: KNEE_CHAIN,
  lunge: KNEE_CHAIN,
  push_up: { chain: ["shoulder", "elbow", "wrist", "hip", "ankle"], fullBody: true },
  bicep_curl: { chain: ["shoulder", "elbow", "wrist", "hip"], fullBody: false },
};

export const FRAMING_THRESHOLDS = {
  /** A landmark counts as visible at or above this confidence. */
  visibleConfidence: 0.5,
  /** A second person must show at least this many visible landmarks to count (filters posters, reflections). */
  minPersonLandmarks: 8,
  /** Fewer visible landmarks than this on the tracked person: we can't see enough of the body. */
  minLandmarks: 6,
  /** Mean frame luminance (0–255) below this is too dark regardless of the landmarks. */
  darkBrightness: 40,
  /** Below this, missing landmarks are blamed on light rather than occlusion. */
  dimBrightness: 70,
  /** Visible body extent (fraction of the frame's larger body axis) below which the user is too far. */
  minExtentFullBody: 0.4,
  minExtentUpperBody: 0.3,
  /** Body extent at or above which a cut-off body means "too close" rather than "off-center". */
  closeExtent: 0.85,
  /** Coordinates this far outside 0–1 count as outside the frame. */
  edgeMargin: 0.02,
} as const;

export const FRAMING_MESSAGES: Record<FramingIssue, string> = {
  no_person: "Step into view so your full body is visible.",
  left_frame: "You've left the frame — step back in to continue.",
  multiple_people: "More than one person is in view. Make sure only you are in frame.",
  low_light: "It's too dark to track you — add light in front of you.",
  too_close: "Move farther away so your full body is visible.",
  too_far: "Move closer — you're too far away to track accurately.",
  partial_body: "Part of your body is out of frame.",
  occluded: "Part of your body is hidden — clear the space between you and the camera.",
  insufficient_landmarks: "We can't see enough of your body yet — stand side-on with your whole body in view.",
};

const READY_MESSAGE = "Tracking — you're in position.";

export interface FramingAssessment {
  issue: FramingIssue | null;
  message: string;
  /** All required landmarks are visible on one side: analyzers may consume this frame. */
  trackable: boolean;
  /** The body side being tracked, when one is usable. */
  side: BodySide | null;
  /** Required landmarks (full names) that aren't visible. */
  missing: string[];
}

type PointState = "visible" | "hidden" | "off_frame" | "absent";

function pointState(k: PoseKeypoint | undefined): PointState {
  if (!k) return "absent";
  const m = FRAMING_THRESHOLDS.edgeMargin;
  if (k.x < -m || k.x > 1 + m || k.y < -m || k.y > 1 + m) return "off_frame";
  return k.confidence >= FRAMING_THRESHOLDS.visibleConfidence ? "visible" : "hidden";
}

function visibleCount(p: PosePerson): number {
  return p.keypoints.filter((k) => pointState(k) === "visible").length;
}

/** Bounding box of the visible landmarks, normalized. */
function visibleBox(p: PosePerson) {
  const pts = p.keypoints.filter((k) => pointState(k) === "visible");
  if (pts.length === 0) return null;
  const xs = pts.map((k) => k.x);
  const ys = pts.map((k) => k.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function result(issue: FramingIssue | null, extra: Partial<FramingAssessment> = {}): FramingAssessment {
  return { issue, message: issue ? FRAMING_MESSAGES[issue] : READY_MESSAGE, trackable: issue === null, side: null, missing: [], ...extra };
}

/** Where the off-frame required landmarks went, as advice. */
function partialMessage(off: PoseKeypoint[]): string {
  const below = off.filter((k) => k.y > 1).length;
  const above = off.filter((k) => k.y < 0).length;
  const sideways = off.length - below - above;
  if (below >= above && below >= sideways) return "Your lower body is out of frame — step back or tilt the camera down.";
  if (above >= sideways) return "Your upper body is out of frame — step back or tilt the camera up.";
  return "Move toward the center of the frame so your whole side is visible.";
}

/**
 * Assesses one frame for one exercise. The primary person is the one with the most visible
 * landmarks; a second clearly visible person blocks tracking (we can't tell whose reps count).
 */
export function assessFraming(detection: PoseDetection, requirement: CameraRequirement): FramingAssessment {
  const t = FRAMING_THRESHOLDS;
  const people = detection.people
    .map((p) => ({ p, n: visibleCount(p) }))
    .sort((a, b) => b.n - a.n);
  const dark = detection.brightness !== undefined && detection.brightness < t.darkBrightness;
  const dim = detection.brightness !== undefined && detection.brightness < t.dimBrightness;

  if (people.length === 0) return result(dark ? "low_light" : "no_person");
  if (people.filter((x) => x.n >= t.minPersonLandmarks).length > 1) return result("multiple_people");
  if (dark) return result("low_light");

  const person = people[0]!.p;
  const byName = new Map(person.keypoints.map((k) => [k.name, k]));

  // Pick the side that shows the most of the chain; ties go to the more confident side.
  let best: { side: BodySide; states: [string, PointState, PoseKeypoint | undefined][]; score: number } | null = null;
  for (const side of ["left", "right"] as const) {
    const states = requirement.chain.map((j) => {
      const name = `${side}_${j}`;
      const k = byName.get(name);
      return [name, pointState(k), k] as [string, PointState, PoseKeypoint | undefined];
    });
    const visible = states.filter(([, s]) => s === "visible");
    const score = visible.length + visible.reduce((a, [, , k]) => a + (k?.confidence ?? 0), 0) / 100;
    if (!best || score > best.score) best = { side, states, score };
  }
  const { side, states } = best!;
  const missing = states.filter(([, s]) => s !== "visible").map(([n]) => n);
  const box = visibleBox(person);
  const extent = box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) : 0;

  if (missing.length === 0) {
    const minExtent = requirement.fullBody ? t.minExtentFullBody : t.minExtentUpperBody;
    if (extent < minExtent) return result("too_far", { side });
    return result(null, { side });
  }

  if (visibleCount(person) < t.minLandmarks) return result(dim ? "low_light" : "insufficient_landmarks", { missing });

  const off = states.filter(([, s]) => s === "off_frame").map(([, , k]) => k!);
  if (off.length > 0) {
    const cutBothEnds = off.some((k) => k.y > 1) && off.some((k) => k.y < 0);
    if (cutBothEnds || extent >= t.closeExtent) return result("too_close", { missing });
    return { ...result("partial_body", { missing }), message: partialMessage(off) };
  }
  return result(dim ? "low_light" : "occluded", { missing });
}

// ---- Temporal smoothing ----------------------------------------------------------------

export const FRAMING_TIMING = {
  /** A new issue must persist this long before the UI switches to it (no flicker). */
  settleMs: 400,
  /** "Left the frame" (vs. "step into view") if the person was trackable this recently. */
  leftFrameWindowMs: 5000,
  /** No detection for this long means the frame stream was interrupted. */
  staleMs: 1500,
} as const;

/**
 * Smooths per-frame assessments for display. Per-frame `trackable` still gates analysis exactly;
 * only the message the user reads is debounced.
 */
export class FramingTracker {
  private stable: FramingAssessment | null = null;
  private pending: { issue: FramingIssue | null; since: number } | null = null;
  private lastTrackableAt = -Infinity;
  private lastFrameAt = -Infinity;

  constructor(private readonly requirement: CameraRequirement) {}

  update(detection: PoseDetection): { frame: FramingAssessment; stable: FramingAssessment } {
    const t = detection.timestampMs;
    this.lastFrameAt = t;
    let frame = assessFraming(detection, this.requirement);
    if (frame.trackable) this.lastTrackableAt = t;
    else if (frame.issue === "no_person" && t - this.lastTrackableAt <= FRAMING_TIMING.leftFrameWindowMs) frame = result("left_frame");

    if (!this.stable) this.stable = frame;
    else if (frame.issue === this.stable.issue) {
      this.stable = frame; // same issue: take fresh details (side, missing, message)
      this.pending = null;
    } else if (!this.pending || this.pending.issue !== frame.issue) this.pending = { issue: frame.issue, since: t };
    else if (t - this.pending.since >= FRAMING_TIMING.settleMs) {
      this.stable = frame;
      this.pending = null;
    }
    return { frame, stable: this.stable };
  }

  /** True when frames have stopped arriving (tab hidden, camera stalled, provider hung). */
  isStale(nowMs: number): boolean {
    return nowMs - this.lastFrameAt > FRAMING_TIMING.staleMs;
  }

  reset(): void {
    this.stable = null;
    this.pending = null;
    this.lastTrackableAt = -Infinity;
    this.lastFrameAt = -Infinity;
  }
}
