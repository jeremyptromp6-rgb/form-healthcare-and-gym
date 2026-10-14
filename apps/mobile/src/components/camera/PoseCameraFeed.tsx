import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { config } from '@/lib/config';
import { nativeCameraFailedOnThisBuild, recordNativeCameraFailure } from '@/lib/pose/nativeFallback';
import { nativePoseAvailable } from '@/lib/pose/nativePose';
import { colors } from '@/theme/tokens';
import type { PoseCameraFeedProps } from './feedTypes';
import { NativePoseFeed } from './NativePoseFeed';
import { poseEngineHtml } from './poseEngineHtml';
import { usePoseFeedCore, type EngineMessage } from './poseFeedCore';
import { skeletonInjection } from './skeletonState';
import type { SkeletonState } from './skeletonTypes';

export { CAMERA_START_TIMEOUT_MS, MODEL_LOAD_TIMEOUT_MS } from './poseFeedCore';

/**
 * Phone camera + on-device pose. Android builds that include the native pose camera use it
 * (NativePoseFeed) and fall back to the WebView engine (WebViewPoseFeed) for the rest of the session
 * if it fails fatally; everything else runs the WebView engine. Both feed the same LivePoseSession
 * through the same handler (poseFeedCore), so rep counting, framing checks and form scoring are
 * identical on every platform. Nothing is recorded; the camera stops whenever `active` goes false.
 */
export function PoseCameraFeed(p: PoseCameraFeedProps) {
  // A native camera that already failed on this build is not tried again: the WebView engine starts directly.
  // The flag is read synchronously from local storage once, before the first render commits.
  const [nativeFailed, setNativeFailed] = useState(nativeCameraFailedOnThisBuild);
  const native = !nativeFailed && nativePoseAvailable();
  const { onEngine } = p;
  useEffect(() => {
    onEngine?.(native ? 'native' : 'webview');
  }, [native, onEngine]);
  const onFatal = useCallback((reason: string) => {
    recordNativeCameraFailure(reason);
    setNativeFailed(true);
  }, []);
  return native ? <NativePoseFeed {...p} onFatal={onFatal} /> : <WebViewPoseFeed {...p} />;
}

/**
 * The camera and MediaPipe run inside a WebView "engine" page (see poseEngineHtml) because the pose
 * model needs a web runtime; each frame's landmarks come back here. The WebView is removed whenever
 * `active` goes false, which stops the camera.
 */
function WebViewPoseFeed(p: PoseCameraFeedProps) {
  const web = useRef<WebView>(null);
  const pushSkeleton = useCallback((s: SkeletonState) => {
    web.current?.injectJavaScript(skeletonInjection(s));
  }, []);
  const { running, handle } = usePoseFeedCore(p, { pushSkeleton, engine: 'webview' });
  const { retryToken, onCamera } = p;

  const html = useMemo(
    () =>
      poseEngineHtml({
        modelUrl: config.poseModelUrl,
        liteModelUrl: config.poseLiteModelUrl,
        colors: { good: colors.primary, warn: colors.warning, other: colors.danger },
      }),
    [],
  );

  // The engine view gets the same (stable) props on every render of this feed, so it never
  // re-renders: react-native-webview reloads an inline-HTML page whenever its source prop is set
  // again, and a reload restarts the camera — which re-renders the screen, which reloaded it again.
  const handler = useRef(handle);
  useEffect(() => {
    handler.current = handle;
  });
  const stableOnMessage = useCallback((event: WebViewMessageEvent) => {
    let m: EngineMessage;
    try {
      m = JSON.parse(event.nativeEvent.data) as EngineMessage;
    } catch {
      return;
    }
    handler.current(m);
  }, []);
  const callbacks = useRef({ onCamera });
  useEffect(() => {
    callbacks.current = { onCamera };
  });
  const onEngineError = useCallback(() => callbacks.current.onCamera({ kind: 'unavailable', reason: 'unsupported' }), []);

  if (!running) return null;
  return <EngineView key={retryToken} html={html} webRef={web} onMessage={stableOnMessage} onError={onEngineError} />;
}

const ENGINE_BASE_URL = 'https://form.app/';

/** The WebView hosting the pose engine. Memoized: it renders once per mount (see above). */
const EngineView = memo(function EngineView({
  html,
  webRef,
  onMessage,
  onError,
}: {
  html: string;
  webRef: RefObject<WebView | null>;
  onMessage: (e: WebViewMessageEvent) => void;
  onError: () => void;
}) {
  const source = useMemo(() => ({ html, baseUrl: ENGINE_BASE_URL }), [html]);
  return (
    <WebView
      ref={webRef}
      testID="camera-view"
      style={styles.engine}
      source={source}
      originWhitelist={ORIGINS}
      javaScriptEnabled
      onMessage={onMessage}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      mediaCapturePermissionGrantType="grant"
      onError={onError}
      accessibilityLabel="Live camera preview"
    />
  );
});

const ORIGINS = ['*'];
const styles = StyleSheet.create({ engine: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' } });
