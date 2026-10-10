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
  | { kind: 'unavailable'; reason: 'no_camera' | 'in_use' | 'insecure' | 'unsupported' | 'ended' | 'start_timeout' }
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
}

export type CameraAction = 'start' | 'retry' | 'settings';

export interface CameraScreenModel {
  /** Blocks the feed area (nothing useful to show behind it). */
  overlay: { kind: StateKind; title: string; message: string; action: CameraAction | null; actionLabel: string | null } | null;
  /** One line of guidance under the feed; rep cues carry a headline ("CORRECT FORM"). */
  feedback: { message: string; tone: 'ready' | 'adjust' | 'info'; headline?: string } | null;
}

const MANUAL = 'You can still log your sets manually.';

const UNAVAILABLE: Record<Extract<CameraStatus, { kind: 'unavailable' }>['reason'], { title: string; message: string; retry: boolean }> = {
  no_camera: { title: 'No camera found', message: `Connect a camera or use a device with one. ${MANUAL}`, retry: true },
  in_use: { title: 'Camera is busy', message: `Another app is using the camera. Close it and try again. ${MANUAL}`, retry: true },
  insecure: { title: 'Camera needs a secure connection', message: `Open FORM over https to use the camera. ${MANUAL}`, retry: false },
  unsupported: { title: "Camera isn't supported here", message: `This browser or device can't provide a camera feed. ${MANUAL}`, retry: false },
  ended: { title: 'Camera disconnected', message: 'The camera stopped. Reconnect it and try again.', retry: true },
  start_timeout: { title: "The camera didn't start", message: `Try again. If it keeps happening, close other apps that use the camera and reopen FORM. ${MANUAL}`, retry: true },
};

/** Start-up in plain words, with the download's progress when there is one. */
export function loadingMessage(pose: PoseStatus): string {
  if (pose.kind !== 'loading' || !pose.stage) return 'Getting your camera coach ready…';
  if (pose.stage === 'starting') return 'Almost ready — starting your camera coach…';
  const pct = typeof pose.pct === 'number' ? ` — ${Math.max(0, Math.min(99, Math.round(pose.pct)))}%` : '';
  return `Downloading your camera coach${pct}. This happens once; next time it starts quickly.`;
}

export function cameraScreenModel(camera: CameraStatus, pose: PoseStatus, readout: LiveReadout | null, paused: boolean): CameraScreenModel {
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
  if (paused) return { overlay: null, feedback: { message: 'Paused — resume when you’re ready.', tone: 'info' } };
  if (camera.kind === 'interrupted') return { overlay: null, feedback: { message: 'Waiting for the camera to come back…', tone: 'adjust' } };
  if (pose.kind !== 'ready') return { overlay: null, feedback: { message: loadingMessage(pose), tone: 'info' } };
  if (!readout) return { overlay: null, feedback: { message: 'Looking for you…', tone: 'info' } };
  // Priority: can't see you properly > the latest rep cue > where you are in the movement.
  if (!readout.framing.trackable) return { overlay: null, feedback: { message: readout.framing.message, tone: 'adjust' } };
  if (readout.traceFull) return { overlay: null, feedback: { message: 'This set is as long as one set can be — log it to keep counting.', tone: 'adjust' } };
  const cue = readout.rep?.feedback;
  if (cue) return { overlay: null, feedback: { headline: cue.headline, message: cue.message, tone: cue.tone === 'good' ? 'ready' : 'adjust' } };
  if (readout.rep?.phase === 'unknown') return { overlay: null, feedback: { message: readout.rep.phaseLabel, tone: 'info' } };
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
