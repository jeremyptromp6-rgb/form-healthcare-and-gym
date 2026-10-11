import { fail, fromMediaPipePose, type PoseDetection, type PoseProvider, type ProviderResult, type ProviderStatus } from '@form/domain';
import type * as Vision from '@mediapipe/tasks-vision';
import { config } from '@/lib/config';
import { MODEL_BUDGET_MS, POSE_CONFIDENCE } from './poseModels';

type VisionModule = typeof Vision;
declare global {
  interface Window {
    __formVision?: VisionModule;
  }
}

/**
 * Loads MediaPipe as a native ES module from FORM's origin (public/mediapipe, copied from
 * node_modules by scripts/copy-pose-assets.mjs). Not bundled: see that script for why.
 */
function loadVision(): Promise<VisionModule> {
  if (window.__formVision) return Promise.resolve(window.__formVision);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/mediapipe/loader.mjs';
    const done = () => {
      window.removeEventListener('form-vision-ready', done);
      if (window.__formVision) resolve(window.__formVision);
      else reject(new Error('MediaPipe module did not initialise'));
    };
    window.addEventListener('form-vision-ready', done);
    script.onerror = () => {
      window.removeEventListener('form-vision-ready', done);
      script.remove();
      reject(new Error('MediaPipe module failed to load'));
    };
    document.head.appendChild(script);
  });
}

/**
 * On-device pose provider for the web build: MediaPipe Pose Landmarker (BlazePose full, with a
 * silent fall back to lite on a slow device) running in WebAssembly + WebGL inside the browser. Frames go from the <video> element straight into the
 * model; nothing is uploaded or stored. The wasm runtime is served from FORM's own origin
 * (public/mediapipe/wasm); the model file is fetched once from `config.poseModelUrl`.
 */

/** The first this-many real estimates are timed to decide whether the device can afford the full model. */
const SAMPLE_ESTIMATES = 15;
/** The first few are skipped: they still pay for shader compilation and cache warm-up. */
const SAMPLE_SKIP = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type WebPoseProvider = PoseProvider<HTMLVideoElement> & Required<Pick<PoseProvider<HTMLVideoElement>, 'load' | 'close'>> & { readonly backend: 'GPU' | 'CPU' | null };

/**
 * MediaPipe's WebAssembly runtime logs an informational glog line ("OpenGL error checking is
 * disabled") through console.warn when it creates its GL context. It isn't a problem, so it's
 * dropped — only that exact line, only while the model initialises. Everything else passes through.
 */
const INIT_NOTICE = /gl_context\.cc:\d+\] OpenGL error checking is disabled/;
function muteMediaPipeInitNotice(): () => void {
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    if (args.length > 0 && INIT_NOTICE.test(String(args[0]))) return;
    original(...args);
  };
  return () => {
    console.warn = original;
  };
}

