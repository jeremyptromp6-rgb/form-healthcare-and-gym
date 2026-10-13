import type { StyleProp, ViewStyle } from 'react-native';

// The JS side of the native pose camera view (Android only). The Kotlin side is in
// android/src/main/java/app/form/posecamera (Events.kt for the payloads, FormPoseCameraModule.kt for
// the props). A field the native side has nothing to say for arrives as null, not undefined.

export type NativeCameraErrorName =
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'NotReadableError'
  | 'NotSupportedError';

export interface NativeCameraEvent {
  kind: 'live' | 'ended' | 'error';
  /** Uses the WebView engine's error names so cameraErrorStatus() maps it unchanged. */
  name?: NativeCameraErrorName | string | null;
}

export interface NativePoseEvent {
  kind: 'loading' | 'ready' | 'failed' | 'model';
  /** loading */
  stage?: 'model' | 'starting' | null;
  pct?: number | null;
  /** ready */
  backend?: 'GPU' | 'CPU' | null;
  /** model (also sent with ready) */
  variant?: 'full' | 'lite' | 'switching' | null;
  /** ready / model */
  rung?: 'mask' | 'capsule' | 'joints' | null;
  /** failed */
  offline?: boolean | null;
  message?: string | null;
  /** failed: no point retrying natively; JS switches this session to the WebView engine. */
  fatal?: boolean | null;
}

export interface NativeFrameEvent {
  /** Monotonic sensor-clock ms. */
  ts: number;
  /** Pixel size of the upright, un-mirrored visible region the landmarks are normalized over. */
  w: number;
  h: number;
  /** Inference time in ms. */
  ms: number;
  /** Mean brightness 0..255, or -1 when unknown. */
  b: number;
  /** Empty when nobody is in view, else 99 numbers: [x, y, visibility] x 33, MediaPipe order. */
  lm: number[];
}

export interface NativeDiagEvent {
  fps: number;
  inferMs: number;
  /** Age of the displayed result at draw time (not photon to pixel). */
  ageP50: number;
  ageP95: number;
  drawMs: number;
  backend: 'GPU' | 'CPU';
  variant: 'full' | 'lite';
  rung: 'mask' | 'capsule' | 'joints';
  mirrorX: boolean;
  region: string;
  view: string;
  maskMs: number;
  delegateNote: string;
}

/** '#RRGGBB' only. */
export interface NativePalette {
  good: string;
  fix: string;
  warn: string;
  untrackable: string;
  other: string;
  halo: string;
  highlight: string;
}

export interface FormPoseCameraViewProps {
  style?: StyleProp<ViewStyle>;
  active: boolean;
  /** Default 'front'. */
  facing?: 'front' | 'back';
  modelUrl: string;
  liteModelUrl?: string | null;
  /** Detection, presence, tracking (POSE_CONFIDENCE). */
  confidence: [number, number, number];
  /** MODEL_BUDGET_MS (32); native derives the other budgets. */
  budgetMs: number;
  overlayMode: 'outline' | 'joints' | 'off';
  tone: 'good' | 'fix' | 'warn' | 'untrackable';
  /** SkeletonState.chain. */
  chain: number[];
  palette: NativePalette;
  reduceMotion: boolean;
  /** JS kill switch for segmentation (default true). */
  maskEnabled?: boolean;
  /** Overlay lead for the preview pipeline latency in ms (default 60). */
  leadMs?: number;
  /** Emit onDiag at 1 Hz. */
  diagnostics?: boolean;
  onCamera?: (e: { nativeEvent: NativeCameraEvent }) => void;
  onPose?: (e: { nativeEvent: NativePoseEvent }) => void;
  onFrame?: (e: { nativeEvent: NativeFrameEvent }) => void;
  onDiag?: (e: { nativeEvent: NativeDiagEvent }) => void;
}

/** What requireOptionalNativeModule('FormPoseCamera') returns (Constants in FormPoseCameraModule.kt). */
export interface FormPoseCameraNativeModule {
  apiVersion: number;
}
