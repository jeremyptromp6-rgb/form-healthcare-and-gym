import type { FramingAssessment, LiveRepState } from '@form/domain';
import type { StateKind } from '@/components/ui/feedback';

/**
 * Live camera state, split into the camera (can we see?) and the pose model (can we track?).
 * `cameraScreenModel` turns them into exactly one thing to show — pure, so every edge case is
 * unit-tested without a camera.
 */

export type CameraStatus =
  /** Not started: the user hasn't turned the camera on yet (we never open it unasked). */
  | { kind: 'off' }
  | { kind: 'requesting' }
  | { kind: 'denied'; canAskAgain: boolean }
  | { kind: 'unavailable'; reason: 'no_camera' | 'in_use' | 'insecure' | 'unsupported' | 'ended' | 'start_timeout' | 'stalled' }
  | { kind: 'live' }
  /** Frames stopped arriving (app backgrounded, stream stalled). */
  | { kind: 'interrupted' };

export type PoseStatus =
  | { kind: 'idle' }
  /** Phones: which start-up step the engine is on, and how much of the download is done. */
  | { kind: 'loading'; stage?: 'runtime' | 'model' | 'starting'; pct?: number }
  | { kind: 'ready'; backend: 'GPU' | 'CPU' }
  | { kind: 'failed'; message: string; retryable: boolean }
  /** This build/device has no on-device pose model. The feed may still show; nothing is tracked. */
  | { kind: 'unsupported'; message: string };

/** What the feed reports a few times a second (never per frame — that would re-render React). */
export interface LiveReadout {
  framing: FramingAssessment;
  trackable: boolean;
  angleDeg: number | null;
  people: number;
  fps: number;
  latencyMs: number;
  /** Live rep verification + coaching (same engine the server runs on the trace). */
  rep: LiveRepState | null;
  /** The set's trace hit its size cap: counting stops until the set is logged. */
  traceFull: boolean;
  /** The user faces the camera although the exercise is measured side-on (from the stance detector). */
  stance?: 'front-on' | null;
  /** Width / height of the video the feed analyses, once known; lets the screen size the feed box. */
  frameAspect?: number;
}

/** Preview-build diagnostics: how the live feed is performing (never shown in main builds). */
export interface PoseDiag {
  fps: number;
  inferMs: number | null;
  /** Result age at draw time (not photon-to-pixel latency). */
  ageP50: number | null;
  ageP95: number | null;
  backend: 'GPU' | 'CPU' | null;
  variant: 'full' | 'lite' | null;
  rung: 'mask' | 'capsule' | 'joints' | 'webview' | null;
  engine: 'native' | 'webview' | 'web';
  region?: string;
  view?: string;
  mirrorX?: boolean;
  leadMs?: number;
}

export type CameraAction = 'start' | 'retry' | 'settings';

/** The short "get into position" countdown before counting starts: 3, 2, 1, then a brief "ready". */
export type GetReadyStep = 3 | 2 | 1 | 'ready';

export interface CameraScreenModel {
  /**
   * Blocks the feed area (nothing useful to show behind it). `progress` (0..1, only while a download
   * reports it) and `tip` (the setup tip, so the wait is useful) belong to the first-run loading card.
   */
  overlay: { kind: StateKind; title: string; message: string; action: CameraAction | null; actionLabel: string | null; progress?: number | null; tip?: boolean } | null;
  /** One line of guidance under the feed; rep cues carry a headline ("CORRECT FORM"). */
  feedback: { message: string; tone: 'ready' | 'adjust' | 'info'; headline?: string } | null;
}

const MANUAL = 'You can still log your sets manually.';

/** "your 3 verified reps are kept" — said whenever the camera stops seeing you, so a dropout never feels like lost work. */
const keptReps = (n: number) => `your ${n} verified ${n === 1 ? 'rep is' : 'reps are'} kept`;
/** Framing problems where the person is gone or partly gone (not "too close", "too far" or "low light", which keep their own copy). */
const LOST_ISSUES = new Set(['no_person', 'left_frame', 'occluded', 'partial_body']);

const STANCE_HINT = 'Turn side-on — stand so the camera sees your side, not your front.';

