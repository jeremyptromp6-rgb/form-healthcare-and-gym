import { FRAMING_THRESHOLDS, MEDIAPIPE_POSE_INDEX, SKELETON_EDGES } from '@form/domain';
import { MODEL_BUDGET_MS, MODEL_BYTES, POSE_CONFIDENCE } from '../../lib/pose/poseModels';
import { SKELETON_BUNDLE, skeletonConfig } from './skeletonPage';
import { skeletonPalette } from './skeletonState';
import type { SkeletonState } from './skeletonTypes';

/** The MediaPipe build the phone engine loads — the same version the web app bundles. */
export const MEDIAPIPE_VERSION = '1.0.1';

/** Starting the GPU backend longer than this (some phones stall on it) → use the CPU instead. */
export const GPU_START_TIMEOUT_MS = 10_000;
/** A GPU slower than this per frame (median) gets compared against the CPU on real frames. */
export const SLOW_FRAME_MS = 40;

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
 * The pose model, as JavaScript SOURCE TEXT (not a function in this file): it runs inside the
 * WebView — in a Web Worker normally, or in the page itself as a fallback — and the app's own
 * JavaScript engine (Hermes) can't turn a compiled function back into source.
 *
 * Built to start reliably on phones: MediaPipe's runtime (~12 MB) and the pose model (the FULL
 * model, ~9 MB) are downloaded ONCE, with progress reported, and handed to MediaPipe from memory.
 * Only one pose model runs at a time (each instance is a full copy of the runtime — several at once
 * is what made phones stall). It starts on the GPU, giving up on it after GPU_START_TIMEOUT_MS.
 * If the full model's median inference is over the budget and a lite model is configured, the lite
 * one is fetched quietly (no progress, never an error) and swapped in between frames, so tracking
 * never pauses; if that fails, the full model carries on. Then, if the GPU turns out slow on real
 * frames, the CPU is tried alongside and the faster one kept. Tracking is for one person (MediaPipe
 * skips its costly person detector only when it tracks as many people as asked for).
 * Uses only its arguments and the global `Vision` from MediaPipe's script build.
 *   engineCore(send, { cdn, modelUrl, gpuTimeoutMs, slowFrameMs, liteUrl?, modelBytes?, liteBytes?, modelBudgetMs?,
 *     confDetection?, confPresence?, confTracking? }) → handle({ type: 'init' } | { type: 'frame', bitmap, ts })
 *   send({ type: 'progress', stage: 'runtime' | 'model' | 'starting', pct } | { type: 'ready', backend }
 *     | { type: 'model', variant: 'full' | 'lite' | 'switching' } (only when liteUrl is set; 'switching' = creating the lite model)
 *     | { type: 'backend', backend, ms } | { type: 'error', message } | { type: 'result', ts, people, ms } | { type: 'frameError', message })
 */
