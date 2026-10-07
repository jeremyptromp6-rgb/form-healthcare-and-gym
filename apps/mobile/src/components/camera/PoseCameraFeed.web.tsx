import { FRAMING_THRESHOLDS, SKELETON_EDGES, type LiveFrame } from '@form/domain';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { createPoseProvider, type WebPoseProvider } from '@/lib/pose/mediapipe';
import { cameraErrorStatus } from '@/lib/pose/status';
import { colors } from '@/theme/tokens';
import type { PoseCameraFeedProps } from './feedTypes';

const READOUT_INTERVAL_MS = 200;
const BRIGHTNESS_INTERVAL_MS = 500;
/** If inference is slower than this, skip alternate frames to keep the UI responsive. */
const SLOW_INFERENCE_MS = 45;
/** A started stream that delivers no frame this long is reported as interrupted. */
const FIRST_FRAME_TIMEOUT_MS = 4000;
const WATCHDOG_MS = 500;

/**
 * Web camera + on-device pose. getUserMedia → <video> → MediaPipe (in-browser) → LivePoseSession
 * → skeleton drawn on a <canvas> over the video. Frames are never copied anywhere except a 32×24
 * brightness sample; nothing is recorded. The stream stops whenever `active` goes false
 * (pause, end, unmount); processing stops while the page is hidden and is reported as interrupted.
 */
