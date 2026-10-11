import type { LiveFeedback } from '@form/domain';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { createPoseProvider, type WebPoseProvider } from '@/lib/pose/mediapipe';
import { cameraErrorStatus } from '@/lib/pose/status';
import type { PoseCameraFeedProps } from './feedTypes';
import { createSkeletonPage, landmarksFromPeople } from './skeletonPage';
import { SkeletonStateTracker } from './skeletonState';
import type { SkeletonEnv, SkeletonPage } from './skeletonTypes';

const READOUT_INTERVAL_MS = 200;
const BRIGHTNESS_INTERVAL_MS = 500;
/** If inference is slower than this, skip alternate frames to keep the UI responsive. */
const SLOW_INFERENCE_MS = 45;
/** A started stream that delivers no frame this long is reported as interrupted. */
const FIRST_FRAME_TIMEOUT_MS = 4000;
const WATCHDOG_MS = 500;

/**
 * Web camera + on-device pose. getUserMedia → <video> → MediaPipe (in-browser) → LivePoseSession
 * → skeleton drawn on a <canvas> over the video by the same skeleton page the phone uses. The page
 * runs its own animation-frame loop, decoupled from inference, so the skeleton moves smoothly
 * between results. Frames are never copied anywhere except a 32×24 brightness sample; nothing is
 * recorded. The stream stops whenever `active` goes false (pause, end, unmount); processing stops
 * while the page is hidden and is reported as interrupted.
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

  // What the skeleton shows (tone, tracked side, emphasised joints) is judged here, as on the phone;
  // the page only draws. On the web the tracker drives the page directly, with no injection.
  const skel = useMemo(() => new SkeletonStateTracker(session.exerciseId, false), [session]);
  const pageRef = useRef<SkeletonPage | null>(null);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    skel.setReduceMotion(reduceMotion);
    pageRef.current?.setState(skel.current());
  }, [skel, reduceMotion]);

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

    // ---- skeleton drawing: its own animation-frame loop, independent of inference ----------------
    // Built defensively: if the page can't be created (say, a policy that forbids new Function) no
    // skeleton is drawn, but tracking, rep counting and feedback carry on.
    skel.reset();
    let page: SkeletonPage | null = null;
    try {
      page = createSkeletonPage(skeletonEnv(canvas, video));
      page.setState(skel.current());
    } catch {
      page = null;
    }
    pageRef.current = page;
    // A failing call turns the skeleton off; it never breaks the camera loop.
    const withPage = (fn: (p: SkeletonPage) => void) => {
      if (!page) return;
      try {
        fn(page);
      } catch {
        page = null;
        pageRef.current = null;
      }
    };
    const showSkeleton = () =>
      withPage((p) => {
        p.setState(skel.current());
        p.start();
      });
    const hideSkeleton = () => withPage((p) => p.stop());

    const provider = (providerRef.current ??= createPoseProvider());
    if (provider.backend) {
      withPage((p) => p.setBackend(provider.backend ?? 'CPU'));
      cb.onPose({ kind: 'ready', backend: provider.backend });
    } else {
      cb.onPose({ kind: 'loading' });
      provider.load().then((r) => {
        if (cancelled) return;
        if (r.ok) {
          withPage((p) => p.setBackend(provider.backend ?? 'CPU'));
          callbacks.current.onPose({ kind: 'ready', backend: provider.backend ?? 'CPU' });
        } else if (r.code === 'unconfigured') callbacks.current.onPose({ kind: 'unsupported', message: r.message });
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
    // The coach's current cue, refreshed at the readout rate; the skeleton's tone follows it.
    let cue: LiveFeedback | null = null;

    const setInterrupted = (value: boolean) => {
      if (interrupted === value) return;
      interrupted = value;
      if (value) {
        hideSkeleton();
        callbacks.current.onReadout(null);
        callbacks.current.onCamera({ kind: 'interrupted' });
      } else {
        showSkeleton();
        callbacks.current.onCamera({ kind: 'live' });
      }
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
            // The raw people went to the session unchanged; the page gets its own 33-landmark copy,
            // stamped with when the camera frame was taken (this tick) and when its result arrived.
            withPage((p) => p.push(landmarksFromPeople(r.value.people), now, performance.now(), r.value.frame.width, r.value.frame.height));
            const next = skel.update(frame, cue);
            if (next) withPage((p) => p.setState(next));
            setInterrupted(false);
            frames++;
            if (now - fpsSince >= 1000) {
              fps = Math.round((frames * 1000) / (now - fpsSince));
              frames = 0;
              fpsSince = now;
            }
            if (now - lastReadout >= READOUT_INTERVAL_MS) {
              lastReadout = now;
              const rep = session.repState();
              cue = rep?.feedback ?? null;
              callbacks.current.onReadout({
                framing: frame.framing,
                trackable: frame.trackable,
                angleDeg: frame.angle ? Math.round(frame.angle.angleDeg) : null,
                people: frame.people.length,
                fps,
                latencyMs: Math.round(latency),
                rep,
                traceFull: session.traceFull,
              });
            }
          } else if (r.code !== 'invalid_input') {
            hideSkeleton();
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
        hideSkeleton();
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
      showSkeleton();
      raf = requestAnimationFrame(tick);
    };
    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      hideSkeleton();
      if (pageRef.current === page) pageRef.current = null;
      callbacks.current.onReadout(null);
    };
  }, [active, retryToken, session, skel]);

  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      {/* Only the video is mirrored (like a mirror); the skeleton page maps and mirrors the points itself. */}
      <video ref={videoRef} muted playsInline autoPlay aria-label="Live camera preview" style={VIDEO_STYLE} />
      <canvas ref={canvasRef} aria-hidden style={CANVAS_STYLE} />
    </View>
  );
}

const VIDEO_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transform: 'scaleX(-1)',
} as const;

// No transform and no object-fit: the page sizes the backing store to the view and does the cover
// crop and the mirror itself.
const CANVAS_STYLE = { position: 'absolute', inset: 0, width: '100%', height: '100%' } as const;

/** The skeleton page's view of the DOM: view size, video size, the clock and a spare canvas. */
function skeletonEnv(canvas: HTMLCanvasElement, video: HTMLVideoElement): SkeletonEnv {
  return {
    canvas,
    size: () => ({ cw: canvas.clientWidth, ch: canvas.clientHeight, dpr: window.devicePixelRatio || 1 }),
    video: () => ({ w: video.videoWidth, h: video.videoHeight }),
    raf: (cb) => {
      requestAnimationFrame(cb);
    },
    now: () => performance.now(),
    createCanvas: (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    },
    mirror: true,
  };
}

function meanLuma(rgba: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
  return sum / (rgba.length / 4);
}
