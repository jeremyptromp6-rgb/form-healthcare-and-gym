import { fail, fromMediaPipePose, type PoseDetection, type PoseProvider, type ProviderResult, type ProviderStatus } from '@form/domain';
import type * as Vision from '@mediapipe/tasks-vision';
import { config } from '@/lib/config';

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
 * On-device pose provider for the web build: MediaPipe Pose Landmarker (BlazePose lite) running
 * in WebAssembly + WebGL inside the browser. Frames go from the <video> element straight into the
 * model; nothing is uploaded or stored. The wasm runtime is served from FORM's own origin
 * (public/mediapipe/wasm); the model file is fetched once from `config.poseModelUrl`.
 */

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
  let status: ProviderStatus = { state: 'degraded', provider: 'MediaPipe Pose (web)', reason: 'not loaded' };

  async function load(): Promise<ProviderResult<void>> {
    if (landmarker) return { ok: true, value: undefined };
    if (typeof WebAssembly === 'undefined') return fail('unavailable', "This browser can't run camera coaching.", false);
    try {
      const vision = await loadVision();
      const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const create = (delegate: 'GPU' | 'CPU') =>
        vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: config.poseModelUrl, delegate },
          runningMode: 'VIDEO',
          // Two, so a second person in frame is detected (and blocks tracking) rather than ignored.
          numPoses: 2,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
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
        const result = landmarker.detectForVideo(video, ts);
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
