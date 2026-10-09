import { FRAMING_THRESHOLDS, MEDIAPIPE_POSE_INDEX, SKELETON_EDGES } from '@form/domain';

/** The MediaPipe build the phone engine loads — the same version the web app bundles. */
export const MEDIAPIPE_VERSION = '1.0.1';

/** Skeleton edges as MediaPipe landmark indices, for drawing inside the engine page. */
export function skeletonIndexEdges(): [number, number][] {
  const index = new Map(MEDIAPIPE_POSE_INDEX.map((name, i) => [name, i] as const));
  return SKELETON_EDGES.flatMap(([a, b]) => {
    const ia = index.get(a);
    const ib = index.get(b);
    return ia === undefined || ib === undefined ? [] : [[ia, ib] as [number, number]];
  });
}

/**
 * The on-device pose engine for phones: a tiny page run inside a WebView. It opens the front
 * camera with getUserMedia, runs MediaPipe Pose Landmarker (WebAssembly + WebGL, on the phone),
 * draws the skeleton over the mirrored preview, and posts each frame's landmarks to the app —
 * where FORM's shared LivePoseSession counts reps and judges form exactly as on the web.
 * Frames never leave the phone; only joint coordinates cross into the app. Messages:
 *   { t: 'camera', kind: 'requesting' | 'live' | 'ended' | 'error', name? }
 *   { t: 'pose', kind: 'loading' | 'ready' | 'failed', backend?, offline? }
 *   { t: 'frame', ts, w, h, ms, b, people: [[x, y, visibility] × 33][] }
 * The app sets `window.__skeletonColor` (tracking quality) and calls `window.formStop()`.
 */
export function poseEngineHtml({ modelUrl, version = MEDIAPIPE_VERSION, colors }: { modelUrl: string; version?: string; colors: { good: string; warn: string; other: string } }): string {
  const cdn = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}`;
  const cfg = JSON.stringify({ cdn, modelUrl, edges: skeletonIndexEdges(), visible: FRAMING_THRESHOLDS.visibleConfidence, colors });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}</style>
</head><body><video id="v" muted playsinline autoplay></video><canvas id="c"></canvas>
<script type="module">
const CFG = ${cfg};
const post = (m) => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
const v = document.getElementById('v');
const c = document.getElementById('c');
const ctx = c.getContext('2d');
const sampler = document.createElement('canvas'); sampler.width = 32; sampler.height = 24;
const sctx = sampler.getContext('2d', { willReadFrequently: true });
window.__skeletonColor = CFG.colors.warn;
let landmarker = null, stream = null, stopped = false, lastVideoTime = -1, lastTs = -1, lastLumaAt = -1e9, luma = undefined, skip = false, latency = 0;
const r4 = (n) => Math.round(n * 10000) / 10000;

window.formStop = () => { stopped = true; if (stream) stream.getTracks().forEach((t) => t.stop()); ctx.clearRect(0, 0, c.width, c.height); };

async function loadModel() {
  post({ t: 'pose', kind: 'loading' });
  try {
    const vision = await import(CFG.cdn + '/vision_bundle.mjs');
    const files = await vision.FilesetResolver.forVisionTasks(CFG.cdn + '/wasm');
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: CFG.modelUrl, delegate }, runningMode: 'VIDEO', numPoses: 2,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5, outputSegmentationMasks: false });
    let backend = 'GPU';
    try { landmarker = await vision.PoseLandmarker.createFromOptions(files, opts('GPU')); }
    catch (e) { landmarker = await vision.PoseLandmarker.createFromOptions(files, opts('CPU')); backend = 'CPU'; }
    try { const w = document.createElement('canvas'); w.width = 64; w.height = 64; landmarker.detectForVideo(w, 0); lastTs = 0; } catch (e) {}
    post({ t: 'pose', kind: 'ready', backend });
  } catch (e) {
    post({ t: 'pose', kind: 'failed', offline: navigator.onLine === false, message: String(e) });
  }
}

async function startCamera() {
  post({ t: 'camera', kind: 'requesting' });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { post({ t: 'camera', kind: 'error', name: 'NotSupportedError' }); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
  } catch (e) { post({ t: 'camera', kind: 'error', name: e && e.name }); return; }
  if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
  const track = stream.getVideoTracks()[0];
  if (track) track.addEventListener('ended', () => post({ t: 'camera', kind: 'ended' }));
  v.srcObject = stream;
  v.play().catch(() => {});
  post({ t: 'camera', kind: 'live' });
}

function draw(people, w, h) {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  ctx.clearRect(0, 0, w, h);
  const line = Math.max(2, w / 240);
  ctx.globalAlpha = 0.85; ctx.lineCap = 'round'; ctx.lineWidth = line;
  people.forEach((p, i) => {
    const color = i > 0 ? CFG.colors.other : window.__skeletonColor;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.beginPath();
    for (const [a, b] of CFG.edges) {
      const pa = p[a], pb = p[b];
      if (!pa || !pb || pa[2] < CFG.visible || pb[2] < CFG.visible) continue;
      ctx.moveTo(pa[0] * w, pa[1] * h); ctx.lineTo(pb[0] * w, pb[1] * h);
    }
    ctx.stroke();
    for (const k of p) { if (k[2] < CFG.visible) continue; ctx.beginPath(); ctx.arc(k[0] * w, k[1] * h, line * 1.1, 0, Math.PI * 2); ctx.fill(); }
  });
  ctx.globalAlpha = 1;
}

function tick() {
  if (stopped) return;
  const now = performance.now();
  if (landmarker && v.readyState >= 2 && v.videoWidth && v.currentTime !== lastVideoTime) {
    lastVideoTime = v.currentTime;
    skip = latency > 45 ? !skip : false;
    if (!skip) {
      if (sctx && now - lastLumaAt >= 500) {
        sctx.drawImage(v, 0, 0, 32, 24);
        const d = sctx.getImageData(0, 0, 32, 24).data; let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        luma = s / (d.length / 4); lastLumaAt = now;
      }
      const ts = now <= lastTs ? lastTs + 1 : now; lastTs = ts;
      const started = performance.now();
      try {
        const res = landmarker.detectForVideo(v, ts);
        const took = performance.now() - started;
        latency = latency === 0 ? took : latency * 0.8 + took * 0.2;
        const people = res.landmarks.map((l) => l.map((p) => [r4(p.x), r4(p.y), r4(p.visibility == null ? 0 : p.visibility)]));
        draw(people, v.videoWidth, v.videoHeight);
        post({ t: 'frame', ts, w: v.videoWidth, h: v.videoHeight, ms: Math.round(latency), b: luma, people });
      } catch (e) {
        post({ t: 'pose', kind: 'failed', offline: false, message: String(e) });
        return;
      }
    }
  }
  requestAnimationFrame(tick);
}

loadModel();
startCamera();
requestAnimationFrame(tick);
</script></body></html>`;
}
