import { MEDIAPIPE_POSE_INDEX, type PosePerson } from '@form/domain';
import { SKELETON_CORE, SKELETON_TUNING, type SkeletonTuning } from './skeletonCore';
import { SKELETON_BONES, SKELETON_RENDER, SKELETON_STYLE } from './skeletonRender';
import type { SkeletonEnv, SkeletonPage } from './skeletonTypes';

/**
 * The skeleton page: the one object the camera page (and the web feed) talks to. It wires the
 * tracker (skeletonCore: mapper + bank) to the renderer (skeletonRender) and owns everything that
 * happens per display frame: sizing the canvas backing store, mapping the scene to screen px,
 * drawing, and the quality governor that lowers the look when drawing is too slow.
 *
 * SKELETON_PAGE is a "text module" like the core and the renderer: plain ES2017 source that runs
 * inside the WebView page, so it cannot import anything and must stay free of backticks,
 * dollar-brace, backslashes, regex literals, `?.`, `??`, shadowBlur and hex colours. The bundle
 * (SKELETON_BUNDLE) is the three texts in one expression: evaluate it, then call the result with
 * the env and the config (skeletonConfig()).
 */

/** Everything the three text modules are configured with. JSON-safe, so it can travel into the page. */
export interface SkeletonConfig {
  tuning: SkeletonTuning;
  render: { style: Record<string, unknown>; edges: number[][] };
}

export const SKELETON_PAGE = `function skeletonPage(core, render, env, CFG) {
  var GV = CFG.tuning.governor;
  var N = 33;
  // Recovery: after a demotion, quality steps back up one level once windows stay this cheap
  // (a share of glowOffDrawMs) for a number of windows in a row. Every demotion doubles that
  // number, so a level that is too expensive is retried ever more slowly instead of flapping.
  var CHEAP_FRAC = 0.5;
  var CHEAP_WINDOWS = 3;
  var MAX_NEED = 48;
  var mapper = core.createMapper();
  var bank = core.createBank();
  var rend = render.create(env);
  var canvas = env.canvas;
  var ctx = null;
  var out = { w: 0, h: 0, n: N, people: [] };
  var pool = [];
  var reduce = false;
  var backend = 'GPU';
  var inline = false;
  var cap = 2;
  var quality = 2;
  var running = false;
  // Every start() begins a new chain of frames. A chain that was scheduled before a stop() sees a
  // different generation when it wakes up and ends, so a stop and start never leave two chains.
  var gen = 0;
  var draws = 0;
  var gSum = 0;
  var gCount = 0;
  var cheap = 0;
  var need = CHEAP_WINDOWS;
  rend.setQuality(2);

  function getCtx() {
    if (!ctx) ctx = canvas.getContext('2d');
    return ctx;
  }

  function setQ(q) {
    quality = q;
    rend.setQuality(q);
    gSum = 0;
    gCount = 0;
  }

  // The CPU backend and the inline fallback are slow already: never the full look there.
  function recap() {
    cap = backend === 'CPU' || inline ? 1 : 2;
    if (quality > cap) {
      cheap = 0;
      setQ(cap);
    }
  }

  // One draw time per frame; a decision per window of windowFrames frames.
  function govern(ms) {
    var limit = GV.minimalDrawMs * 3;
    gSum += ms < 0 ? 0 : ms > limit ? limit : ms;
    gCount++;
    if (gCount < GV.windowFrames) return;
    var avg = gSum / gCount;
    gSum = 0;
    gCount = 0;
    var target = avg > GV.minimalDrawMs ? 0 : avg > GV.glowOffDrawMs ? 1 : 2;
    if (target < quality) {
      need = Math.min(need * 2, MAX_NEED);
      cheap = 0;
      setQ(target);
      return;
    }
    if (avg < GV.glowOffDrawMs * CHEAP_FRAC && quality < cap) {
      cheap++;
      if (cheap >= need) {
        cheap = 0;
        setQ(quality + 1);
      }
    } else cheap = 0;
  }

  function person(i) {
    while (pool.length <= i) {
      pool.push({ x: new Float32Array(N), y: new Float32Array(N), a: new Float32Array(N), pa: 0, primary: false });
    }
    return pool[i];
  }

  function frame() {
    var now = env.now();
    var sz = env.size();
    if (!(sz.cw > 0 && sz.ch > 0)) return;
    var vd = env.video();
    var m = mapper.update(sz.cw, sz.ch, vd.w, vd.h, sz.dpr, env.mirror);
    // Setting the size resets the context, so the transform is set after it, on every frame.
    if (canvas.width !== m.pw) canvas.width = m.pw;
    if (canvas.height !== m.ph) canvas.height = m.ph;
    var c = getCtx();
    if (!c) return;
    c.setTransform(m.scale, 0, 0, m.scale, 0, 0);
    var scene = bank.step(now);
    // The clear covers the whole backing store (it can be half a device pixel larger than the view).
    out.w = m.pw / m.scale;
    out.h = m.ph / m.scale;
    var n = scene.n;
    for (var i = 0; i < n; i++) {
      var sp = scene.people[i];
      var rp = person(i);
      var j;
      for (j = 0; j < N; j++) {
        rp.x[j] = mapper.px(sp.x[j]);
        rp.y[j] = mapper.py(sp.y[j]);
        // Reduce motion: alpha is on or off, so there are no fade ramps (hold and hysteresis still apply).
        rp.a[j] = reduce ? (sp.a[j] > 0.5 ? 1 : 0) : sp.a[j];
      }
      rp.pa = reduce ? (sp.pa > 0.5 ? 1 : 0) : sp.pa;
      rp.primary = sp.primary;
      out.people[i] = rp;
    }
    out.people.length = n;
    var t0 = env.now();
    rend.draw(c, out, now);
    govern(env.now() - t0);
    draws++;
  }

  function loop(g, cb) {
    if (!running || g !== gen) return;
    try {
      frame();
    } catch (e) {
      // A failed frame must not end the loop: the next one starts clean.
    }
    if (running && g === gen) env.raf(cb);
  }

  return {
    push: function (people, captureMs, arriveMs, vw, vh) {
      bank.push(people, captureMs, arriveMs, vw, vh);
    },
    setState: function (s) {
      if (!s || s.v !== 1 || !s.palette || typeof s.palette[s.tone] !== 'string') return;
      reduce = !!s.reduceMotion;
      rend.setState(s, env.now());
    },
    setBackend: function (b) {
      backend = b === 'CPU' ? 'CPU' : 'GPU';
      recap();
    },
    setInline: function () {
      inline = true;
      recap();
    },
    start: function () {
      if (running) return;
      running = true;
      var g = ++gen;
      // One callback per chain, reused for every frame of it (nothing is allocated per frame).
      var cb = function () { loop(g, cb); };
      env.raf(cb);
    },
    stop: function () {
      running = false;
      bank.reset();
      var c = getCtx();
      if (!c) return;
      c.setTransform(1, 0, 0, 1, 0, 0);
      rend.clear(c, canvas.width, canvas.height);
    },
    frame: frame,
    stats: function () {
      return { draws: draws, quality: quality, latencyMs: bank.latency() };
    }
  };
}`;