export const ENGINE_CORE = `function engineCore(send, CFG) {
  var V = self.Vision;
  var track = null, trackDelegate = null, lastTs = 0;
  var files = null, modelBuf = null, variant = 'full';
  // Optional settings; without them the engine behaves as it always did (no lite fallback).
  var LITE = CFG.liteUrl || null;
  var MODEL_BYTES = CFG.modelBytes || 6e6, LITE_BYTES = CFG.liteBytes || 5.5e6, BUDGET = CFG.modelBudgetMs || 32;
  var CONF_DETECT = CFG.confDetection == null ? 0.5 : CFG.confDetection;
  var CONF_PRESENT = CFG.confPresence == null ? 0.4 : CFG.confPresence;
  var CONF_TRACK = CFG.confTracking == null ? 0.4 : CFG.confTracking;
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function pack(l) { return l.map(function (p) { return [r4(p.x), r4(p.y), r4(p.visibility == null ? 0 : p.visibility)]; }); }
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : Infinity; }
  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  // Downloads a file once, reporting progress; total is shared across the files so the bar moves smoothly.
  // Quiet downloads (the lite fallback, fetched while tracking) report nothing at all.
  var progress = { done: 0, total: 0 };
  async function download(url, expected, stage, quiet) {
    var res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(stage + ' ' + res.status);
    var size = Number(res.headers.get('content-length')) || expected;
    if (!quiet) progress.total += size - expected;
    if (!res.body || !res.body.getReader) {
      var whole = new Uint8Array(await res.arrayBuffer());
      if (!quiet) {
        progress.done += whole.length;
        send({ type: 'progress', stage: stage, pct: Math.min(99, Math.round((progress.done / progress.total) * 100)) });
      }
      return whole;
    }
    var reader = res.body.getReader(), chunks = [], got = 0, lastPct = -1;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      chunks.push(r.value); got += r.value.length;
      if (quiet) continue;
      progress.done += r.value.length;
      var pct = Math.min(99, Math.round((progress.done / progress.total) * 100));
      if (pct !== lastPct) { lastPct = pct; send({ type: 'progress', stage: stage, pct: pct }); }
    }
    var out = new Uint8Array(got), o = 0;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return out;
  }
  function make(delegate, buf) {
    return V.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: buf.slice(), delegate: delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: CONF_DETECT, minPosePresenceConfidence: CONF_PRESENT, minTrackingConfidence: CONF_TRACK,
      outputSegmentationMasks: false
    });
  }
  async function init() {
    send({ type: 'progress', stage: 'runtime', pct: 0 });
    files = await V.FilesetResolver.forVisionTasks(CFG.cdn + '/wasm');
    // Rough sizes until the server says (runtime ~12 MB, then the model).
    progress.total = 12e6 + MODEL_BYTES;
    var wasm = await download(files.wasmBinaryPath, 12e6, 'runtime');
    files.wasmBinaryPath = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
    modelBuf = await download(CFG.modelUrl, MODEL_BYTES, 'model');
    send({ type: 'progress', stage: 'starting', pct: 100 });
    try {
      track = await withTimeout(make('GPU', modelBuf), CFG.gpuTimeoutMs);
      trackDelegate = 'GPU';
    } catch (e) {
      track = await make('CPU', modelBuf);
      trackDelegate = 'CPU';
    }
    send({ type: 'ready', backend: trackDelegate });
    if (LITE) send({ type: 'model', variant: variant });
  }
  // If the GPU is slow on real frames, start the CPU alongside (tracking carries on meanwhile),
  // time it on real frames too, keep the faster and close the other.
  var times = [], trial = null, trialTimes = [], decided = false, liteTried = false;
  // The full model is too slow here: fetch the lite one quietly and swap it in between frames (the
  // full model keeps tracking meanwhile). Any failure leaves the full model running, silently.
  async function switchToLite() {
    var buf = null, lm = null, pending = null;
    try {
      buf = await download(LITE, LITE_BYTES, 'model', true);
      // Creating the model can hold the engine up for a few seconds: tell the app, so a pause in the results isn't taken for a stall.
      send({ type: 'model', variant: 'switching' });
      pending = make(trackDelegate, buf);
      try {
        lm = await withTimeout(pending, CFG.gpuTimeoutMs);
      } catch (e) {
        // A create that hangs may still finish later: close it then, so it never leaks.
        pending.then(function (late) { try { late.close(); } catch (ce) {} }, function () {});
        throw e;
      }
    } catch (e) {
      // Stay on the full model; the backend choice carries on as if nothing happened.
      decided = false;
      return;
    }
    var old = track;
    track = lm; modelBuf = buf; variant = 'lite';
    try { old.close(); } catch (ce) {}
    // The lite model is timed afresh, so the GPU/CPU verdict runs again on it.
    times = []; trialTimes = []; trial = null; decided = false;
    send({ type: 'model', variant: variant });
  }
  function consider(ms) {
    if (decided) return;
    if (!trial) {
      times.push(ms);
      if (times.length < 15) return;
      var gpu = median(times.slice(4));
      if (variant === 'full' && LITE && !liteTried && gpu > BUDGET) {
        liteTried = true; decided = true;
        switchToLite();
        return;
      }
      if (trackDelegate !== 'GPU' || gpu <= CFG.slowFrameMs) { decided = true; send({ type: 'backend', backend: trackDelegate, ms: Math.round(gpu) }); return; }
      trial = 'starting';
      make('CPU', modelBuf).then(function (lm) { trial = lm; }, function () { decided = true; trial = null; });
      return;
    }
  }
  function frame(m) {
    if (!track) { m.bitmap.close(); return; }
    var t0 = performance.now();
    var ts = m.ts <= lastTs ? lastTs + 1 : m.ts;
    lastTs = ts;
    try {
      var people = track.detectForVideo(m.bitmap, ts).landmarks.map(pack);
      var took = performance.now() - t0;
      consider(took);
      // The CPU trial runs on the same frames until it has a verdict. MediaPipe's pose models share
      // one timeline, so every call needs a strictly later timestamp than the last — the trial gets
      // the frame's time plus a hair, and the next frame's time is checked against it.
      if (trial && trial !== 'starting' && !decided) {
        var c0 = performance.now();
        lastTs = ts + 0.01;
        try {
          trial.detectForVideo(m.bitmap, lastTs);
          trialTimes.push(performance.now() - c0);
        } catch (te) {
          // The trial failed: keep tracking as before and stop trying.
          try { trial.close(); } catch (ce) {}
          trial = null; decided = true;
          send({ type: 'backend', backend: trackDelegate, ms: Math.round(median(times.slice(4))) });
        }
        if (trial && trialTimes.length >= 12) {
          var cpu = median(trialTimes.slice(3)), gpu = median(times.slice(4));
          decided = true;
          if (cpu < gpu) { track.close(); track = trial; trackDelegate = 'CPU'; } else { trial.close(); }
          trial = null;
          send({ type: 'backend', backend: trackDelegate, ms: Math.round(Math.min(cpu, gpu)) });
        }
      }
      send({ type: 'result', ts: ts, people: people, ms: took });
    } catch (e) {
      send({ type: 'frameError', message: String(e) });
    } finally {
      m.bitmap.close();
    }
  }
  return function (m) {
    if (m.type === 'init') init().catch(function (e) { send({ type: 'error', message: String(e && e.message ? e.message : e) }); });
    else if (m.type === 'frame') frame(m);
  };
}`;

