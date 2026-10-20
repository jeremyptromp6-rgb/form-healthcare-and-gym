import { useCallback, useEffect, useReducer, useRef, type ComponentType } from 'react';
import { StyleSheet } from 'react-native';
import type { FormPoseCameraViewProps, NativeCameraEvent, NativeDiagEvent, NativeFrameEvent, NativePoseEvent } from '../../../modules/form-pose-camera';
import { config } from '@/lib/config';
import { NativePoseView, toEngineMessage, toPoseDiag } from '@/lib/pose/nativePose';
import { MODEL_BUDGET_MS, POSE_CONFIDENCE } from '@/lib/pose/poseModels';
import type { PoseCameraFeedProps } from './feedTypes';
import { usePoseFeedCore } from './poseFeedCore';

// Session-key props: the native camera restarts when one changes, so they are constants.
const CONFIDENCE: [number, number, number] = [POSE_CONFIDENCE.detection, POSE_CONFIDENCE.presence, POSE_CONFIDENCE.tracking];
/** No camera frame this long after the native feed starts (permission granted) → hand over to the WebView engine. */
export const NATIVE_LIVE_FALLBACK_MS = 8000;

/**
 * Phone camera + on-device pose, run natively (Android): CameraX, MediaPipe and the body outline all
 * live in one native view, and each frame's landmarks come back here into the same LivePoseSession
 * as the WebView feed's, through the same handler. A fatal native failure hands the session to the
 * WebView feed (`onFatal`). The camera stops whenever `active` goes false (the view is removed).
 */
export function NativePoseFeed(p: PoseCameraFeedProps & { onFatal: (reason: string) => void }) {
  const { onFatal } = p;
  // The skeleton's state is read from the tracker on every render; a push only asks for one.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const pushSkeleton = useCallback(() => redraw(), []);
  const { running, handle, skel } = usePoseFeedCore(p, { pushSkeleton, engine: 'native' });

  const latest = useRef({ onPose: p.onPose, onReadout: p.onReadout, onDiag: p.onDiag, leadMs: p.leadMs, onFatal });
  useEffect(() => {
    latest.current = { onPose: p.onPose, onReadout: p.onReadout, onDiag: p.onDiag, leadMs: p.leadMs, onFatal };
  });

  const handOver = useCallback((reason: string) => {
    // No point retrying natively (and the reason is remembered for this build): the WebView engine takes
    // over and starts from "loading", so the screen stays on its calm loading copy, never an error.
    latest.current.onReadout(null);
    latest.current.onPose({ kind: 'loading' });
    latest.current.onFatal(reason);
  }, []);

  // A native camera that never delivers a frame (a device quirk) must not end in an error screen:
  // the WebView engine, which worked on every phone before, takes over instead.
  const live = useRef(false);
  // The same for a model that reported ready but never delivers a frame result.
  const framed = useRef(false);
  // The native side already said why it can't go on (a busy or blocked camera, a model that wouldn't
  // download): silence is no longer the problem, and the WebView engine would hit the same wall.
  const answered = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!running) return;
    live.current = false;
    framed.current = false;
    answered.current = false;
    readyTimer.current = null;
    const t = setTimeout(() => {
      if (!live.current && !answered.current) handOver('no_live');
    }, NATIVE_LIVE_FALLBACK_MS);
    return () => {
      clearTimeout(t);
      if (readyTimer.current) clearTimeout(readyTimer.current);
      readyTimer.current = null;
    };
  }, [running, p.retryToken, handOver]);

  const onCamera = useCallback(
    (e: { nativeEvent: NativeCameraEvent }) => {
      const ev = e.nativeEvent;
      if (ev.kind === 'live') live.current = true;
      if (ev.kind === 'error') {
        // Every CameraX problem except a permission refusal (the native side maps all unknown errors to
        // NotReadableError) hands over: the WebView engine gets its turn, and if the camera really is busy
        // it says so itself. Only a refused permission is a real user action, so it is shown as it is.
        if (ev.name !== 'NotAllowedError') {
          handOver(`camera:${ev.name ?? 'unknown'}`);
          return;
        }
        answered.current = true;
      }
      handle(toEngineMessage('camera', ev));
    },
    [handle, handOver],
  );
  const onPose = useCallback(
    (e: { nativeEvent: NativePoseEvent }) => {
      const ev = e.nativeEvent;
      if (ev.kind === 'failed') {
        // A fatal native failure (the engine can't start on this phone) hands over to the WebView engine,
        // which works on every phone: the user never sees "couldn't start" from the native engine.
        if (ev.fatal) {
          handOver(`fatal:${ev.message ?? 'unknown'}`);
          return;
        }
        // Truly offline on the first run: say so, with Try again (the WebView engine needs the internet too),
        // and don't remember this build as a native failure. Any other download problem hands over quietly.
        if (ev.offline) {
          answered.current = true;
          handle(toEngineMessage('pose', ev));
          return;
        }
        handOver(`failed:${ev.message ?? 'unknown'}`);
        return;
      }
      if (ev.kind === 'ready' && !framed.current && !readyTimer.current) {
        readyTimer.current = setTimeout(() => {
          if (!framed.current) handOver('no_frame_after_ready');
        }, NATIVE_LIVE_FALLBACK_MS);
      }
      handle(toEngineMessage('pose', ev));
    },
    [handle, handOver],
  );
  const onFrame = useCallback(
    (e: { nativeEvent: NativeFrameEvent }) => {
      framed.current = true;
      handle(toEngineMessage('frame', e.nativeEvent));
    },
    [handle],
  );
  const onDiag = useCallback((e: { nativeEvent: NativeDiagEvent }) => latest.current.onDiag?.(toPoseDiag(e.nativeEvent, latest.current.leadMs)), []);

  if (!running || !NativePoseView) return null;
  const state = skel.current();
  // testID and accessibilityLabel are plain React Native view props that the module's own prop types leave out.
  const View = NativePoseView as ComponentType<FormPoseCameraViewProps & { testID?: string; accessibilityLabel?: string }>;
  return (
    <View
      key={p.retryToken}
      testID="camera-view-native"
      accessibilityLabel="Live camera preview"
      style={styles.view}
      active
      facing="front"
      modelUrl={config.poseModelUrl}
      liteModelUrl={config.poseLiteModelUrl}
      confidence={CONFIDENCE}
      budgetMs={MODEL_BUDGET_MS}
      overlayMode="outline"
      tone={state.tone}
      chain={state.chain}
      palette={state.palette}
      reduceMotion={state.reduceMotion}
      leadMs={p.leadMs}
      diagnostics={p.onDiag !== undefined}
      onCamera={onCamera}
      onPose={onPose}
      onFrame={onFrame}
      onDiag={p.onDiag ? onDiag : undefined}
    />
  );
}

const styles = StyleSheet.create({ view: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' } });
