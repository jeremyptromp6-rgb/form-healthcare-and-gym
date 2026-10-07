import type { ProviderBase, ProviderResult } from "../providers/result";

/**
 * Camera / pose boundary. Frames are processed transiently on the device and never persisted;
 * only landmarks (and, for verification, derived joint-angle traces) leave this boundary.
 *
 *   Camera → PoseProvider (frame → PoseDetection) → framing check → ExerciseAnalyzer → rep/form/ROM consumers
 */

/**
 * One body landmark. `x`/`y` are normalized to the frame (0–1, origin top-left, un-mirrored);
 * values outside 0–1 mean the model predicts the point is outside the frame. `confidence` is
 * the provider's likelihood (0–1) that the point is visible.
 */
export interface PoseKeypoint {
  name: string;
  x: number;
  y: number;
  confidence: number;
}

/** One detected person. */
export interface PosePerson {
  keypoints: PoseKeypoint[];
}

/** Everything the provider saw in one frame. `people` is empty when nobody is detected. */
export interface PoseDetection {
  /** Monotonic capture time of the frame, in ms. */
  timestampMs: number;
  /** Source frame size in pixels — needed to measure angles without aspect distortion. */
  frame: { width: number; height: number };
  people: PosePerson[];
  /** Mean frame luminance 0–255, when the provider samples it (low-light detection). */
  brightness?: number;
}

/** Raw pixels, for providers that consume frame buffers (native frame processors). */
export interface PoseFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * A pose model. `Input` is whatever the platform hands it (a pixel buffer, a video element…).
 * Implementations must run on the device for live camera input — frames never leave it — and
 * must fail honestly (unconfigured / unavailable) instead of returning invented landmarks.
 */
export interface PoseProvider<Input = PoseFrame> extends ProviderBase {
  readonly kind: "pose";
  /** Prepare the model (download/compile). Idempotent. */
  load?(): Promise<ProviderResult<void>>;
  estimate(input: Input, timestampMs: number): Promise<ProviderResult<PoseDetection>>;
  /** Release model memory / GPU resources. */
  close?(): void;
}

export type CameraPermission = "granted" | "denied" | "undetermined";

// ---- Canonical landmarks ---------------------------------------------------------------

/** The landmarks FORM's analyzers use. Providers map their own model's points onto these names. */
export const CANONICAL_LANDMARKS = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hand",
  "right_hand",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot",
  "right_foot",
] as const;

export type LandmarkName = (typeof CANONICAL_LANDMARKS)[number];

/** Bones drawn by the live skeleton overlay. */
export const SKELETON_EDGES: readonly (readonly [LandmarkName, LandmarkName])[] = [
  ["left_shoulder", "right_shoulder"],
  ["left_hip", "right_hip"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["left_wrist", "left_hand"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["right_wrist", "right_hand"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["left_ankle", "left_heel"],
  ["left_heel", "left_foot"],
  ["left_ankle", "left_foot"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_heel"],
  ["right_heel", "right_foot"],
  ["right_ankle", "right_foot"],
  ["left_ear", "left_eye"],
  ["left_eye", "nose"],
  ["nose", "right_eye"],
  ["right_eye", "right_ear"],
];

/**
 * MediaPipe Pose Landmarker (BlazePose, 33 points) index → canonical name. Points FORM doesn't
 * use (inner/outer eye, mouth, pinky, thumb) map to null and are dropped.
 */
export const MEDIAPIPE_POSE_INDEX: readonly (LandmarkName | null)[] = [
  "nose", // 0
  null, // 1 left eye inner
  "left_eye", // 2
  null, // 3 left eye outer
  null, // 4 right eye inner
  "right_eye", // 5
  null, // 6 right eye outer
  "left_ear", // 7
  "right_ear", // 8
  null, // 9 mouth left
  null, // 10 mouth right
  "left_shoulder", // 11
  "right_shoulder", // 12
  "left_elbow", // 13
  "right_elbow", // 14
  "left_wrist", // 15
  "right_wrist", // 16
  null, // 17 left pinky
  null, // 18 right pinky
  "left_hand", // 19 left index finger
  "right_hand", // 20 right index finger
  null, // 21 left thumb
  null, // 22 right thumb
  "left_hip", // 23
  "right_hip", // 24
  "left_knee", // 25
  "right_knee", // 26
  "left_ankle", // 27
  "right_ankle", // 28
  "left_heel", // 29
  "right_heel", // 30
  "left_foot", // 31 left foot index
  "right_foot", // 32 right foot index
];

/** Converts one MediaPipe pose (normalized landmarks) to canonical keypoints. */
export function fromMediaPipePose(landmarks: readonly { x: number; y: number; visibility?: number }[]): PoseKeypoint[] {
  const out: PoseKeypoint[] = [];
  landmarks.forEach((l, i) => {
    const name = MEDIAPIPE_POSE_INDEX[i];
    if (!name || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return;
    const confidence = Number.isFinite(l.visibility) ? Math.min(1, Math.max(0, l.visibility!)) : 0;
    out.push({ name, x: l.x, y: l.y, confidence });
  });
  return out;
}

/**
 * Normalized keypoints → pixel space. Joint angles must be measured here: on a 16:9 frame,
 * normalized coordinates stretch one axis and distort every angle.
 */
export function toPixelSpace(keypoints: readonly PoseKeypoint[], frame: { width: number; height: number }): PoseKeypoint[] {
  return keypoints.map((k) => ({ ...k, x: k.x * frame.width, y: k.y * frame.height }));
}
