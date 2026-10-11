/**
 * The pose models and the numbers the engines tune around them. Plain data with no imports, so the
 * phone engine, the web provider and the app config can all share it.
 *
 * FORM starts on the FULL model (steadier joints) and quietly drops to LITE on a phone that can't
 * run it fast enough (median inference above MODEL_BUDGET_MS).
 */
export const POSE_MODEL_URLS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
} as const;

/** Detection / presence / tracking confidence handed to MediaPipe. The drawing layer adds its own hysteresis. */
export const POSE_CONFIDENCE = { detection: 0.5, presence: 0.4, tracking: 0.4 } as const;

/** A full model whose median inference is slower than this (ms) is swapped for the lite one. */
export const MODEL_BUDGET_MS = 32;

/** Rough download sizes (bytes), used for the progress bar until the server reports the real size. */
export const MODEL_BYTES = { full: 9_000_000, lite: 5_500_000 } as const;
