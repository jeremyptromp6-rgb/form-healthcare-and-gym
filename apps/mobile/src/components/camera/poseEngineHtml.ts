import { FRAMING_THRESHOLDS, MEDIAPIPE_POSE_INDEX, SKELETON_EDGES } from '@form/domain';

/** The MediaPipe build the phone engine loads — the same version the web app bundles. */
export const MEDIAPIPE_VERSION = '1.0.1';

/** How often the engine looks for a second person (the "only you in frame" check), in ms. */
export const CROWD_CHECK_MS = 1500;

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
 * JavaScript engine (Hermes) can't turn a compiled function back into source. It loads MediaPipe,
 * times the GPU and CPU backends on this phone's first real camera frames and keeps the faster,
 * then answers each camera frame with landmarks. Tracking runs for ONE person (MediaPipe only skips its expensive person
 * detector when it's tracking as many people as it was asked for); a second, image-mode model
 * looks for anyone else every CROWD_CHECK_MS so the "only you in frame" rule still holds.
 * Uses only its arguments and the global `Vision` from MediaPipe's script build.
 *   engineCore(send, { cdn, modelUrl, crowdEveryMs }) → handle({ type: 'init' } | { type: 'frame', bitmap, ts })
 *   send({ type: 'loaded' } | { type: 'ready', backend } | { type: 'backend', backend, ms } | { type: 'error', message } | { type: 'result', ts, people, ms } | { type: 'frameError', message })
 */
export const ENGINE_CORE = `function engineCore(send, CFG) {
  var V = self.Vision;
  var track = null, crowd = null, lastTs = 0, crowdAt = -1e9, others = [], othersUntil = 0;
  function r4(n) { return Math.round(n * 10000) / 10000; }
  function pack(l) { return l.map(function (p) { return [r4(p.x), r4(p.y), r4(p.visibility == null ? 0 : p.visibility)]; }); }
  function center(p) {
    var pts = [11, 12, 23, 24].map(function (i) { return p[i]; }).filter(Boolean);
    if (!pts.length) return [0.5, 0.5];
    var x = 0, y = 0;
    pts.forEach(function (q) { x += q[0]; y += q[1]; });
    return [x / pts.length, y / pts.length];
  }
  function make(files, buf, delegate, runningMode, numPoses) {
    return V.PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: buf.slice(), delegate: delegate },
      runningMode: runningMode, numPoses: numPoses,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      outputSegmentationMasks: false
    });
  }
  // Every backend that starts gets PROBE_FRAMES real camera frames; the faster one (median, after
  // warm-up) keeps tracking and the others are closed. Both exist up front, so switching never stalls.
  var PROBE_FRAMES = 10, WARMUP = 3, cands = [], probing = 0;
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : Infinity; }
  async function init() {
    var files = await V.FilesetResolver.forVisionTasks(CFG.cdn + '/wasm');
    var res = await fetch(CFG.modelUrl);
    if (!res.ok) throw new Error('model ' + res.status);
    var buf = new Uint8Array(await res.arrayBuffer());
    send({ type: 'loaded' });
    var delegates = ['GPU', 'CPU'];
    for (var d = 0; d < delegates.length; d++) {
      try {
        cands.push({ delegate: delegates[d], lm: await make(files, buf, delegates[d], 'VIDEO', 1), times: [] });
      } catch (e) {
        // This backend isn't available here (e.g. no WebGL in a worker); the other one will do.
      }
    }
    if (!cands.length) throw new Error('No pose backend could start');
    track = cands[0].lm;
    probing = cands.length > 1 ? 0 : -1;
    // The crowd check runs once per CROWD_CHECK_MS; the CPU backend needs no extra GPU context.
    try { crowd = await make(files, buf, 'CPU', 'IMAGE', 2); } catch (e) { try { crowd = await make(files, buf, cands[0].delegate, 'IMAGE', 2); } catch (e2) { crowd = null; } }
    send({ type: 'ready', backend: cands[0].delegate });
  }
  function probe(ms) {
    var cur = cands[probing];
    cur.times.push(ms);
    if (cur.times.length < PROBE_FRAMES) return;
    if (probing < cands.length - 1) { probing++; track = cands[probing].lm; return; }
    var best = cands[0];
    cands.forEach(function (c) { if (median(c.times.slice(WARMUP)) < median(best.times.slice(WARMUP))) best = c; });
    cands.forEach(function (c) { if (c !== best) c.lm.close(); });
    track = best.lm;
    probing = -1;
    send({ type: 'backend', backend: best.delegate, ms: Math.round(median(best.times.slice(WARMUP))) });
  }
  function frame(m) {
    if (!track) { m.bitmap.close(); return; }
    var t0 = performance.now();
    var ts = m.ts <= lastTs ? lastTs + 1 : m.ts;
    lastTs = ts;
    try {
      var people = track.detectForVideo(m.bitmap, ts).landmarks.map(pack);
      if (probing >= 0) probe(performance.now() - t0);
      if (crowd && ts - crowdAt >= CFG.crowdEveryMs) {
        crowdAt = ts;
        var main = people[0] ? center(people[0]) : null;
        others = crowd.detect(m.bitmap).landmarks.map(pack).filter(function (p) {
          if (!main) return true;
          var c = center(p);
          return Math.hypot(c[0] - main[0], c[1] - main[1]) > 0.12;
        });
        othersUntil = ts + CFG.crowdEveryMs + 500;
      }
      if (others.length && ts < othersUntil) people = people.concat(others);
      send({ type: 'result', ts: ts, people: people, ms: performance.now() - t0 });
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
 * The skeleton is smoothed (One Euro filter) and redrawn at the screen's refresh rate, gliding
 * between model results. Each result's raw landmarks go to the app, where FORM's shared
 * LivePoseSession counts reps and judges form exactly as on the web. Frames never leave the
 * phone; only joint coordinates cross into the app. Messages:
 *   { t: 'camera', kind: 'requesting' | 'live' | 'ended' | 'error', name? }
 *   { t: 'pose', kind: 'loading' | 'ready' | 'failed', backend?, offline? }
 *   { t: 'frame', ts, w, h, ms, b, people: [[x, y, visibility] × 33][] }
 * The app sets `window.__skeletonColor` (tracking quality) and calls `window.formStop()`.
 */
export function poseEngineHtml({ modelUrl, version = MEDIAPIPE_VERSION, colors }: { modelUrl: string; version?: string; colors: { good: string; warn: string; other: string } }): string {
  const cdn = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}`;
  const cfg = JSON.stringify({ cdn, modelUrl, crowdEveryMs: CROWD_CHECK_MS, edges: skeletonIndexEdges(), visible: FRAMING_THRESHOLDS.visibleConfidence, colors });
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}video,canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}</style>
</head><body><video id="v" muted playsinline autoplay></video><canvas id="c"></canvas>
<script>
const CFG = ${cfg};
const ENGINE_SRC = ${JSON.stringify(ENGINE_CORE)};
const engineCore = (0, eval)("(" + ENGINE_SRC + ")");
const post = (m) => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
const v = document.getElementById('v');
const c = document.getElementById('c');
const ctx = c.getContext('2d');
const sampler = document.createElement('canvas'); sampler.width = 32; sampler.height = 24;
const sctx = sampler.getContext('2d', { willReadFrequently: true });
window.__skeletonColor = CFG.colors.warn;
let engine = null, mode = 'worker', ready = false, busy = false, busySince = 0, stream = null, stopped = false;
let latency = 0, lastLumaAt = -1e9, luma = undefined;
const START_TIMEOUT_MS = 20000;