const UNAVAILABLE: Record<Extract<CameraStatus, { kind: 'unavailable' }>['reason'], { title: string; message: string; retry: boolean }> = {
  no_camera: { title: 'No camera found', message: `Connect a camera or use a device with one. ${MANUAL}`, retry: true },
  in_use: { title: 'Camera is busy', message: `Another app is using the camera. Close it and try again. ${MANUAL}`, retry: true },
  insecure: { title: 'Camera needs a secure connection', message: `Open FORM over https to use the camera. ${MANUAL}`, retry: false },
  unsupported: { title: "Camera isn't supported here", message: `This browser or device can't provide a camera feed. ${MANUAL}`, retry: false },
  ended: { title: 'Camera disconnected', message: 'The camera stopped. Reconnect it and try again.', retry: true },
  start_timeout: { title: "The camera didn't start", message: `Try again. If it keeps happening, close other apps that use the camera and reopen FORM. ${MANUAL}`, retry: true },
  stalled: { title: 'The camera stopped', message: `Video stopped coming in. Try again. If it keeps happening, close other apps that use the camera. ${MANUAL}`, retry: true },
};

/** What to do while waiting: the same advice the exercise's setup gives, in one line. */
export const WAITING_TIP = 'While you wait: stand side-on to the phone, with your whole body in view, 2–3 m away, in good light.';

/** True while the model is being downloaded (and not yet fully on disk). */
function isDownloading(pose: PoseStatus): boolean {
  return pose.kind === 'loading' && (pose.stage === 'model' || pose.stage === 'runtime') && !(typeof pose.pct === 'number' && pose.pct >= 100);
}

/** Start-up in plain words. The first run downloads the model once; later starts skip straight to "starting". */
export function loadingMessage(pose: PoseStatus): string {
  if (pose.kind === 'loading' && isDownloading(pose)) return `First time only — about ${pose.stage === 'runtime' ? 20 : 10} MB. After this it starts in seconds.`;
  if (pose.kind === 'loading' && pose.stage) return 'Starting your camera coach…';
  return 'Just a moment…';
}

/** The loading card: real download progress when there is some, and the setup tip so the wait is useful. */
function loadingOverlay(pose: PoseStatus): NonNullable<CameraScreenModel['overlay']> {
  const starting = pose.kind === 'loading' && !!pose.stage && !isDownloading(pose);
  const pct = pose.kind === 'loading' && isDownloading(pose) && typeof pose.pct === 'number' ? Math.max(0, Math.min(99, Math.round(pose.pct))) : null;
  return {
    kind: 'loading',
    title: starting ? 'Almost ready' : 'Getting your camera coach ready',
    message: loadingMessage(pose),
    action: null,
    actionLabel: null,
    progress: pct === null ? null : pct / 100,
    tip: true,
  };
}