export function PoseCameraFeed({ active, session, retryToken, onCamera, onPose, onReadout }: PoseCameraFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const providerRef = useRef<WebPoseProvider | null>(null);
  const everLive = useRef(false);
  const callbacks = useRef({ onCamera, onPose, onReadout });
  useEffect(() => {
    callbacks.current = { onCamera, onPose, onReadout };
  });

  // The model lives as long as the screen (reloading it on every pause would waste seconds).
  useEffect(
    () => () => {
      providerRef.current?.close();
      providerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const cb = callbacks.current;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    const provider = (providerRef.current ??= createPoseProvider());
    if (provider.backend) cb.onPose({ kind: 'ready', backend: provider.backend });
    else {
      cb.onPose({ kind: 'loading' });
      provider.load().then((r) => {
        if (cancelled) return;
        if (r.ok) callbacks.current.onPose({ kind: 'ready', backend: provider.backend ?? 'CPU' });
        else if (r.code === 'unconfigured') callbacks.current.onPose({ kind: 'unsupported', message: r.message });
        else callbacks.current.onPose({ kind: 'failed', message: r.message, retryable: r.retryable });
      });
    }

    // ---- frame loop -------------------------------------------------------------------
    const sampler = document.createElement('canvas');
    sampler.width = 32;
    sampler.height = 24;
    const sampleCtx = sampler.getContext('2d', { willReadFrequently: true });
    let lastVideoTime = -1;
    let lastReadout = 0;
    let lastBrightnessAt = -Infinity;
    let brightness: number | undefined;
    let latency = 0;
    let frames = 0;
    let fpsSince = performance.now();
    let fps = 0;
    let skip = false;
    let interrupted = false;
    let startedAt = Infinity;
    let ended = false;

    const setInterrupted = (value: boolean) => {
      if (interrupted === value) return;
      interrupted = value;
      if (value) {
        clearCanvas(canvas);
        callbacks.current.onReadout(null);
        callbacks.current.onCamera({ kind: 'interrupted' });
      } else callbacks.current.onCamera({ kind: 'live' });
    };

    const tick = async () => {
      if (cancelled) return;
      const now = performance.now();
      if (!document.hidden && provider.backend && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        skip = latency > SLOW_INFERENCE_MS ? !skip : false;
        if (!skip) {
          if (sampleCtx && now - lastBrightnessAt >= BRIGHTNESS_INTERVAL_MS) {
            sampleCtx.drawImage(video, 0, 0, sampler.width, sampler.height);
            brightness = meanLuma(sampleCtx.getImageData(0, 0, sampler.width, sampler.height).data);
            lastBrightnessAt = now;
          }
          const started = performance.now();
          const r = await provider.estimate(video, now);
          if (cancelled) return;
          if (r.ok) {
            const took = performance.now() - started;
            latency = latency === 0 ? took : latency * 0.8 + took * 0.2;
            const frame = session.push({ ...r.value, brightness });
            drawSkeleton(canvas, r.value.frame, frame);
            setInterrupted(false);
            frames++;
            if (now - fpsSince >= 1000) {
              fps = Math.round((frames * 1000) / (now - fpsSince));
              frames = 0;
              fpsSince = now;
            }
            if (now - lastReadout >= READOUT_INTERVAL_MS) {
              lastReadout = now;
              callbacks.current.onReadout({
                framing: frame.framing,
                trackable: frame.trackable,
                angleDeg: frame.angle ? Math.round(frame.angle.angleDeg) : null,
                people: frame.people.length,
                fps,
                latencyMs: Math.round(latency),
                rep: session.repState(),
                traceFull: session.traceFull,
              });
            }
          } else if (r.code !== 'invalid_input') {
            clearCanvas(canvas);
            callbacks.current.onPose({ kind: 'failed', message: r.message, retryable: r.retryable });
            return; // stop the loop; Retry restarts everything
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    // Watchdog on its own timer: the frame loop runs on animation frames, which stop entirely in
    // a hidden page — so the loop can't be the one to notice it has stopped. Hidden page, stalled
    // stream, or a stream that never delivered a frame → "interrupted", and stale framing/movement
    // state is dropped so nothing carries over the gap.
    const watchdog = setInterval(() => {
      if (cancelled || ended || interrupted || !provider.backend || startedAt === Infinity) return;
      const now = performance.now();
      const neverStarted = lastVideoTime < 0 && now - startedAt > FIRST_FRAME_TIMEOUT_MS;
      if (document.hidden || neverStarted || (lastVideoTime >= 0 && session.isStale(now))) {
        session.interrupt();
        setInterrupted(true);
      }
    }, WATCHDOG_MS);

    // ---- camera -----------------------------------------------------------------------
    const start = async () => {
      if (!window.isSecureContext) return cb.onCamera({ kind: 'unavailable', reason: 'insecure' });
      if (!navigator.mediaDevices?.getUserMedia) return cb.onCamera({ kind: 'unavailable', reason: 'unsupported' });
      if (!everLive.current) cb.onCamera({ kind: 'requesting' });
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          // 640×480 at ≤30 fps: plenty for pose, far cheaper than HD for battery and inference.
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
        });
      } catch (e) {
        if (!cancelled) callbacks.current.onCamera(cameraErrorStatus(e));
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (cancelled) return;
        ended = true;
        cancelAnimationFrame(raf);
        clearCanvas(canvas);
        callbacks.current.onReadout(null);
        callbacks.current.onCamera({ kind: 'unavailable', reason: 'ended' });
      });
      video.srcObject = stream;
      // Don't block on play() (it doesn't settle while the page is hidden): the loop only
      // processes real frames, and the watchdog reports a stream that never delivers any.
      video.play().catch(() => {});
      everLive.current = true;
      startedAt = performance.now();
      session.interrupt();
      callbacks.current.onCamera({ kind: 'live' });
      raf = requestAnimationFrame(tick);
    };
    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      clearCanvas(canvas);
      callbacks.current.onReadout(null);
    };
  }, [active, retryToken, session]);

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {/* Mirrored like a mirror; the canvas gets the same transform so the skeleton lines up. */}
      <video ref={videoRef} muted playsInline autoPlay aria-label="Live camera preview" style={MEDIA_STYLE} />
      <canvas ref={canvasRef} aria-hidden style={MEDIA_STYLE} />
    </View>
  );
}

const MEDIA_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transform: 'scaleX(-1)',
} as const;

function meanLuma(rgba: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
  return sum / (rgba.length / 4);
}

function clearCanvas(canvas: HTMLCanvasElement) {
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}

/** Draws only what the model reported as visible — never interpolated or guessed joints. */
function drawSkeleton(canvas: HTMLCanvasElement, frame: { width: number; height: number }, live: LiveFrame) {
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Subtle and functional: thin, slightly translucent lines — a coach's sketch, not a scanner.
  const line = Math.max(2, frame.width / 240);
  ctx.globalAlpha = 0.8;
  live.people.forEach((person, i) => {
    const color = i > 0 ? colors.danger : live.trackable ? colors.primary : colors.warning;
    const pts = new Map(person.keypoints.filter((k) => k.confidence >= FRAMING_THRESHOLDS.visibleConfidence).map((k) => [k.name, k]));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = line;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of SKELETON_EDGES) {
      const pa = pts.get(a);
      const pb = pts.get(b);
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x * frame.width, pa.y * frame.height);
      ctx.lineTo(pb.x * frame.width, pb.y * frame.height);
    }
    ctx.stroke();
    for (const k of pts.values()) {
      ctx.beginPath();
      ctx.arc(k.x * frame.width, k.y * frame.height, line * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
}