/**
 * The on-device pose engine for phones: a tiny page run inside a WebView. It opens the front
 * camera with getUserMedia and hands the newest frame to the pose model in a Web Worker (one
 * frame in flight, never a backlog), so the page's own thread only shows the video and draws.
 * The skeleton is drawn by the shared skeleton page (skeletonPage.ts, embedded as text): it
 * smooths and predicts the joints, holds and fades them when tracking blips, and redraws at the
 * screen's refresh rate on a canvas that covers the view (the video is mirrored, the skeleton is
 * mapped mirrored, so the two line up). Each result's raw landmarks also go to the app, where
 * FORM's shared LivePoseSession counts reps and judges form exactly as on the web. Frames never
 * leave the phone; only joint coordinates cross into the app. Messages:
 *   { t: 'camera', kind: 'requesting' | 'live' | 'ended' | 'error', name? }
 *   { t: 'pose', kind: 'loading', stage?: 'runtime' | 'model' | 'starting', pct? } | { t: 'pose', kind: 'ready' | 'failed', backend?, offline? }
 *   { t: 'pose', kind: 'model', variant: 'full' | 'lite' | 'switching' }
 *   { t: 'frame', ts, w, h, ms, b, people: [[x, y, visibility] × 33][] }
 * The app sets the skeleton's look by calling `window.formSkeleton(state)` (a state it also leaves
 * in `window.__formSkeleton`, applied at start; `window.__skeletonColor` is the older one-colour
 * form, kept for compatibility) and calls `window.formStop()`.
 */
export function poseEngineHtml({ modelUrl, version = MEDIAPIPE_VERSION, colors, liteModelUrl = null }: { modelUrl: string; version?: string; colors: { good: string; warn: string; other: string }; liteModelUrl?: string | null }): string {
  const cdn = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}`;
  const engine = {
    gpuTimeoutMs: GPU_START_TIMEOUT_MS,
    slowFrameMs: SLOW_FRAME_MS,
    modelBytes: MODEL_BYTES.full,
    liteBytes: MODEL_BYTES.lite,
    modelBudgetMs: MODEL_BUDGET_MS,
    confDetection: POSE_CONFIDENCE.detection,
    confPresence: POSE_CONFIDENCE.presence,
    confTracking: POSE_CONFIDENCE.tracking,
  };
  // Until the app sends its own state, the skeleton starts from the colours it was given.
  const defaultState: SkeletonState = {
    v: 1,
    tone: 'good',
    side: null,
    chain: [],
    palette: { ...skeletonPalette(), good: colors.good, fix: colors.warn, warn: colors.warn, other: colors.other },
    reduceMotion: false,
  };
  const cfg = JSON.stringify({ cdn, modelUrl, liteUrl: liteModelUrl, engine, edges: skeletonIndexEdges(), visible: FRAMING_THRESHOLDS.visibleConfidence, colors, skeleton: skeletonConfig(), skeletonState: defaultState });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video,canvas{position:absolute;inset:0;width:100%;height:100%}video{object-fit:cover;transform:scaleX(-1)}</style>
</head><body><video id="v" muted playsinline autoplay></video><canvas id="c"></canvas>
<script>
${pageScript(cfg)}</script></body></html>`;
}

/**
 * The page's own script, as source text with the settings JSON (one line) in front. Everything
 * the page needs is here or in the two texts it embeds: the engine core (the model) and the
 * skeleton bundle (the drawing).
 */