export function cameraScreenModel(camera: CameraStatus, pose: PoseStatus, readout: LiveReadout | null, paused: boolean, getReady: GetReadyStep | null = null): CameraScreenModel {
  switch (camera.kind) {
    case 'off':
      return {
        overlay: {
          kind: 'permission',
          title: 'Turn on the camera',
          message: 'FORM watches your movement on this device to count reps and coach your form. Video is never recorded or uploaded.',
          action: 'start',
          actionLabel: 'Turn on camera',
        },
        feedback: null,
      };
    case 'requesting':
      // The model downloads while the camera opens: once there is progress to show, show it.
      if (pose.kind === 'loading' && pose.stage) return { overlay: loadingOverlay(pose), feedback: null };
      return { overlay: { kind: 'loading', title: '', message: '', action: null, actionLabel: null }, feedback: { message: 'Starting your camera — if your phone asks, tap Allow.', tone: 'info' } };
    case 'denied':
      return {
        overlay: {
          kind: 'permission',
          title: 'Camera access is off',
          message: camera.canAskAgain
            ? `Allow camera access so FORM can count your reps and coach your form. ${MANUAL}`
            : `Turn on camera access for FORM in your settings. ${MANUAL}`,
          action: camera.canAskAgain ? 'retry' : 'settings',
          actionLabel: camera.canAskAgain ? 'Allow camera' : 'Open settings',
        },
        feedback: null,
      };
    case 'unavailable': {
      const u = UNAVAILABLE[camera.reason];
      return { overlay: { kind: 'unavailable', title: u.title, message: u.message, action: u.retry ? 'retry' : null, actionLabel: u.retry ? 'Try again' : null }, feedback: null };
    }
    default:
      break;
  }

  // Camera is live (or briefly interrupted): the feed shows; problems become guidance.
  if (pose.kind === 'failed') {
    return {
      overlay: { kind: 'error', title: "Camera coaching couldn't start", message: `${pose.message} ${MANUAL}`, action: pose.retryable ? 'retry' : null, actionLabel: pose.retryable ? 'Try again' : null },
      feedback: null,
    };
  }
  if (pose.kind === 'unsupported') return { overlay: null, feedback: { message: `${pose.message} ${MANUAL}`, tone: 'info' } };
  // Reps already verified in this set stay counted through a pause, a dropout and a lost track.
  const kept = readout?.rep?.verifiedReps ?? 0;
  if (paused) return { overlay: null, feedback: { message: kept > 0 ? `Paused — resume when you’re ready; ${keptReps(kept)}.` : 'Paused — resume when you’re ready.', tone: 'info' } };
  if (camera.kind === 'interrupted') return { overlay: null, feedback: { message: kept > 0 ? `Waiting for the camera to come back — ${keptReps(kept)}.` : 'Waiting for the camera to come back…', tone: 'adjust' } };
  if (pose.kind !== 'ready') return { overlay: loadingOverlay(pose), feedback: null };
  if (getReady === 'ready') return { overlay: null, feedback: { message: 'Ready — start when you like.', tone: 'ready' } };
  if (getReady !== null) return { overlay: null, feedback: { headline: 'GET INTO POSITION', message: 'Side-on, whole body in view. Counting starts in a moment.', tone: 'info' } };
  if (!readout) return { overlay: null, feedback: { message: 'Looking for you…', tone: 'info' } };
  // Priority: can't see you properly > set is full > facing the camera > the latest rep cue > where you are in the movement.
  // Nothing counts while you can't be tracked; if you were mid-set, the reps so far are kept and it says so.
  if (!readout.framing.trackable) {
    const lost = kept > 0 && !!readout.framing.issue && LOST_ISSUES.has(readout.framing.issue);
    return { overlay: null, feedback: { message: lost ? `Lost you — ${keptReps(kept)}. ${readout.framing.message}` : readout.framing.message, tone: 'adjust' } };
  }
  if (readout.traceFull) return { overlay: null, feedback: { message: 'This set is as long as one set can be — log it to keep counting.', tone: 'adjust' } };
  if (readout.stance === 'front-on') return { overlay: null, feedback: { message: STANCE_HINT, tone: 'adjust' } };
  const cue = readout.rep?.feedback;
  if (cue) return { overlay: null, feedback: { headline: cue.headline, message: cue.message, tone: cue.tone === 'good' ? 'ready' : 'adjust' } };
  if (readout.rep?.phase === 'unknown') return { overlay: null, feedback: { message: readout.rep.phaseLabel, tone: 'info' } };
  // Once the rep cue has faded: say honestly what did not count.
  const partial = readout.rep?.quality?.rejectedReps?.insufficient_rom ?? 0;
  if (partial > 0) return { overlay: null, feedback: { message: `${partial} ${partial === 1 ? "rep didn't" : "reps didn't"} reach full range and weren't counted.`, tone: 'adjust' } };
  return { overlay: null, feedback: { message: readout.framing.message, tone: 'ready' } };
}

/** Maps a getUserMedia / camera failure to a status. */
export function cameraErrorStatus(error: unknown): CameraStatus {
  const name = typeof error === 'object' && error && 'name' in error ? String((error as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { kind: 'denied', canAskAgain: true };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { kind: 'unavailable', reason: 'no_camera' };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'unavailable', reason: 'in_use' };
    default:
      return { kind: 'unavailable', reason: 'unsupported' };
  }
}

/** The joint the exercise's analyzer measures, for the live readout label. */
export function jointLabel(joint: 'knee' | 'elbow' | null | undefined): string {
  return joint === 'elbow' ? 'Elbow' : 'Knee';
}

/**
 * What the exercise needs the camera to see, for the tracking pill. Names the body parts the
 * framing check requires instead of claiming "full body" (a curl only needs the upper body).
 */
export function trackingLabel(exerciseId: string): string {
  switch (exerciseId) {
    case 'push_up':
      return 'Shoulder to ankle in view';
    case 'bicep_curl':
      return 'Arm, shoulder and hip in view';
    case 'squat':
    case 'bodyweight_squat':
    case 'goblet_squat':
    case 'lunge':
      return 'Shoulder, hip, knee and ankle in view';
    default:
      return 'Your body in view';
  }
}
