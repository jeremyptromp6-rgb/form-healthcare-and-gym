import { fromMediaPipePose, type LiveFeedback, type PoseDetection } from '@form/domain';
import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from '@/lib/a11y';
import { StanceTracker } from '@/lib/pose/stance';
import { cameraErrorStatus } from '@/lib/pose/status';
import type { PoseCameraFeedProps } from './feedTypes';
import { SkeletonStateTracker } from './skeletonState';
import type { SkeletonState } from './skeletonTypes';

const READOUT_INTERVAL_MS = 200;
const WATCHDOG_MS = 500;
/** No frame this long while the camera is live and the model is ready → interrupted. */
const STALL_MS = 2000;
/** While the engine creates the lite model (no results come; the GPU create alone may take up to its 10 s timeout), the stall limit is this instead. */
const MODEL_SWITCH_STALL_MS = 11000;
/** A ready model that never gets a first frame this long after the camera went live → interrupted. */
const FIRST_FRAME_TIMEOUT_MS = 6000;
/** Permission granted but the camera never opened this long → "the camera didn't start". */
export const CAMERA_START_TIMEOUT_MS = 15_000;
/** Camera live but the pose model making no progress for this long (stalled download or start) → retry. */
export const MODEL_LOAD_TIMEOUT_MS = 60_000;

/**
 * What an engine reports, in one shape: the WebView engine page posts these as JSON and the native
 * view's events are adapted to them (see lib/pose/nativePose), so everything after this point (the
 * frame contract into the shared LivePoseSession included) is the same for both engines.
 */
export type EngineMessage =
  | { t: 'camera'; kind: 'requesting' | 'live' | 'ended' | 'error'; name?: string }
  | { t: 'pose'; kind: 'loading' | 'ready' | 'failed' | 'model'; backend?: 'GPU' | 'CPU'; offline?: boolean; stage?: 'runtime' | 'model' | 'starting'; pct?: number; variant?: 'full' | 'lite' | 'switching'; fatal?: boolean }
  | { t: 'frame'; ts: number; w: number; h: number; ms: number; b?: number; people: [number, number, number][][] };

export interface PoseFeedIo {
  /** Hands the engine the skeleton's state (the WebView by script, the native view by props). */
  pushSkeleton: (s: SkeletonState) => void;
  /** Which engine this is: the WebView reports a minimal PoseDiag from the numbers it already has. */
  engine: 'native' | 'webview';
}

/**
 * Everything the two phone feeds share: the camera permission, the start-up and stall watchdog, and
 * the engine message handler that feeds frames into the LivePoseSession and reports readouts. The
 * engines differ only in how they run the camera and draw the skeleton.
 */