export function pageScript(cfgJson: string): string {
  return `const CFG = ${cfgJson};
const ENGINE_SRC = ${JSON.stringify(ENGINE_CORE)};
const engineCore = (0, eval)("(" + ENGINE_SRC + ")");
const SKELETON_SRC = ${JSON.stringify(SKELETON_BUNDLE)};
const post = (m) => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
const v = document.getElementById('v');
const c = document.getElementById('c');
const ctx = c.getContext('2d');
const sampler = document.createElement('canvas'); sampler.width = 32; sampler.height = 24;
const sctx = sampler.getContext('2d', { willReadFrequently: true });
window.__skeletonColor = CFG.colors.warn;
let engine = null, mode = 'worker', ready = false, busy = false, busySince = 0, stream = null, stopped = false;
let latency = 0, lastLumaAt = -1e9, luma = undefined, frameErrors = [];
const START_TIMEOUT_MS = 25000;
const ENGINE_CFG = Object.assign({ cdn: CFG.cdn, modelUrl: CFG.modelUrl, liteUrl: CFG.liteUrl }, CFG.engine);

// ---- the skeleton: the canvas covers the view; the mapper (mirrored) lines it up with the video ----
let viewW = 0, viewH = 0, watching = false;
const readView = () => { viewW = c.clientWidth; viewH = c.clientHeight; };
readView();
if (typeof ResizeObserver !== 'undefined') {
  try { new ResizeObserver(readView).observe(c); watching = true; } catch (e) {}
}
// The drawing is optional: if it fails to load, to start or later, the camera and the rep counting go on
// without a skeleton. Every call goes through a wrapper that swallows errors; a skeleton that could not
// be built is replaced by one that does nothing.
const SK_METHODS = ['push', 'setState', 'setBackend', 'setInline', 'start', 'stop', 'frame', 'stats'];
let skRaw = null;
try {
  skRaw = (0, eval)(SKELETON_SRC)({
    canvas: c,
    mirror: true,
    size: () => { if (!watching) readView(); return { cw: viewW, ch: viewH, dpr: window.devicePixelRatio || 1 }; },
    video: () => ({ w: v.videoWidth, h: v.videoHeight }),
    raf: (cb) => requestAnimationFrame(cb),
    now: () => performance.now(),
    createCanvas: (w, h) => { const k = document.createElement('canvas'); k.width = w; k.height = h; return k; }
  }, CFG.skeleton);
} catch (e) { skRaw = null; }
const sk = {};
SK_METHODS.forEach((name) => {
  sk[name] = (a, b, d, e, f) => { try { return skRaw ? skRaw[name](a, b, d, e, f) : undefined; } catch (err) { return undefined; } };
});
const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
sk.setState(Object.assign({}, CFG.skeletonState, { reduceMotion: !!(reduceQuery && reduceQuery.matches) }));
// A state the app injected before this script ran (it leaves its latest in __formSkeleton).
if (window.__formSkeleton) sk.setState(window.__formSkeleton);
window.formSkeleton = (s) => { sk.setState(s); };

window.formStop = () => {
  stopped = true;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (engine && engine.terminate) engine.terminate();
  sk.stop();
  ctx.clearRect(0, 0, c.width, c.height);
};

// ---- the model: a Web Worker, or (if a phone can't run one) this page itself ----
function startWorker() {
  const src = 'importScripts(' + JSON.stringify(CFG.cdn + '/vision_bundle.js') + ');\\n' +
    'const handle = (' + ENGINE_SRC + ')((m) => self.postMessage(m), ' + JSON.stringify(ENGINE_CFG) + ');\\n' +
    'self.onmessage = (e) => handle(e.data);';
  const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  w.onmessage = (e) => onEngine(e.data);
  w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); if (!ready) startInline(); };
  engine = { send: (m, transfer) => w.postMessage(m, transfer || []), terminate: () => w.terminate() };
  engine.send({ type: 'init' });
}
function startInline() {
  if (mode === 'inline' || stopped) return;
  mode = 'inline';
  sk.setInline();
  if (engine && engine.terminate) engine.terminate();
  const s = document.createElement('script');
  s.src = CFG.cdn + '/vision_bundle.js'; s.crossOrigin = 'anonymous';
  s.onload = () => {
    const handle = engineCore((m) => setTimeout(() => onEngine(m), 0), ENGINE_CFG);
    engine = { send: (m) => setTimeout(() => handle(m), 0), terminate: null };
    engine.send({ type: 'init' });
  };
  s.onerror = () => post({ t: 'pose', kind: 'failed', offline: navigator.onLine === false, message: 'script' });
  document.head.appendChild(s);
}
function onEngine(m) {
  if (stopped) return;
  if (m.type === 'ready') { ready = true; sk.setBackend(m.backend); post({ t: 'pose', kind: 'ready', backend: m.backend }); pump(); return; }
  if (m.type === 'backend') { sk.setBackend(m.backend); post({ t: 'pose', kind: 'ready', backend: m.backend }); return; }
  if (m.type === 'model') { post({ t: 'pose', kind: 'model', variant: m.variant }); return; }
  if (m.type === 'progress') {
    post({ t: 'pose', kind: 'loading', stage: m.stage, pct: m.pct });
    // Downloaded but not started a while later: this phone's worker is stuck — run in the page instead.
    if (m.stage === 'starting' && mode === 'worker') setTimeout(() => { if (!ready && mode === 'worker' && !stopped) startInline(); }, START_TIMEOUT_MS);
    return;
  }
  if (m.type === 'error') {
    if (mode === 'worker') startInline();
    else post({ t: 'pose', kind: 'failed', offline: navigator.onLine === false, message: m.message });
    return;
  }
  if (m.type === 'frameError') {
    busy = false;
    // One bad frame is skipped; only repeated errors end the session (with "Try again").
    const now = performance.now();
    frameErrors = frameErrors.filter((t) => now - t < 5000).concat(now);
    if (frameErrors.length > 3) { ready = false; post({ t: 'pose', kind: 'failed', offline: false, message: m.message }); }
    else pump();
    return;
  }
  if (m.type === 'result') {
    busy = false;
    latency = latency === 0 ? m.ms : latency * 0.8 + m.ms * 0.2;
    // The skeleton gets the people first, so a problem there can never hold back the rep counting.
    sk.push(m.people, capOf(m.ts), performance.now(), v.videoWidth, v.videoHeight);
    sk.start();
    post({ t: 'frame', ts: m.ts, w: v.videoWidth, h: v.videoHeight, ms: Math.round(latency), b: luma, people: m.people });
    pump();
  }
}

// ---- the camera, and feeding the newest frame to the model ----
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
  sk.start();
  onVideoFrame();
}
let lastVideoTime = -1;
// When the camera frame on screen was captured, from requestVideoFrameCallback's metadata: captureTime
// (the camera's own stamp), else expectedDisplayTime or presentationTime. All three are in the same
// clock as performance.now() (DOMHighResTimeStamps on the page's time origin), so they can be mixed
// with it freely. Without metadata (the setTimeout fallback) it is null, and pump uses performance.now().
let frameCap = null;
const capFrom = (meta) => {
  if (!meta) return null;
  const t = [meta.captureTime, meta.expectedDisplayTime, meta.presentationTime].find((x) => typeof x === 'number' && x > 0);
  return t === undefined ? null : t;
};
// The capture time of the frame in flight, by the ts it was sent with, for when its result comes back.
let inflight = null;
const capOf = (ts) => (inflight && Math.abs(inflight.ts - ts) < 2 ? inflight.cap : ts);
function onVideoFrame(now, meta) {
  if (stopped) return;
  frameCap = capFrom(meta);
  if (v.currentTime !== lastVideoTime) { lastVideoTime = v.currentTime; pump(); }
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onVideoFrame);
  else setTimeout(onVideoFrame, 15);
}
function pump() {
  const now = performance.now();
  if (busy && now - busySince > 3000) busy = false; // a lost frame never wedges the loop
  if (!ready || busy || stopped || v.readyState < 2 || !v.videoWidth) return;
  if (now - lastLumaAt >= 500 && sctx) {
    sctx.drawImage(v, 0, 0, 32, 24);
    const d = sctx.getImageData(0, 0, 32, 24).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    luma = s / (d.length / 4); lastLumaAt = now;
  }
  busy = true; busySince = now;
  const seen = frameCap; // the frame on screen now is the one the bitmap is taken from
  createImageBitmap(v).then((bitmap) => {
    if (stopped) { bitmap.close(); return; }
    // A capture time can't be later than now (an expected display time is); ts is unchanged: the engine timeline relies on it.
    const ts = performance.now();
    const cap = seen === null ? ts : Math.min(seen, ts);
    inflight = { ts, cap };
    engine.send({ type: 'frame', bitmap, ts, cap }, [bitmap]);
  }).catch(() => { busy = false; });
}

post({ t: 'pose', kind: 'loading' });
try { if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw 0; startWorker(); } catch (e) { startInline(); }
startCamera();
`;
}