/** The three texts in one expression: evaluate it, then call the result as (env, CFG). */
export const SKELETON_BUNDLE =
  '(function(){var skeletonCore=' +
  SKELETON_CORE +
  ';var skeletonRender=' +
  SKELETON_RENDER +
  ';var skeletonPage=' +
  SKELETON_PAGE +
  ';return function(env,CFG){return skeletonPage(skeletonCore(CFG.tuning),skeletonRender(CFG.render),env,CFG);};})()';

/** The tuning and the look, as plain JSON (a fresh copy every call, safe to serialise into the page). */
export function skeletonConfig(): SkeletonConfig {
  return JSON.parse(
    JSON.stringify({
      tuning: SKELETON_TUNING,
      render: { style: SKELETON_STYLE, edges: SKELETON_BONES },
    }),
  ) as SkeletonConfig;
}

type Factory = (env: SkeletonEnv, cfg: SkeletonConfig) => SkeletonPage;
let factory: Factory | null = null;

/** Builds the page in this JavaScript engine (web and tests). The bundle is evaluated once. */
export function createSkeletonPage(env: SkeletonEnv, cfg: SkeletonConfig = skeletonConfig()): SkeletonPage {
  if (!factory) factory = new Function('return ' + SKELETON_BUNDLE)() as Factory;
  return factory(env, cfg);
}

/**
 * Rebuilds the 33-long, MediaPipe-indexed landmark arrays the page takes from canonical people.
 * Points that were dropped on the way (no canonical name) or are absent come back as [0, 0, 0],
 * visibility 0, so the tracker never shows them.
 */
export function landmarksFromPeople(people: PosePerson[]): [number, number, number][][] {
  const index = new Map<string, number>();
  MEDIAPIPE_POSE_INDEX.forEach((name, i) => {
    if (name) index.set(name, i);
  });
  return people.map((p) => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < 33; i++) out.push([0, 0, 0]);
    for (const k of p.keypoints) {
      const i = index.get(k.name);
      if (i === undefined || !Number.isFinite(k.x) || !Number.isFinite(k.y)) continue;
      out[i] = [k.x, k.y, Number.isFinite(k.confidence) ? Math.min(1, Math.max(0, k.confidence)) : 0];
    }
    return out;
  });
}