export function usePoseFeedCore(p: PoseCameraFeedProps, io: PoseFeedIo) {
  const { active, session, retryToken, onCamera, onPose, onReadout, onDiag } = p;
  const [permission, requestPermission] = useCameraPermissions();
  const callbacks = useRef({ onCamera, onPose, onReadout, onDiag });
  useEffect(() => {
    callbacks.current = { onCamera, onPose, onReadout, onDiag };
  });
  const ioRef = useRef(io);
  useEffect(() => {
    ioRef.current = io;
  });
  const live = useRef({ camera: false, ready: false, cameraAt: 0, progressAt: 0, lastFrameAt: 0, interrupted: false, lastReadout: 0, frames: 0, fpsSince: 0, fps: 0, stallMs: STALL_MS, cue: null as LiveFeedback | null, backend: null as 'GPU' | 'CPU' | null });

  // What the skeleton shows (tone, tracked side, emphasised joints) is judged here, once per camera
  // session, and handed to the engine through `io.pushSkeleton`.
  const skel = useMemo(() => new SkeletonStateTracker(session.exerciseId, false), [session]);
  const stance = useMemo(() => new StanceTracker(session.exerciseId), [session]);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    skel.setReduceMotion(reduceMotion);
    ioRef.current.pushSkeleton(skel.current());
  }, [skel, reduceMotion]);

  // ---- permission (expo-camera owns the OS prompt; the engine's camera access then succeeds) ----
  const known = permission !== null;
  const granted = permission?.granted ?? false;
  const canAskAgain = permission?.canAskAgain ?? true;
  useEffect(() => {
    if (!active || !known || granted) return;
    if (!canAskAgain) {
      callbacks.current.onCamera({ kind: 'denied', canAskAgain: false });
      return;
    }
    callbacks.current.onCamera({ kind: 'requesting' });
    requestPermission().then((r) => {
      if (!r.granted) callbacks.current.onCamera({ kind: 'denied', canAskAgain: r.canAskAgain });
    });
  }, [active, known, granted, canAskAgain, retryToken, requestPermission]);

  const running = active && granted;

  // ---- watchdog: a stalled or never-started stream is reported, and stale state is dropped ----
  useEffect(() => {
    if (!running) return;
    const s = live.current;
    Object.assign(s, { camera: false, ready: false, cameraAt: 0, progressAt: 0, lastFrameAt: 0, interrupted: false, frames: 0, fpsSince: Date.now(), fps: 0, stallMs: STALL_MS, cue: null, backend: null });
    skel.reset();
    stance.reset();
    session.interrupt();
    const startedAt = Date.now();
    let gaveUp = false;
    const timer = setInterval(() => {
      const now = Date.now();
      // Start-up never spins forever: a camera that doesn't open, or a model that doesn't load, ends
      // in a clear message with "Try again".
      if (!gaveUp && !s.camera && now - startedAt > CAMERA_START_TIMEOUT_MS) {
        gaveUp = true;
        callbacks.current.onCamera({ kind: 'unavailable', reason: 'start_timeout' });
        return;
      }
      // A slow download that's still moving is never cut off; only one that has stopped making progress.
      if (!gaveUp && s.camera && !s.ready && now - Math.max(s.cameraAt, s.progressAt) > MODEL_LOAD_TIMEOUT_MS) {
        gaveUp = true;
        callbacks.current.onPose({ kind: 'failed', message: 'Camera coaching is taking too long to load. Check your connection and try again.', retryable: true });
        return;
      }
      if (!s.camera || !s.ready || s.interrupted) return;
      const neverStarted = s.lastFrameAt === 0 && now - s.cameraAt > FIRST_FRAME_TIMEOUT_MS;
      const stalled = s.lastFrameAt > 0 && now - s.lastFrameAt > s.stallMs;
      if (neverStarted || stalled) {
        s.interrupted = true;
        session.interrupt();
        callbacks.current.onReadout(null);
        callbacks.current.onCamera({ kind: 'interrupted' });
      }
    }, WATCHDOG_MS);
    return () => {
      clearInterval(timer);
      callbacks.current.onReadout(null);
    };
  }, [running, retryToken, session, skel, stance]);

  // Stable for the session, so a feed can hand it to its engine view without that view re-rendering.
  const handle = useCallback(
    (m: EngineMessage) => {
      const s = live.current;
      const cb = callbacks.current;
      const push = ioRef.current.pushSkeleton;
      if (m.t === 'camera') {
        if (m.kind === 'live') {
          s.camera = true;
          s.cameraAt = Date.now();
          cb.onCamera({ kind: 'live' });
          push(skel.current());
        } else if (m.kind === 'ended') {
          s.camera = false;
          cb.onReadout(null);
          cb.onCamera({ kind: 'unavailable', reason: 'ended' });
        } else if (m.kind === 'error') cb.onCamera(cameraErrorStatus({ name: m.name ?? '' }));
        return;
      }
      if (m.t === 'pose') {
        if (m.kind === 'loading') {
          s.progressAt = Date.now();
          cb.onPose(m.stage ? { kind: 'loading', stage: m.stage, pct: m.pct } : { kind: 'loading' });
        } else if (m.kind === 'ready') {
          s.ready = true;
          s.backend = m.backend ?? 'CPU';
          cb.onPose({ kind: 'ready', backend: s.backend });
          push(skel.current());
        } else if (m.kind === 'model') {
          // Nothing in the app depends on which model runs. While the lite one is being created the engine
          // may go quiet for a few seconds, so the stall limit is relaxed until the next frame or model message.
          s.stallMs = m.variant === 'switching' ? MODEL_SWITCH_STALL_MS : STALL_MS;
          if (__DEV__) console.log(`[pose] model: ${m.variant ?? 'unknown'}`);
        } else
          cb.onPose(
            m.offline
              ? { kind: 'failed', message: 'Camera coaching needs an internet connection the first time it loads.', retryable: true }
              : { kind: 'failed', message: "Camera coaching couldn't load.", retryable: true },
          );
        return;
      }
      // A frame: the same detection shape the web provider produces, into the shared session.
      const now = Date.now();
      s.lastFrameAt = now;
      s.stallMs = STALL_MS;
      if (s.interrupted) {
        s.interrupted = false;
        cb.onCamera({ kind: 'live' });
      }
      const detection: PoseDetection = {
        timestampMs: m.ts,
        frame: { width: m.w, height: m.h },
        people: m.people.map((p) => ({ keypoints: fromMediaPipePose(p.map(([x, y, visibility]) => ({ x, y, visibility }))) })),
      };
      const frame = session.push({ ...detection, brightness: m.b });
      stance.update(m.people[0], m.w, m.h);
      // The skeleton's tone follows the coach's cue and tracking quality; the engine draws it at camera
      // frame rate and only hears from us when that state actually changes.
      const next = skel.update(frame, s.cue);
      if (next) push(next);
      s.frames++;
      if (now - s.fpsSince >= 1000) {
        s.fps = Math.round((s.frames * 1000) / (now - s.fpsSince));
        s.frames = 0;
        s.fpsSince = now;
        // The native view reports its own numbers; the WebView engine only has these.
        if (ioRef.current.engine === 'webview') {
          cb.onDiag?.({ fps: s.fps, inferMs: m.ms, ageP50: null, ageP95: null, backend: s.backend, variant: null, rung: 'webview', engine: 'webview' });
        }
      }
      if (now - s.lastReadout >= READOUT_INTERVAL_MS) {
        s.lastReadout = now;
        const rep = session.repState();
        s.cue = rep?.feedback ?? null;
        cb.onReadout({
          framing: frame.framing,
          trackable: frame.trackable,
          angleDeg: frame.angle ? Math.round(frame.angle.angleDeg) : null,
          people: frame.people.length,
          fps: s.fps,
          latencyMs: m.ms,
          rep,
          traceFull: session.traceFull,
          stance: stance.current(),
          frameAspect: m.w > 0 && m.h > 0 ? m.w / m.h : undefined,
        });
      }
    },
    [session, skel, stance],
  );

  return { running, handle, skel };
}
