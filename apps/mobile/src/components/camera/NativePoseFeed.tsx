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

/**
 * Phone camera + on-device pose, run natively (Android): CameraX, MediaPipe and the body outline all
 * live in one native view, and each frame's landmarks come back here into the same LivePoseSession
 * as the WebView feed's, through the same handler. A fatal native failure hands the session to the
 * WebView feed (`onFatal`). The camera stops whenever `active` goes false (the view is removed).
 */
export function NativePoseFeed(p: PoseCameraFeedProps & { onFatal: () => void }) {
  const { onFatal } = p;
  // The skeleton's state is read from the tracker on every render; a push only asks for one.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const pushSkeleton = useCallback(() => redraw(), []);
  const { running, handle, skel } = usePoseFeedCore(p, { pushSkeleton, engine: 'native' });

  const latest = useRef({ onPose: p.onPose, onReadout: p.onReadout, onDiag: p.onDiag, leadMs: p.leadMs, onFatal });
  useEffect(() => {
    latest.current = { onPose: p.onPose, onReadout: p.onReadout, onDiag: p.onDiag, leadMs: p.leadMs, onFatal };
  });

  const onCamera = useCallback((e: { nativeEvent: NativeCameraEvent }) => handle(toEngineMessage('camera', e.nativeEvent)), [handle]);
  const onPose = useCallback(
    (e: { nativeEvent: NativePoseEvent }) => {
      const ev = e.nativeEvent;
      if (ev.kind === 'failed' && ev.fatal) {
        // No point retrying natively: the WebView engine takes over for this session and starts from "loading".
        latest.current.onReadout(null);
        latest.current.onPose({ kind: 'loading' });
        latest.current.onFatal();
        return;
      }
      handle(toEngineMessage('pose', ev));
    },
    [handle],
  );
  const onFrame = useCallback((e: { nativeEvent: NativeFrameEvent }) => handle(toEngineMessage('frame', e.nativeEvent)), [handle]);
  const onDiag = useCallback((e: { nativeEvent: NativeDiagEvent }) => latest.current.onDiag?.(toPoseDiag(e.nativeEvent, latest.current.leadMs)), []);

  if (!running || !NativePoseView) return null;
  const state = skel.current();
  // testID is a plain React Native view prop that the module's own prop types leave out.
  const View = NativePoseView as ComponentType<FormPoseCameraViewProps & { testID?: string }>;
  return (
    <View
      key={p.retryToken}
      testID="camera-view-native"
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