export function createPoseProvider(): WebPoseProvider {
  let landmarker: Vision.PoseLandmarker | null = null;
  let loading: Promise<ProviderResult<void>> | null = null;
  let backend: 'GPU' | 'CPU' | null = null;
  let lastTs = -1;
  let closed = false;
  // Kept after load so a slow device can build the lite model the same way (same delegate).
  let make: ((url: string) => Promise<Vision.PoseLandmarker>) | null = null;
  const times: number[] = [];
  let decided = false;
  let status: ProviderStatus = { state: 'degraded', provider: 'MediaPipe Pose (web)', reason: 'not loaded' };

  async function load(): Promise<ProviderResult<void>> {
    if (landmarker) return { ok: true, value: undefined };
    if (typeof WebAssembly === 'undefined') return fail('unavailable', "This browser can't run camera coaching.", false);
    try {
      const vision = await loadVision();
      const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const create = (delegate: 'GPU' | 'CPU', url: string = config.poseModelUrl) =>
        vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: url, delegate },
          runningMode: 'VIDEO',
          // Two, so a second person in frame is detected (and blocks tracking) rather than ignored.
          numPoses: 2,
          minPoseDetectionConfidence: POSE_CONFIDENCE.detection,
          minPosePresenceConfidence: POSE_CONFIDENCE.presence,
          minTrackingConfidence: POSE_CONFIDENCE.tracking,
          outputSegmentationMasks: false,
        });
      let created: Vision.PoseLandmarker;
      let kind: 'GPU' | 'CPU' = 'GPU';
      const restoreConsole = muteMediaPipeInitNotice();
      try {
        try {
          created = await create('GPU');
        } catch {
          created = await create('CPU'); // no WebGL2 / GPU blocked: slower but still on-device
          kind = 'CPU';
        }
      } finally {
        restoreConsole();
      }
      // Warm up: the first inference compiles GPU shaders and can block for seconds. Do it now,
      // while the screen says "loading", instead of freezing the first tracked frames.
      try {
        const warm = document.createElement('canvas');
        warm.width = 64;
        warm.height = 64;
        created.detectForVideo(warm, 0);
        lastTs = 0;
      } catch {
        // A failed warm-up just means the first real frame pays the cost.
      }
      // The camera screen closed while the model was loading: free it instead of leaking GPU memory.
      if (closed) {
        created.close();
        return fail('unavailable', 'Pose model closed', false);
      }
      landmarker = created;
      backend = kind;
      make = (url) => create(kind, url);
      status = { state: 'ready', provider: 'MediaPipe Pose (web)' };
      return { ok: true, value: undefined };
    } catch (e) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      status = { state: 'degraded', provider: 'MediaPipe Pose (web)', reason: String(e) };
      return offline
        ? fail('network', 'Camera coaching needs an internet connection the first time it loads.')
        : fail('unavailable', "Camera coaching couldn't load.");
    }
  }

  /**
   * A device that can't run the full model in budget quietly moves to lite. The full landmarker keeps
   * serving until lite is built and warmed up, then the two swap and the old one is closed. Any failure
   * leaves the full model in place, with nothing said about it.
   */
  async function switchToLite(url: string) {
    const build = make;
    if (!build) return;
    const restoreConsole = muteMediaPipeInitNotice();
    let lite: Vision.PoseLandmarker | null = null;
    try {
      lite = await build(url);
      try {
        const warm = document.createElement('canvas');
        warm.width = 64;
        warm.height = 64;
        lite.detectForVideo(warm, ++lastTs); // a timestamp from the shared, strictly increasing sequence
      } catch {
        // The first real frame pays for it instead.
      }
      if (closed || !landmarker) {
        lite.close();
        return;
      }
      const old = landmarker;
      landmarker = lite;
      lite = null;
      try {
        old.close();
      } catch {
        // Already gone.
      }
    } catch {
      try {
        lite?.close();
      } catch {
        // Nothing to release.
      }
    } finally {
      restoreConsole();
    }
  }

  /** After the first estimates: too slow for the full model → try lite, once. */
  function considerLite() {
    if (decided || times.length < SAMPLE_ESTIMATES) return;
    decided = true;
    const lite = config.poseLiteModelUrl;
    if (lite && median(times.slice(SAMPLE_SKIP)) > MODEL_BUDGET_MS) void switchToLite(lite);
  }

  return {
    kind: 'pose',
    get backend() {
      return backend;
    },
    status: () => status,
    load() {
      loading ??= load().then((r) => {
        if (!r.ok) loading = null; // allow a retry
        return r;
      });
      return loading;
    },
    async estimate(video, timestampMs): Promise<ProviderResult<PoseDetection>> {
      if (!landmarker) return fail('unavailable', 'Pose model not loaded');
      if (!video.videoWidth || !video.videoHeight) return fail('invalid_input', 'No video frame yet', true);
      // MediaPipe requires strictly increasing timestamps in VIDEO mode.
      const ts = timestampMs <= lastTs ? lastTs + 1 : timestampMs;
      lastTs = ts;
      try {
        const began = performance.now();
        const result = landmarker.detectForVideo(video, ts);
        if (!decided) {
          times.push(performance.now() - began);
          considerLite();
        }
        return {
          ok: true,
          value: {
            timestampMs: ts,
            frame: { width: video.videoWidth, height: video.videoHeight },
            people: result.landmarks.map((l) => ({ keypoints: fromMediaPipePose(l) })),
          },
        };
      } catch (e) {
        return fail('unavailable', `Pose detection failed: ${String(e)}`);
      }
    },
    close() {
      closed = true;
      landmarker?.close();
      landmarker = null;
      loading = null;
      backend = null;
      lastTs = -1;
      status = { state: 'degraded', provider: 'MediaPipe Pose (web)', reason: 'closed' };
    },
  };
}
