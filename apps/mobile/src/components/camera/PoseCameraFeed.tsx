import { fromMediaPipePose, type PoseDetection } from '@form/domain';
import { useCameraPermissions } from 'expo-camera';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { config } from '@/lib/config';
import { cameraErrorStatus } from '@/lib/pose/status';
import { colors } from '@/theme/tokens';
import type { PoseCameraFeedProps } from './feedTypes';
import { poseEngineHtml } from './poseEngineHtml';

const READOUT_INTERVAL_MS = 200;
const WATCHDOG_MS = 500;
/** No frame this long while the camera is live and the model is ready → interrupted. */
const STALL_MS = 2000;
/** A ready model that never gets a first frame this long after the camera went live → interrupted. */
const FIRST_FRAME_TIMEOUT_MS = 6000;

type EngineMessage =
  | { t: 'camera'; kind: 'requesting' | 'live' | 'ended' | 'error'; name?: string }
  | { t: 'pose'; kind: 'loading' | 'ready' | 'failed'; backend?: 'GPU' | 'CPU'; offline?: boolean }
  | { t: 'frame'; ts: number; w: number; h: number; ms: number; b?: number; people: [number, number, number][][] };

/**
 * Phone camera + on-device pose. The camera and MediaPipe run inside a WebView "engine" page
 * (see poseEngineHtml) because the pose model needs a web runtime; each frame's landmarks come
 * back here into the same LivePoseSession the web app uses, so rep counting, framing checks and
 * form scoring are identical on every platform. Nothing is recorded; the camera stops whenever
 * `active` goes false (the WebView is removed).
 */
export function PoseCameraFeed({ active, session, retryToken, onCamera, onPose, onReadout }: PoseCameraFeedProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const callbacks = useRef({ onCamera, onPose, onReadout });
  useEffect(() => {
    callbacks.current = { onCamera, onPose, onReadout };
  });
  const web = useRef<WebView>(null);
  const live = useRef({ camera: false, ready: false, cameraAt: 0, lastFrameAt: 0, interrupted: false, lastReadout: 0, frames: 0, fpsSince: 0, fps: 0, color: '' });

  const html = useMemo(() => poseEngineHtml({ modelUrl: config.poseModelUrl, colors: { good: colors.primary, warn: colors.warning, other: colors.danger } }), []);

  // ---- permission (expo-camera owns the OS prompt; the engine's getUserMedia then succeeds) ----
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
    Object.assign(s, { camera: false, ready: false, cameraAt: 0, lastFrameAt: 0, interrupted: false, frames: 0, fpsSince: Date.now(), fps: 0, color: '' });
    session.interrupt();
    const timer = setInterval(() => {
      if (!s.camera || !s.ready || s.interrupted) return;
      const now = Date.now();
      const neverStarted = s.lastFrameAt === 0 && now - s.cameraAt > FIRST_FRAME_TIMEOUT_MS;
      const stalled = s.lastFrameAt > 0 && now - s.lastFrameAt > STALL_MS;
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
  }, [running, retryToken, session]);

  const onMessage = (event: WebViewMessageEvent) => {
    let m: EngineMessage;
    try {
      m = JSON.parse(event.nativeEvent.data) as EngineMessage;
    } catch {
      return;
    }
    const s = live.current;
    const cb = callbacks.current;
    if (m.t === 'camera') {
      if (m.kind === 'live') {
        s.camera = true;
        s.cameraAt = Date.now();
        cb.onCamera({ kind: 'live' });
      } else if (m.kind === 'ended') {
        s.camera = false;
        cb.onReadout(null);
        cb.onCamera({ kind: 'unavailable', reason: 'ended' });
      } else if (m.kind === 'error') cb.onCamera(cameraErrorStatus({ name: m.name ?? '' }));
      return;
    }
    if (m.t === 'pose') {
      if (m.kind === 'loading') cb.onPose({ kind: 'loading' });
      else if (m.kind === 'ready') {
        s.ready = true;
        cb.onPose({ kind: 'ready', backend: m.backend ?? 'CPU' });
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
    // Skeleton colour follows tracking quality; the engine draws it at camera frame rate.
    const color = frame.trackable ? colors.primary : colors.warning;
    if (color !== s.color) {
      s.color = color;
      web.current?.injectJavaScript(`window.__skeletonColor=${JSON.stringify(color)};true;`);
    }
    s.frames++;
    if (now - s.fpsSince >= 1000) {
      s.fps = Math.round((s.frames * 1000) / (now - s.fpsSince));
      s.frames = 0;
      s.fpsSince = now;
    }
    if (now - s.lastReadout >= READOUT_INTERVAL_MS) {
      s.lastReadout = now;
      cb.onReadout({
        framing: frame.framing,
        trackable: frame.trackable,
        angleDeg: frame.angle ? Math.round(frame.angle.angleDeg) : null,
        people: frame.people.length,
        fps: s.fps,
        latencyMs: m.ms,
        rep: session.repState(),
        traceFull: session.traceFull,
      });
    }
  };

  if (!running) return null;
  return (
    <WebView
      key={retryToken}
      ref={web}
      testID="camera-view"
      style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}
      source={{ html, baseUrl: 'https://form.app/' }}
      originWhitelist={['*']}
      javaScriptEnabled
      onMessage={onMessage}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      mediaCapturePermissionGrantType="grant"
      onError={() => callbacks.current.onCamera({ kind: 'unavailable', reason: 'unsupported' })}
      accessibilityLabel="Live camera preview"
    />
  );
}