window.formStop = () => {
  stopped = true;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (engine && engine.terminate) engine.terminate();
  ctx.clearRect(0, 0, c.width, c.height);
};

// ---- the model: a Web Worker, or (if a phone can't run one) this page itself ----
function startWorker() {
  const src = 'importScripts(' + JSON.stringify(CFG.cdn + '/vision_bundle.js') + ');\\n' +
    'const handle = (' + ENGINE_SRC + ')((m) => self.postMessage(m), ' + JSON.stringify({ cdn: CFG.cdn, modelUrl: CFG.modelUrl, crowdEveryMs: CFG.crowdEveryMs }) + ');\\n' +
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
  if (engine && engine.terminate) engine.terminate();
  const s = document.createElement('script');
  s.src = CFG.cdn + '/vision_bundle.js'; s.crossOrigin = 'anonymous';
  s.onload = () => {
    const handle = engineCore((m) => setTimeout(() => onEngine(m), 0), { cdn: CFG.cdn, modelUrl: CFG.modelUrl, crowdEveryMs: CFG.crowdEveryMs });
    engine = { send: (m) => setTimeout(() => handle(m), 0), terminate: null };
    engine.send({ type: 'init' });
  };
  s.onerror = () => post({ t: 'pose', kind: 'failed', offline: navigator.onLine === false, message: 'script' });
  document.head.appendChild(s);
}
function onEngine(m) {
  if (stopped) return;
  if (m.type === 'ready') { ready = true; post({ t: 'pose', kind: 'ready', backend: m.backend }); pump(); return; }
  if (m.type === 'backend') { post({ t: 'pose', kind: 'ready', backend: m.backend }); return; }
  // Downloaded but not started a while later: this phone's worker is stuck — run in the page instead.
  if (m.type === 'loaded') { if (mode === 'worker') setTimeout(() => { if (!ready && mode === 'worker') startInline(); }, START_TIMEOUT_MS); return; }
  if (m.type === 'error') {
    if (mode === 'worker') startInline();
    else post({ t: 'pose', kind: 'failed', offline: navigator.onLine === false, message: m.message });
    return;
  }
  if (m.type === 'frameError') { busy = false; ready = false; post({ t: 'pose', kind: 'failed', offline: false, message: m.message }); return; }
  if (m.type === 'result') {
    busy = false;
    latency = latency === 0 ? m.ms : latency * 0.8 + m.ms * 0.2;
    smoothInto(m.people, m.ts);
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
  onVideoFrame();
}
let lastVideoTime = -1;
function onVideoFrame() {
  if (stopped) return;
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
  createImageBitmap(v).then((bitmap) => {
    if (stopped) { bitmap.close(); return; }
    engine.send({ type: 'frame', bitmap, ts: performance.now() }, [bitmap]);
  }).catch(() => { busy = false; });
}

// ---- smooth skeleton: One Euro filter on each result, then glide to it every display frame ----
const MIN_CUTOFF = 1.5, BETA = 10, D_CUTOFF = 1;
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
let filters = [], shown = [], targets = [], lastResultTs = 0;
function smoothInto(people, ts) {
  const dt = lastResultTs ? Math.max(0.001, (ts - lastResultTs) / 1000) : 1 / 30;
  lastResultTs = ts;
  targets = people.map((p, pi) => {
    const f = filters[pi] || (filters[pi] = []);
    return p.map((k, ki) => {
      const s = f[ki];
      if (!s) { f[ki] = { x: k[0], y: k[1], dx: 0, dy: 0 }; return [k[0], k[1], k[2]]; }
      const dx = (k[0] - s.x) / dt, dy = (k[1] - s.y) / dt;
      const ad = alpha(D_CUTOFF, dt);
      s.dx = s.dx + ad * (dx - s.dx); s.dy = s.dy + ad * (dy - s.dy);
      const ax = alpha(MIN_CUTOFF + BETA * Math.abs(s.dx), dt), ay = alpha(MIN_CUTOFF + BETA * Math.abs(s.dy), dt);
      s.x = s.x + ax * (k[0] - s.x); s.y = s.y + ay * (k[1] - s.y);
      return [s.x, s.y, k[2]];
    });
  });
  filters.length = people.length;
}
let lastDraw = 0;
function draw(now) {
  if (stopped) return;
  const dt = lastDraw ? Math.min(100, now - lastDraw) : 16;
  lastDraw = now;
  const w = v.videoWidth || 640, h = v.videoHeight || 480;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const k = 1 - Math.exp(-dt / 30);
  shown = targets.map((p, pi) => p.map((t, ki) => {
    const s = shown[pi] && shown[pi][ki];
    return s ? [s[0] + (t[0] - s[0]) * k, s[1] + (t[1] - s[1]) * k, t[2]] : t;
  }));
  ctx.clearRect(0, 0, w, h);
  const line = Math.max(2, w / 240);
  ctx.globalAlpha = 0.85; ctx.lineCap = 'round'; ctx.lineWidth = line;
  shown.forEach((p, i) => {
    const color = i > 0 ? CFG.colors.other : window.__skeletonColor;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.beginPath();
    for (const [a, b] of CFG.edges) {
      const pa = p[a], pb = p[b];
      if (!pa || !pb || pa[2] < CFG.visible || pb[2] < CFG.visible) continue;
      ctx.moveTo(pa[0] * w, pa[1] * h); ctx.lineTo(pb[0] * w, pb[1] * h);
    }
    ctx.stroke();
    for (const q of p) { if (q[2] < CFG.visible) continue; ctx.beginPath(); ctx.arc(q[0] * w, q[1] * h, line * 1.1, 0, Math.PI * 2); ctx.fill(); }
  });
  ctx.globalAlpha = 1;
  requestAnimationFrame(draw);
}

post({ t: 'pose', kind: 'loading' });
try { if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') throw 0; startWorker(); } catch (e) { startInline(); }
startCamera();
requestAnimationFrame(draw);
</script></body></html>`;
}
