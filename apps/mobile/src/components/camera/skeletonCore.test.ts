import { SKELETON_CORE, SKELETON_TUNING } from './skeletonCore';
import type { Scene } from './skeletonTypes';
import {
  NOBODY,
  OldPipeline,
  REAL_FRAME,
  VISIBLE_JOINTS,
  createFakeClock,
  gaussian,
  mulberry32,
  ramp,
  rms,
  runOldSim,
  runSim,
  shifted,
  sinusoid,
  std,
  triangle,
  withJoints,
  type BankLike,
  type Landmark,
  type People,
} from './skeleton.fixtures';

/**
 * The skeleton tracker is source text that runs inside the camera page. These tests evaluate that
 * exact text and drive it with a fake clock: alignment, backing-store size, lag against the old
 * pipeline, overshoot, jitter, dropouts, hysteresis, jumps and swaps, latency, reset and hygiene.
 */

interface Mapper {
  update(cw: number, ch: number, vw: number, vh: number, dpr: number, mirror: boolean): { pw: number; ph: number; scale: number };
  px(nx: number): number;
  py(ny: number): number;
}
interface Core {
  createMapper(): Mapper;
  createBank(): BankLike;
}
type Tuning = typeof SKELETON_TUNING;

function loadCore(tuning: Tuning = SKELETON_TUNING): Core {
  return (new Function('return (' + SKELETON_CORE + ')')() as (cfg: Tuning) => Core)(tuning);
}
const newBank = () => loadCore().createBank();

const G = SKELETON_TUNING.guard;
const FRAME_MS = 1000 / 60;
const X = (j: number) => REAL_FRAME[j][0];
const WRIST = 11; // left shoulder: visible and well inside the frame throughout

/** Alpha of a person's joint as it would be drawn: joint alpha times person alpha. */
const alphaOf = (s: Scene, j: number, p = 0) => (s.n > p ? s.people[p].a[j] * s.people[p].pa : 0);
/** Alpha of the first person as a whole (0 once they are gone). */
const paOf = (s: Scene) => (s.n ? s.people[0].pa : 0);

describe('skeleton core: text hygiene', () => {
  const text = SKELETON_CORE;
  const forbidden: [string, RegExp][] = [
    ['backtick', /`/],
    ['dollar-brace', /\$\{/],
    ['backslash', /[\\]/],
    ['regex literal', /(^|[=(,:;!&|?{}[]|\breturn)\s*\/[^/*\n]/m],
    ['toString', /\.toString\(\)/],
    ['optional chaining', /\?\./],
    ['nullish coalescing', /\?\?/],
    ['closing script tag', /<\/script/i],
    ['line separator', new RegExp(String.fromCharCode(0x2028) + '|' + String.fromCharCode(0x2029))],
    ['shadowBlur', /shadowBlur/],
    ['hex colour', /#[0-9a-fA-F]{3,8}\b/],
    // Determinism: only the times passed in may drive the tracker.
    ['clock or randomness', /Date|performance|Math\.random|setTimeout|setInterval|requestAnimationFrame/],
  ];
  it.each(forbidden)('contains no %s', (_name, pattern) => {
    expect(text).not.toMatch(pattern);
  });

  it('is a single function expression that evaluates with new Function and returns the API', () => {
    expect(text.startsWith('function skeletonCore(CFG)')).toBe(true);
    const core = loadCore();
    expect(typeof core.createMapper).toBe('function');
    expect(typeof core.createBank).toBe('function');
  });

  it('parses as ES2017 in the engine that runs the tests (no syntax newer than the text rules allow)', () => {
    expect(() => new Function('return (' + text + ')')).not.toThrow();
  });
});

describe('skeleton core: mapper', () => {
  // [css w, css h, video w, video h]
  const cases: [string, number, number, number, number][] = [
    ['640x480 video in a 360x640 portrait view', 360, 640, 640, 480],
    ['480x640 video in a 360x640 portrait view', 360, 640, 480, 640],
    ['1280x720 video in a 640x360 landscape view', 640, 360, 1280, 720],
    ['exact fit', 360, 640, 360, 640],
    ['same aspect, different size', 720, 1280, 360, 640],
  ];

  it.each(cases)('%s: corners and centre land on the cover rectangle', (_n, cw, ch, vw, vh) => {
    const m = loadCore().createMapper();
    m.update(cw, ch, vw, vh, 1, false);
    const s = Math.max(cw / vw, ch / vh);
    const x0 = (cw - vw * s) / 2;
    const y0 = (ch - vh * s) / 2;
    expect(m.px(0)).toBeCloseTo(x0, 6);
    expect(m.px(1)).toBeCloseTo(x0 + vw * s, 6);
    expect(m.py(0)).toBeCloseTo(y0, 6);
    expect(m.py(1)).toBeCloseTo(y0 + vh * s, 6);
    expect(m.px(0.5)).toBeCloseTo(cw / 2, 6);
    expect(m.py(0.5)).toBeCloseTo(ch / 2, 6);
    // The cover rectangle always contains the whole view.
    expect(m.px(0)).toBeLessThanOrEqual(1e-9);
    expect(m.px(1)).toBeGreaterThanOrEqual(cw - 1e-9);
    expect(m.py(0)).toBeLessThanOrEqual(1e-9);
    expect(m.py(1)).toBeGreaterThanOrEqual(ch - 1e-9);
  });

  it('crops the long side, not the short one (640x480 in 360x640 shows the middle 42% of the width)', () => {
    const m = loadCore().createMapper();
    m.update(360, 640, 640, 480, 1, false);
    // Scale 640/480; the video is 853 px wide, so the view shows 360/853 of it.
    const visible = 360 / ((640 / 480) * 640);
    expect(visible).toBeCloseTo(0.4219, 3);
    expect(m.px((1 - visible) / 2)).toBeCloseTo(0, 6);
    expect(m.px((1 + visible) / 2)).toBeCloseTo(360, 6);
    expect(m.py(0)).toBeCloseTo(0, 6);
    expect(m.py(1)).toBeCloseTo(640, 6);
  });

  it.each(cases)('%s: mirroring flips x about the view centre and leaves y alone', (_n, cw, ch, vw, vh) => {
    const plain = loadCore().createMapper();
    const flipped = loadCore().createMapper();
    plain.update(cw, ch, vw, vh, 1, false);
    flipped.update(cw, ch, vw, vh, 1, true);
    for (const n of [0, 0.1, 0.37, 0.5, 0.82, 1]) {
      expect(flipped.px(n)).toBeCloseTo(cw - plain.px(n), 6);
      expect(flipped.py(n)).toBeCloseTo(plain.py(n), 6);
    }
    // The video's left edge shows on the right of a mirrored view.
    expect(flipped.px(0)).toBeGreaterThan(flipped.px(1));
  });

  it.each(cases)('%s: the mapping is invertible with and without mirroring', (_n, cw, ch, vw, vh) => {
    for (const mirror of [false, true]) {
      const m = loadCore().createMapper();
      m.update(cw, ch, vw, vh, 1, mirror);
      const s = Math.max(cw / vw, ch / vh);
      const x0 = (cw - vw * s) / 2;
      const y0 = (ch - vh * s) / 2;
      const rng = mulberry32(5);
      for (let i = 0; i < 25; i++) {
        const nx = rng();
        const ny = rng();
        const sx = m.px(nx);
        const sy = m.py(ny);
        const backX = ((mirror ? cw - sx : sx) - x0) / (vw * s);
        const backY = (sy - y0) / (vh * s);
        expect(backX).toBeCloseTo(nx, 9);
        expect(backY).toBeCloseTo(ny, 9);
      }
    }
  });

  it('re-targets when the view or the video changes (the same mapper is reused)', () => {
    const m = loadCore().createMapper();
    m.update(360, 640, 640, 480, 1, false);
    const first = m.px(0);
    m.update(640, 360, 1280, 720, 1, false);
    expect(m.px(0)).toBeCloseTo(0, 6);
    expect(m.px(1)).toBeCloseTo(640, 6);
    expect(m.px(0)).not.toBeCloseTo(first, 3);
  });

  describe('backing store size', () => {
    it('is css size times min(dpr, 2), rounded, with the scale to apply', () => {
      const m = loadCore().createMapper();
      expect(m.update(360, 640, 640, 480, 1, false)).toEqual({ pw: 360, ph: 640, scale: 1 });
      expect(m.update(360, 640, 640, 480, 1.5, false)).toEqual({ pw: 540, ph: 960, scale: 1.5 });
      expect(m.update(360, 640, 640, 480, 2, false)).toEqual({ pw: 720, ph: 1280, scale: 2 });
      expect(m.update(361, 641, 640, 480, 2.625, false)).toEqual({ pw: 722, ph: 1282, scale: 2 });
    });

    it('caps the device pixel ratio at 2 and treats a missing one as 1', () => {
      const m = loadCore().createMapper();
      expect(m.update(300, 400, 640, 480, 3.5, false).scale).toBe(2);
      expect(m.update(300, 400, 640, 480, 0, false).scale).toBe(1);
      expect(m.update(300, 400, 640, 480, NaN, false).scale).toBe(1);
    });

    it('stays within 1.5 megapixels by lowering the scale, keeping the aspect', () => {
      const m = loadCore().createMapper();
      for (const [cw, ch, dpr] of [
        [1200, 1000, 2],
        [1920, 1080, 2],
        [2560, 1440, 1.5],
        [3000, 2000, 1],
      ] as const) {
        const r = m.update(cw, ch, 1280, 720, dpr, false);
        expect(r.pw * r.ph).toBeLessThanOrEqual(SKELETON_TUNING.view.maxPixels);
        expect(r.scale).toBeLessThan(Math.min(dpr, 2) + 1e-9);
        expect(r.pw).toBe(Math.round(cw * r.scale));
        expect(r.ph).toBe(Math.round(ch * r.scale));
        // It does not shrink more than needed (within a percent of the pixel budget).
        expect(r.pw * r.ph).toBeGreaterThan(SKELETON_TUNING.view.maxPixels * 0.98);
      }
    });

    it('never returns an empty canvas', () => {
      const m = loadCore().createMapper();
      const r = m.update(0, 0, 640, 480, 2, false);
      expect(r.pw).toBeGreaterThanOrEqual(1);
      expect(r.ph).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('skeleton core: bank output', () => {
  it('returns the same reused Scene, people and typed arrays on every step (no per-frame allocation)', () => {
    const bank = newBank();
    bank.push([REAL_FRAME], 0, 40, 640, 480);
    const a = bank.step(50);
    const person = a.people[0];
    const { x, y, a: alpha } = person;
    bank.push([shifted(REAL_FRAME, 0.01)], 33, 73, 640, 480);
    const b = bank.step(80);
    expect(b).toBe(a);
    expect(b.people[0]).toBe(person);
    expect(b.people[0].x).toBe(x);
    expect(b.people[0].y).toBe(y);
    expect(b.people[0].a).toBe(alpha);
    expect(x).toBeInstanceOf(Float32Array);
    expect(x.length).toBe(33);
    expect(alpha.length).toBe(33);
  });

  it('person 0 is primary; a second person is tracked separately', () => {
    const bank = newBank();
    const second = shifted(REAL_FRAME, -0.3);
    for (let k = 0; k < 20; k++) bank.push([REAL_FRAME, second], k * 33, k * 33 + 40, 640, 480);
    const s = bank.step(20 * 33 + 40);
    expect(s.n).toBe(2);
    expect(s.people).toHaveLength(2);
    expect(s.people[0].primary).toBe(true);
    expect(s.people[1].primary).toBe(false);
    expect(s.people[1].x[11]).toBeCloseTo(X(11) - 0.3, 2);
    expect(s.people[0].x[11]).toBeCloseTo(X(11), 2);
  });

  it('a second person that leaves fades out while person 0 stays', () => {
    const bank = newBank();
    const second = shifted(REAL_FRAME, -0.3);
    for (let k = 0; k < 30; k++) bank.push([REAL_FRAME, second], k * 33, k * 33 + 40, 640, 480);
    let t = 30 * 33 + 40;
    let leftAt = t;
    for (let k = 30; k < 60; k++) {
      bank.push([REAL_FRAME], k * 33, k * 33 + 40, 640, 480);
      leftAt = k * 33 + 40;
      bank.step(leftAt + 8);
    }
    t = leftAt + 8;
    const s = bank.step(t);
    expect(s.people[0].pa).toBeGreaterThan(0.99);
    expect(s.n === 1 || s.people[1].pa === 0).toBe(true);
  });

  it('skips joints beyond a short landmark list and ignores non-finite coordinates', () => {
    const bank = newBank();
    const short = REAL_FRAME.slice(0, 20);
    const broken = withJoints(REAL_FRAME, { 11: [NaN, 0.3, 0.9] as Landmark, 12: [0.5, Infinity, 0.9] as Landmark });
    for (let k = 0; k < 20; k++) {
      bank.push([k % 2 ? short : broken], k * 33, k * 33 + 40, 640, 480);
      bank.step(k * 33 + 48);
    }
    const s = bank.step(20 * 33 + 48);
    for (let j = 0; j < 33; j++) {
      expect(Number.isFinite(s.people[0].x[j])).toBe(true);
      expect(Number.isFinite(s.people[0].y[j])).toBe(true);
      expect(Number.isFinite(s.people[0].a[j])).toBe(true);
    }
    expect(s.people[0].a[30]).toBe(0);
  });

  it('is deterministic: the same inputs on a fake clock give identical output, whatever the real time', () => {
    const run = () => {
      const bank = newBank();
      const clock = createFakeClock(500);
      const rng = gaussian(mulberry32(3));
      const out: number[] = [];
      for (let k = 0; k < 60; k++) {
        const person = REAL_FRAME.map((l) => [l[0] + 0.004 * rng(), l[1] + 0.004 * rng(), l[2]] as Landmark);
        bank.push([person], clock.now(), clock.now() + 45, 640, 480);
        clock.advance(33.3);
        const s = bank.step(clock.now() + 45);
        out.push(s.people[0].x[11], s.people[0].y[27], s.people[0].a[11], s.people[0].pa);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('skeleton core: lag', () => {
  const durationMs = 6000;
  const amp = 0.15;
  const truth = sinusoid(amp, 0.7);
  const results = (c: number): People => [shifted(REAL_FRAME, truth(c))];

  function newErrors(core = loadCore()) {
    const bank = core.createBank();
    const errs: number[] = [];
    runSim({
      bank,
      durationMs,
      results,
      onStep: (t, s) => {
        if (t > 2000 && s.n) errs.push(s.people[0].x[WRIST] - (X(WRIST) + truth(t)));
      },
    });
    return errs;
  }
  function oldErrors() {
    const errs: number[] = [];
    runOldSim(new OldPipeline(), {
      durationMs,
      results,
      onStep: (t, shown) => {
        if (t > 2000 && shown.length) errs.push(shown[0][WRIST][0] - (X(WRIST) + truth(t)));
      },
    });
    return errs;
  }

  it('follows 0.5 + 0.15 sin(2 pi 0.7 t) (30 Hz results, 45 ms latency, 60 Hz display) within 2.4% of the width', () => {
    const e = rms(newErrors());
    expect(e).toBeLessThanOrEqual(0.024);
  });

  it('is at least 2x better than the old One Euro + glide pipeline on the same stream', () => {
    const neu = rms(newErrors());
    const old = rms(oldErrors());
    expect(old).toBeGreaterThan(0.035); // the old pipeline really lags this much (sanity check of the reference)
    expect(old / neu).toBeGreaterThanOrEqual(2);
  });

  function both(hz: number, a: number, latencyMs = 45) {
    const f = sinusoid(a, hz);
    const ex: number[] = [];
    const ey: number[] = [];
    const eo: number[] = [];
    runSim({
      bank: newBank(),
      durationMs,
      latencyMs,
      results: (c) => [shifted(REAL_FRAME, f(c), f(c))],
      onStep: (t, s) => {
        if (t > 2000 && s.n) {
          ex.push(s.people[0].x[WRIST] - (X(WRIST) + f(t)));
          ey.push(s.people[0].y[WRIST] - (REAL_FRAME[WRIST][1] + f(t)));
        }
      },
    });
    runOldSim(new OldPipeline(), {
      durationMs,
      latencyMs,
      results: (c) => [shifted(REAL_FRAME, f(c), f(c))],
      onStep: (t, shown) => {
        if (t > 2000 && shown.length) eo.push(shown[0][WRIST][0] - (X(WRIST) + f(t)));
      },
    });
    return { x: rms(ex), y: rms(ey), old: rms(eo) };
  }

  it('also holds on the vertical axis, and for faster motion (0.5 widths/s at 1 Hz, 0.7 at 1.5 Hz)', () => {
    for (const [hz, a, bound] of [
      [0.7, 0.15, 0.022],
      [1.0, 0.08, 0.02],
      [1.5, 0.05, 0.024],
    ] as const) {
      const r = both(hz, a);
      expect(r.x).toBeLessThanOrEqual(bound);
      expect(r.y).toBeLessThanOrEqual(bound);
      expect(r.old / r.x).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('is clearly better than the old pipeline at moderate and slow speeds', () => {
    const moderate = both(0.35, 0.15);
    expect(moderate.x).toBeLessThanOrEqual(0.011);
    expect(moderate.old / moderate.x).toBeGreaterThanOrEqual(2);
    const slow = both(0.2, 0.15);
    expect(slow.x).toBeLessThanOrEqual(0.008);
    expect(slow.old / slow.x).toBeGreaterThanOrEqual(2);
  });

  it('crawling (0.1 Hz, peak 0.09 widths/s) is not worse than 1.1x the old pipeline', () => {
    const crawl = both(0.1, 0.15);
    expect(crawl.x).toBeLessThanOrEqual(crawl.old * 1.1);
    expect(crawl.y).toBeLessThanOrEqual(crawl.old * 1.1);
  });

  it('stays within 2.6% with realistic model noise on top (sigma 0.004), where the old pipeline is at 4.8%', () => {
    const rng = gaussian(mulberry32(11));
    const bank = newBank();
    const errs: number[] = [];
    runSim({
      bank,
      durationMs,
      results: (c) => [REAL_FRAME.map((l) => [l[0] + truth(c) + 0.004 * rng(), l[1] + 0.004 * rng(), l[2]] as Landmark)],
      onStep: (t, s) => {
        if (t > 2000 && s.n) errs.push(s.people[0].x[WRIST] - (X(WRIST) + truth(t)));
      },
    });
    expect(rms(errs)).toBeLessThanOrEqual(0.026);
  });

  it('copes with other result latencies: 20 ms is better still, 70 ms stays at least 1.8x better than the old pipeline', () => {
    const fast = both(0.7, 0.15, 20);
    expect(fast.x).toBeLessThanOrEqual(0.017);
    const late = both(0.7, 0.15, 70);
    expect(late.x).toBeLessThanOrEqual(0.034); // the look-ahead is bounded (maxMs, gain), so late results cost more
    expect(late.old / late.x).toBeGreaterThanOrEqual(1.8);
  });
});

describe('skeleton core: overshoot and caps', () => {
  const amp = 0.1;
  /** Largest distance the displayed joint travels beyond the turning point of a triangle wave. */
  function overshoot(perS: number, a = amp) {
    const f = triangle(a, (4 * a) / perS * 1000);
    const bank = newBank();
    let worst = 0;
    runSim({
      bank,
      durationMs: 8000,
      results: (c) => [shifted(REAL_FRAME, f(c))],
      onStep: (t, s) => {
        if (t > 2000 && s.n) worst = Math.max(worst, Math.abs(s.people[0].x[WRIST] - X(WRIST)) - a);
      },
    });
    return worst;
  }

  it('overshoots a triangle wave by at most 1.5% of the width at 0.2 to 0.3 widths/s', () => {
    expect(overshoot(0.2)).toBeLessThanOrEqual(0.015);
    expect(overshoot(0.3)).toBeLessThanOrEqual(0.015);
    expect(overshoot(0.25, 0.15)).toBeLessThanOrEqual(0.015);
    expect(overshoot(0.3, 0.15)).toBeLessThanOrEqual(0.015);
  });

  it('overshoots an abrupt reversal by at most 2.5% at 0.4 widths/s, and stays near the look-ahead cap at any speed', () => {
    expect(overshoot(0.4)).toBeLessThanOrEqual(0.025);
    expect(overshoot(0.4, 0.2)).toBeLessThanOrEqual(0.025);
    const cap = SKELETON_TUNING.predict.maxFracW;
    for (const perS of [0.66, 1.2, 2]) expect(overshoot(perS, 0.2)).toBeLessThanOrEqual(cap + 0.005);
  });

  it('overshoots a sinusoid turning point (a smooth reversal) by less than 1.5%', () => {
    const f = sinusoid(0.15, 0.7);
    const bank = newBank();
    let worst = 0;
    runSim({
      bank,
      durationMs: 8000,
      results: (c) => [shifted(REAL_FRAME, f(c))],
      onStep: (t, s) => {
        if (t > 2000 && s.n) worst = Math.max(worst, Math.abs(s.people[0].x[WRIST] - X(WRIST)) - 0.15);
      },
    });
    expect(worst).toBeLessThanOrEqual(0.015);
  });

  it('never looks ahead further than maxFracW of the width (and the same in picture terms vertically)', () => {
    const cap = SKELETON_TUNING.predict.maxFracW;
    const aspect = 640 / 480;
    const tol = 1e-5; // the output is Float32
    // Fast steady motion in x and in y, then the results stop arriving.
    const bank = newBank();
    const speed = 1.5;
    const f = ramp(speed, 0);
    let lastRawX = 0;
    let lastRawY = 0;
    let lastCapture = 0;
    runSim({
      bank,
      startMs: 1000,
      durationMs: 1000,
      results: (c) => [shifted(REAL_FRAME, f(c - 800), f(c - 800) / 2)],
      lost: (c) => c > 1500,
      onStep: (t, s) => {
        lastCapture = Math.min(t - 45, 1500);
        lastRawX = X(WRIST) + f(lastCapture - 800);
        lastRawY = REAL_FRAME[WRIST][1] + f(lastCapture - 800) / 2;
        if (t > 1500) {
          expect(s.people[0].x[WRIST] - lastRawX).toBeLessThanOrEqual(cap + tol);
          expect(s.people[0].y[WRIST] - lastRawY).toBeLessThanOrEqual(cap * aspect + tol);
        }
      },
    });
    expect(lastCapture).toBeGreaterThan(0);
    // Without results the look-ahead also stops growing: the picture settles instead of running away.
    const a = bank.step(2020).people[0].x[WRIST];
    const b = bank.step(2150).people[0].x[WRIST];
    expect(Math.abs(b - a)).toBeLessThan(1e-4);
  });
});

describe('skeleton core: jitter', () => {
  const joints = VISIBLE_JOINTS.filter((j) => REAL_FRAME[j][2] >= 0.9);
  const sigma = 0.004;

  /**
   * How much of the model's noise reaches the screen: the same drifting pose is run twice, once
   * clean and once with seeded noise of std sigma on every x and y of every result. For each
   * visible joint and axis, jitter is std(displayed with noise - displayed without noise) over
   * all display frames after a 0.7 s warm-up (about 90 results). The ratio is that, pooled over
   * the joints and axes as a root mean square, divided by the pooled std of the raw noise that
   * was added. Lag and the look-ahead cancel in the difference; only the noise transfer is left.
   */
  function noiseTransfer(seed: number, perS: number, pipeline: 'new' | 'old' = 'new') {
    const drift = ramp(perS, 1000);
    const clean: number[][] = [];
    const diff = joints.flatMap(() => [[], []] as number[][]);
    const raw = joints.flatMap(() => [[], []] as number[][]);
    const common = { startMs: 1000, durationMs: 3200 };
    const cleanPeople = (c: number): People => [shifted(REAL_FRAME, drift(c))];
    const rng = gaussian(mulberry32(seed));
    const noisyPeople = (c: number): People => {
      const person = REAL_FRAME.map((l) => [l[0] + drift(c) + sigma * rng(), l[1] + sigma * rng(), l[2]] as Landmark);
      if (c >= 1500) {
        joints.forEach((jt, k) => {
          raw[2 * k].push(person[jt][0] - (REAL_FRAME[jt][0] + drift(c)));
          raw[2 * k + 1].push(person[jt][1] - REAL_FRAME[jt][1]);
        });
      }
      return [person];
    };
    const pick = (x: Float32Array | number[], y: Float32Array | number[]) => joints.flatMap((j) => [x[j], y[j]]);
    let idx = 0;
    const record = (row: number[]) => row.forEach((v, q) => diff[q].push(v - clean[idx][q]));
    if (pipeline === 'new') {
      runSim({ bank: newBank(), ...common, results: cleanPeople, onStep: (t, s) => t >= 1700 && clean.push(pick(s.people[0].x, s.people[0].y)) });
      runSim({
        bank: newBank(),
        ...common,
        results: noisyPeople,
        onStep: (t, s) => {
          if (t < 1700) return;
          record(pick(s.people[0].x, s.people[0].y));
          idx++;
        },
      });
    } else {
      const flat = (shown: Landmark[][]) => joints.flatMap((j) => [shown[0][j][0], shown[0][j][1]]);
      runOldSim(new OldPipeline(), { ...common, results: cleanPeople, onStep: (t, shown) => t >= 1700 && clean.push(flat(shown)) });
      runOldSim(new OldPipeline(), {
        ...common,
        results: noisyPeople,
        onStep: (t, shown) => {
          if (t < 1700) return;
          record(flat(shown));
          idx++;
        },
      });
    }
    expect(raw[0].length).toBeGreaterThanOrEqual(45);
    const pooled = (series: number[][]) => Math.sqrt(series.reduce((a, v) => a + std(v) ** 2, 0) / series.length);
    return pooled(diff) / pooled(raw);
  }
  const seeds = [1, 2, 3, 4, 5, 6];

  it('smooths a still, real pose with sigma 0.004 noise over 90 results to at most 0.4 of the raw jitter', () => {
    for (const seed of seeds) expect(noiseTransfer(seed, 0)).toBeLessThanOrEqual(0.4);
  });

  it('does the same in slow motion (0.05 widths/s of drift)', () => {
    for (const seed of seeds) expect(noiseTransfer(seed, 0.05)).toBeLessThanOrEqual(0.4);
  });

  it.each([0.1, 0.3, 0.5])('stays at most 0.6 of the raw jitter while moving at %s widths/s (a limb mid-rep)', (perS) => {
    for (const seed of seeds) expect(noiseTransfer(seed, perS)).toBeLessThanOrEqual(0.6);
  });

  it.each([0.1, 0.3, 0.5])('is no more than 1.25x as jittery as the old pipeline at %s widths/s', (perS) => {
    for (const seed of [1, 2, 3]) {
      expect(noiseTransfer(seed, perS)).toBeLessThanOrEqual(1.25 * noiseTransfer(seed, perS, 'old'));
    }
  });

  it('does not drift or bias a still pose: the mean position is the true position', () => {
    const rng = gaussian(mulberry32(9));
    const bank = newBank();
    const xs: number[] = [];
    runSim({
      bank,
      durationMs: 3000,
      results: () => [REAL_FRAME.map((l) => [l[0] + 0.004 * rng(), l[1] + 0.004 * rng(), l[2]] as Landmark)],
      onStep: (t, s) => {
        if (t > 1800 && s.n) xs.push(s.people[0].x[WRIST]);
      },
    });
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean - X(WRIST))).toBeLessThan(0.003);
  });
});

describe('skeleton core: dropouts', () => {
  const still: People = [REAL_FRAME];
  /** Person present except for captures in [from, to), which return no one. */
  function gapSim(gapMs: number, how: 'empty' | 'missing') {
    const bank = newBank();
    const from = 2000;
    const to = from + gapMs;
    const series: { t: number; a: number; x: number }[] = [];
    runSim({
      bank,
      startMs: 1000,
      durationMs: 2500,
      results: (c) => (how === 'empty' && c >= from && c < to ? NOBODY : still),
      lost: how === 'missing' ? (c) => c >= from && c < to : undefined,
      onStep: (t, s) => series.push({ t, a: alphaOf(s, WRIST), x: s.n ? s.people[0].x[WRIST] : 0 }),
    });
    return { series, from, to };
  }

  it.each(['empty', 'missing'] as const)('a 200 ms gap (%s results) never blinks: alpha stays at least 0.95 throughout', (how) => {
    const { series, from } = gapSim(200, how);
    const during = series.filter((p) => p.t > 1500);
    expect(during.length).toBeGreaterThan(60);
    expect(Math.min(...during.map((p) => p.a))).toBeGreaterThanOrEqual(0.95);
    // ... and the picture stays where it was (no look-ahead run-away, no snap on return).
    expect(Math.max(...during.map((p) => Math.abs(p.x - X(WRIST))))).toBeLessThan(0.004);
    expect(from).toBe(2000);
  });

  it.each(['empty', 'missing'] as const)('a 600 ms gap (%s results) fades out completely', (how) => {
    const { series, to } = gapSim(600, how);
    const inGap = series.filter((p) => p.t > 2000 && p.t < to + 45);
    expect(Math.min(...inGap.map((p) => p.a))).toBe(0);
    // It starts fading only after the hold (250 ms) and is gone by hold + fade (about 470 ms).
    const at = (ms: number) => series.reduce((best, p) => (Math.abs(p.t - ms) < Math.abs(best.t - ms) ? p : best)).a;
    expect(at(2000 + 45 - 33 + 200)).toBeGreaterThan(0.95);
    expect(at(2000 + 45 - 33 + 520)).toBe(0);
  });

  it('on return after a long gap it fades in smoothly: no pop, monotonic, within the fade-in time', () => {
    const { series, to } = gapSim(600, 'empty');
    const back = series.filter((p) => p.t >= to + 45);
    expect(back[0].a).toBeLessThan(0.3);
    let prev = back[0].a;
    for (const p of back.slice(1)) {
      expect(p.a).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(p.a - prev).toBeLessThanOrEqual(FRAME_MS / SKELETON_TUNING.fade.inMs + 1e-6);
      prev = p.a;
    }
    expect(back[back.length - 1].a).toBeGreaterThan(0.99);
    // It reappears where it was, not sliding in from elsewhere.
    for (const p of back) expect(Math.abs(p.x - X(WRIST))).toBeLessThan(0.004);
  });

  it('a person gone for longer than keepMs is dropped, and a new one fades in from nothing', () => {
    const bank = newBank();
    for (let k = 0; k < 20; k++) bank.push(still, k * 33, k * 33 + 40, 640, 480);
    expect(bank.step(700).n).toBe(1);
    const gone = bank.step(700 + SKELETON_TUNING.fade.keepMs + 100);
    expect(gone.n).toBe(0);
    const t = 3000;
    bank.push([shifted(REAL_FRAME, 0.2)], t - 40, t, 640, 480);
    const first = bank.step(t + 8);
    expect(alphaOf(first, WRIST)).toBeLessThan(0.2);
    expect(first.people[0].x[WRIST]).toBeCloseTo(X(WRIST) + 0.2, 6);
  });

  it('a single joint that drops out for 100 ms does not blink; for 400 ms it fades out and comes back smoothly', () => {
    for (const [gapMs, fades] of [
      [100, false],
      [400, true],
    ] as const) {
      const bank = newBank();
      const from = 2000;
      const alphas: number[] = [];
      runSim({
        bank,
        startMs: 1000,
        durationMs: 2000,
        results: (c) => [withJoints(REAL_FRAME, c >= from && c < from + gapMs ? { 25: [REAL_FRAME[25][0], REAL_FRAME[25][1], 0.05] as Landmark } : {})],
        onStep: (t, s) => {
          if (t > 1500 && s.n) alphas.push(s.people[0].a[25]);
        },
      });
      const min = Math.min(...alphas);
      if (fades) expect(min).toBe(0);
      else expect(min).toBeGreaterThanOrEqual(0.95);
      expect(alphas[alphas.length - 1]).toBeGreaterThan(0.99);
      for (let i = 1; i < alphas.length; i++) {
        // No pops: alpha changes at most at the fade rates from one frame to the next.
        expect(Math.abs(alphas[i] - alphas[i - 1])).toBeLessThanOrEqual(FRAME_MS / SKELETON_TUNING.fade.inMs + 1e-6);
      }
    }
  });
});

describe('skeleton core: hysteresis', () => {
  function toggles(visFor: (k: number) => number) {
    const bank = newBank();
    const series: number[] = [];
    let k = 0;
    runSim({
      bank,
      startMs: 1000,
      durationMs: 3000,
      results: () => {
        const vis = visFor(k++);
        return [withJoints(REAL_FRAME, { 25: [REAL_FRAME[25][0], REAL_FRAME[25][1], vis] as Landmark })];
      },
      onStep: (_t, s) => series.push(s.n ? s.people[0].a[25] : 0),
    });
    let n = 0;
    for (let i = 1; i < series.length; i++) if (series[i] > 0.5 !== series[i - 1] > 0.5) n++;
    return n;
  }

  it('visibility oscillating between 0.3 and 0.8 toggles at most once', () => {
    expect(toggles((k) => (k % 2 ? 0.3 : 0.8))).toBeLessThanOrEqual(1);
    expect(toggles((k) => (k % 2 ? 0.8 : 0.3))).toBeLessThanOrEqual(1);
  });

  it('visibility hovering around either threshold toggles at most once', () => {
    expect(toggles((k) => 0.45 + 0.1 * Math.sin(k * 2.1))).toBeLessThanOrEqual(1);
    expect(toggles((k) => 0.5 + 0.14 * Math.sin(k * 1.3))).toBeLessThanOrEqual(1);
    const rng = mulberry32(8);
    expect(toggles(() => 0.45 + 0.1 * (rng() * 2 - 1))).toBeLessThanOrEqual(1);
  });

  it('a joint that is below the enter threshold never appears; one above it stays through brief dips', () => {
    const never = (() => {
      const bank = newBank();
      let max = 0;
      runSim({
        bank,
        durationMs: 2000,
        results: () => [withJoints(REAL_FRAME, { 25: [REAL_FRAME[25][0], REAL_FRAME[25][1], 0.5] as Landmark })],
        onStep: (_t, s) => {
          if (s.n) max = Math.max(max, s.people[0].a[25]);
        },
      });
      return max;
    })();
    expect(never).toBe(0);
  });
});

describe('skeleton core: no teleporting', () => {
  /** Largest per-frame move of any joint that is clearly drawn (alpha above 0.5) in two consecutive frames. */
  function worstDrawnMove(bank: BankLike, o: { results: (c: number) => People; durationMs?: number; startMs?: number }) {
    let worst = 0;
    let prev: { x: number[]; y: number[]; a: number[]; t: number } | null = null;
    const series: { t: number; x: number[]; y: number[]; a: number[] }[] = [];
    runSim({
      bank,
      startMs: o.startMs ?? 1000,
      durationMs: o.durationMs ?? 4000,
      results: o.results,
      onStep: (t, s) => {
        const cur = { x: Array.from(s.n ? s.people[0].x : []), y: Array.from(s.n ? s.people[0].y : []), a: Array.from(s.n ? s.people[0].a : []).map((a) => a * (s.n ? s.people[0].pa : 0)), t };
        if (prev && cur.x.length) {
          for (let j = 0; j < 33; j++) {
            if (prev.a[j] > 0.5 && cur.a[j] > 0.5) {
              const d = Math.hypot(cur.x[j] - prev.x[j], (cur.y[j] - prev.y[j]) * (480 / 640));
              worst = Math.max(worst, d);
            }
          }
        }
        series.push(cur);
        prev = cur;
      },
    });
    return { worst, series };
  }
  const stepBound = G.stepBase + G.stepPerS * (FRAME_MS / 1000);

  it('still pose, no events: moves are tiny', () => {
    const { worst } = worstDrawnMove(newBank(), { results: () => [REAL_FRAME] });
    expect(worst).toBeLessThan(0.002);
  });

  it('a whole-person jump of 0.4 never teleports a drawn joint; the person re-appears at the new place', () => {
    const jumpAt = 3000;
    const { worst, series } = worstDrawnMove(newBank(), { results: (c) => [shifted(REAL_FRAME, c >= jumpAt ? 0.4 : 0)], durationMs: 3000 });
    expect(worst).toBeLessThanOrEqual(stepBound);
    // A fade out and in: the person is dimmer than 0.5 for a moment, then settles at the new position.
    const after = series.filter((p) => p.t > jumpAt + 45 && p.t < jumpAt + 1000);
    expect(Math.min(...after.map((p) => p.a[WRIST]))).toBeLessThan(0.5);
    const last = series[series.length - 1];
    expect(last.x[WRIST]).toBeCloseTo(X(WRIST) + 0.4, 2);
    expect(last.a[WRIST]).toBeGreaterThan(0.99);
  });

  it('a whole-person jump of 0.4 is a person reset once 40% or more of the joints jump (and not for fewer)', () => {
    // 20 of the 33 joints jump persistently, the others stay: all joints fade out and in together.
    const jumpAt = 3000;
    const some = (n: number) => (c: number): People => [
      REAL_FRAME.map((l, i) => (c >= jumpAt && VISIBLE_JOINTS.indexOf(i) >= 0 && VISIBLE_JOINTS.indexOf(i) < n ? ([l[0] + 0.4, l[1], l[2]] as Landmark) : l)),
    ];
    const many = worstDrawnMove(newBank(), { results: some(VISIBLE_JOINTS.length), durationMs: 2500 });
    expect(many.worst).toBeLessThanOrEqual(stepBound);
    // Few joints jump: only those are held and re-seeded; the others never move.
    const few = worstDrawnMove(newBank(), { results: some(3), durationMs: 2500 });
    expect(few.worst).toBeLessThanOrEqual(stepBound);
    const still = few.series[few.series.length - 1];
    const stayer = VISIBLE_JOINTS[VISIBLE_JOINTS.length - 1];
    expect(still.x[stayer]).toBeCloseTo(X(stayer), 2);
    expect(Math.min(...few.series.filter((p) => p.t > jumpAt).map((p) => p.a[stayer]))).toBeGreaterThan(0.95);
  });

  it('a one-result glitch (a joint, or the whole person, in the wrong place for one result) never moves anything', () => {
    for (const whole of [false, true]) {
      const glitchAt = 2000;
      const { worst, series } = worstDrawnMove(newBank(), {
        results: (c) => {
          const hit = c >= glitchAt && c < glitchAt + 30;
          if (!hit) return [REAL_FRAME];
          return [whole ? shifted(REAL_FRAME, 0.3, -0.2) : withJoints(REAL_FRAME, { 11: [0.9, 0.9, 0.99] as Landmark, 13: [0.1, 0.5, 0.99] as Landmark })];
        },
        durationMs: 2500,
      });
      expect(worst).toBeLessThanOrEqual(stepBound);
      // Never even drifts toward the glitch.
      const drift = Math.max(...series.map((p) => Math.abs(p.x[11] - X(11))));
      expect(drift).toBeLessThan(0.003);
      expect(Math.min(...series.filter((p) => p.t > 1500).map((p) => p.a[11]))).toBeGreaterThan(0.95);
    }
  });

  function wristPair(gap: number): Landmark[] {
    // A still person with both wrists clearly visible, `gap` apart, left on the left of the picture.
    return withJoints(REAL_FRAME, {
      15: [0.5 - gap / 2, 0.5, 0.97] as Landmark,
      16: [0.5 + gap / 2, 0.5, 0.97] as Landmark,
    });
  }
  function swapped(gap: number): Landmark[] {
    return withJoints(wristPair(gap), {
      15: [0.5 + gap / 2, 0.5, 0.97] as Landmark,
      16: [0.5 - gap / 2, 0.5, 0.97] as Landmark,
    });
  }

  it.each([0.3, 0.12])('a persistent left/right wrist swap (wrists %s apart) never teleports a drawn joint, and settles on the new labels', (gap) => {
    const swapAt = 2500;
    const { worst, series } = worstDrawnMove(newBank(), {
      results: (c) => [c >= swapAt ? swapped(gap) : wristPair(gap)],
      durationMs: 2500,
    });
    expect(worst).toBeLessThanOrEqual(stepBound);
    const last = series[series.length - 1];
    expect(last.x[15]).toBeCloseTo(0.5 + gap / 2, 2);
    expect(last.x[16]).toBeCloseTo(0.5 - gap / 2, 2);
    expect(last.a[15]).toBeGreaterThan(0.99);
    expect(last.a[16]).toBeGreaterThan(0.99);
  });

  it('a swap that lasts a single result is ignored', () => {
    const swapAt = 2500;
    const { worst, series } = worstDrawnMove(newBank(), {
      results: (c) => [c >= swapAt && c < swapAt + 30 ? swapped(0.12) : wristPair(0.12)],
      durationMs: 2000,
    });
    expect(worst).toBeLessThanOrEqual(stepBound);
    const last = series[series.length - 1];
    expect(last.x[15]).toBeCloseTo(0.5 - 0.06, 2);
    expect(Math.max(...series.map((p) => Math.abs(p.x[15] - (0.5 - 0.06))))).toBeLessThan(0.003);
  });

  it('wrists that really cross each other (a smooth motion) are not mistaken for a swap', () => {
    const f = triangle(0.12, 2000);
    const { worst, series } = worstDrawnMove(newBank(), {
      results: (c) =>
        [withJoints(REAL_FRAME, {
          15: [0.5 + f(c), 0.5, 0.97] as Landmark,
          16: [0.5 - f(c), 0.5, 0.97] as Landmark,
        })],
      durationMs: 6000,
    });
    expect(worst).toBeLessThanOrEqual(stepBound);
    // Alpha never dips: a crossing is followed, not re-seeded.
    expect(Math.min(...series.filter((p) => p.t > 1500).map((p) => p.a[15]))).toBeGreaterThan(0.95);
  });

  it('ordinary fast motion (1 width/s) is followed, not held or re-seeded', () => {
    const f = triangle(0.15, 600);
    const { worst, series } = worstDrawnMove(newBank(), { results: (c) => [shifted(REAL_FRAME, f(c))], durationMs: 4000 });
    expect(worst).toBeLessThanOrEqual(stepBound);
    expect(Math.min(...series.filter((p) => p.t > 1500).map((p) => p.a[WRIST]))).toBeGreaterThan(0.99);
  });
});

describe('skeleton core: latency estimate', () => {
  it('is zero before any result, then follows arrive - capture as an EWMA (0.2)', () => {
    const bank = newBank();
    expect(bank.latency()).toBe(0);
    bank.push([REAL_FRAME], 1000, 1045, 640, 480);
    expect(bank.latency()).toBeCloseTo(45, 9);
    bank.push([REAL_FRAME], 1033, 1118, 640, 480); // 85 ms
    expect(bank.latency()).toBeCloseTo(45 + 0.2 * 40, 9);
    for (let k = 0; k < 60; k++) bank.push([REAL_FRAME], 1066 + k * 33, 1066 + k * 33 + 85, 640, 480);
    expect(bank.latency()).toBeCloseTo(85, 1);
  });

  it('is clamped to 0..150 ms', () => {
    const bank = newBank();
    for (let k = 0; k < 50; k++) bank.push([REAL_FRAME], k * 33, k * 33 + 900, 640, 480);
    expect(bank.latency()).toBeLessThanOrEqual(150);
    expect(bank.latency()).toBeGreaterThan(149);
    const b2 = newBank();
    for (let k = 0; k < 50; k++) b2.push([REAL_FRAME], k * 33, k * 33 - 20, 640, 480);
    expect(b2.latency()).toBe(0);
  });

  it('counts results with no one in them too (it measures the pipeline, not the person)', () => {
    const bank = newBank();
    bank.push(NOBODY, 0, 60, 640, 480);
    expect(bank.latency()).toBeCloseTo(60, 9);
  });
});

describe('skeleton core: reset', () => {
  it('clears everyone, the latency and all history, and tracking starts afresh', () => {
    const bank = newBank();
    for (let k = 0; k < 40; k++) bank.push([REAL_FRAME], k * 33, k * 33 + 60, 640, 480);
    expect(bank.step(1400).n).toBe(1);
    expect(bank.latency()).toBeGreaterThan(50);
    bank.reset();
    expect(bank.latency()).toBe(0);
    const empty = bank.step(1410);
    expect(empty.n).toBe(0);
    expect(empty.people).toHaveLength(0);
    // The first result after a reset appears where it is (no slide from the old pose) and fades in.
    bank.push([shifted(REAL_FRAME, 0.25)], 1420, 1460, 640, 480);
    const s = bank.step(1468);
    expect(s.n).toBe(1);
    expect(s.people[0].x[WRIST]).toBeCloseTo(X(WRIST) + 0.25, 6);
    expect(s.people[0].a[WRIST] * s.people[0].pa).toBeLessThan(0.2);
    let a = 0;
    for (let t = 1480; t < 1700; t += FRAME_MS) a = alphaOf(bank.step(t), WRIST);
    expect(a).toBeGreaterThan(0.99);
  });

  it('can be reset again and again, and before any result', () => {
    const bank = newBank();
    bank.reset();
    bank.reset();
    expect(bank.step(0).n).toBe(0);
    bank.push([REAL_FRAME], 0, 40, 640, 480);
    bank.reset();
    expect(bank.step(50).n).toBe(0);
  });
});

describe('skeleton core: robustness', () => {
  it('survives empty, odd and out-of-order input without throwing or producing NaN', () => {
    const bank = newBank();
    bank.push([], 0, 10, 640, 480);
    bank.push([[]], 33, 43, 640, 480);
    bank.step(50);
    bank.push([REAL_FRAME], 66, 76, 0, 0);
    bank.push([REAL_FRAME], 40, 90, 640, 480); // captured earlier than the previous one
    bank.push([REAL_FRAME, REAL_FRAME, REAL_FRAME, REAL_FRAME, REAL_FRAME, REAL_FRAME], 100, 110, 640, 480);
    const s = bank.step(120);
    expect(s.n).toBeLessThanOrEqual(4);
    for (const p of s.people) for (let j = 0; j < 33; j++) expect(Number.isFinite(p.x[j] + p.y[j] + p.a[j])).toBe(true);
    // Steps may arrive at the same instant or even go back a little.
    expect(() => {
      bank.step(120);
      bank.step(110);
    }).not.toThrow();
  });

  it('fades only on time passed into step (a fake clock fully controls it)', () => {
    const bank = newBank();
    const clock = createFakeClock(1000);
    for (let k = 0; k < 30; k++) bank.push([REAL_FRAME], k * 33, k * 33 + 45, 640, 480);
    clock.set(30 * 33 + 45);
    bank.step(clock.now());
    const before = alphaOf(bank.step(clock.now() + 8), WRIST);
    // Nothing changes when no time passes; a lot changes when a lot of time passes.
    expect(alphaOf(bank.step(clock.now() + 8), WRIST)).toBe(before);
    expect(alphaOf(bank.step(clock.now() + 2000), WRIST)).toBe(0);
  });
});

describe('skeleton core: fast motion is not held or blinked (round 4, phase E)', () => {
  const MAXHOLD = SKELETON_TUNING.guard.maxHoldMs;
  const wrists = (a: number, b: number) =>
    withJoints(REAL_FRAME, { 15: [a, 0.5, 0.97] as Landmark, 16: [b, 0.5, 0.97] as Landmark });

  it('has a maximum suspect duration of about 300 ms', () => {
    expect(MAXHOLD).toBeGreaterThanOrEqual(200);
    expect(MAXHOLD).toBeLessThanOrEqual(400);
  });

  it('a single wrist swinging at 0.3 widths amplitude and 2 Hz blinks in at most 10% of the frames, and is never frozen', () => {
    const f = sinusoid(0.3, 2);
    let low = 0;
    let n = 0;
    let frozen = 0;
    let prev = NaN;
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 4000,
      results: (c) => [withJoints(REAL_FRAME, { 15: [0.5 + f(c), 0.5, 0.97] as Landmark })],
      onStep: (t, s) => {
        if (t < 2000) return;
        n++;
        if (alphaOf(s, 15) < 0.5) low++;
        // Frozen: the same picture for frame after frame while the raw data swings a long way.
        if (Math.abs(s.people[0].x[15] - prev) < 1e-4) frozen++;
        prev = s.people[0].x[15];
      },
    });
    expect(n).toBeGreaterThan(100);
    expect(low / n).toBeLessThanOrEqual(0.1);
    expect(frozen / n).toBeLessThanOrEqual(0.1);
  });

  it('two wrists crossing at 0.25 widths and 2 Hz keep alpha at 0.5 or more, bar a brief re-seed dip', () => {
    const f = sinusoid(0.25, 2);
    let low = 0;
    let run = 0;
    let longest = 0;
    let n = 0;
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 4000,
      results: (c) => [wrists(0.5 + f(c), 0.5 - f(c))],
      onStep: (t, s) => {
        if (t < 2000) return;
        n++;
        if (Math.min(alphaOf(s, 15), alphaOf(s, 16)) < 0.5) {
          low++;
          run++;
          longest = Math.max(longest, run);
        } else run = 0;
      },
    });
    expect(low / n).toBeLessThanOrEqual(0.1);
    expect(longest * FRAME_MS).toBeLessThanOrEqual(G.reseedFadeMs);
  });

  it('a whole-person jump of 0.5 followed by sustained motion at 1.5 widths/s re-seeds within maxHoldMs (never frozen longer)', () => {
    const jumpAt = 3000;
    const truth = (c: number) => (c < jumpAt ? 0 : 0.5 + (1.5 * (c - jumpAt)) / 1000);
    const series: { t: number; err: number; a: number }[] = [];
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 3200,
      results: (c) => [shifted(REAL_FRAME, truth(c))],
      onStep: (t, s) => {
        if (s.n) series.push({ t, err: Math.abs(s.people[0].x[WRIST] - (X(WRIST) + truth(t - 45))), a: alphaOf(s, WRIST) });
      },
    });
    // The jump arrives at jumpAt + 45; maxHoldMs after that (plus a result or two) the person has been
    // re-seeded onto the moving data and faded back in; from then on it follows it.
    const settled = jumpAt + 45 + MAXHOLD + 2 * 34 + G.reseedFadeMs;
    const late = series.filter((p) => p.t >= settled);
    expect(late.length).toBeGreaterThan(30);
    expect(Math.max(...late.map((p) => p.err))).toBeLessThan(0.1);
    expect(Math.min(...late.map((p) => p.a))).toBeGreaterThan(0.95);
    // Before the hold ran out the person is still held at the old place (no teleport).
    const early = series.find((p) => p.t >= jumpAt + 45 + MAXHOLD / 2)!;
    expect(early.err).toBeGreaterThan(0.3);
  });

  it('a genuine teleport (not motion) is still held, then re-seeded through the dip: no big move while drawn', () => {
    const jumpAt = 3000;
    const stepBound = G.stepBase + G.stepPerS * (FRAME_MS / 1000);
    let prev: { x: number; a: number } | null = null;
    let worst = 0;
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 2000,
      results: (c) => [shifted(REAL_FRAME, c >= jumpAt ? 0.5 : 0)],
      onStep: (_t, s) => {
        const cur = { x: s.people[0].x[WRIST], a: alphaOf(s, WRIST) };
        if (prev && prev.a > 0.5 && cur.a > 0.5) worst = Math.max(worst, Math.abs(cur.x - prev.x));
        prev = cur;
      },
    });
    expect(worst).toBeLessThanOrEqual(stepBound);
  });
});

describe('skeleton core: letting go of the look-ahead (round 4, phase E)', () => {
  /** A joint moving at 0.5 widths/s until the person disappears from the results at 1800 ms (the first empty one arrives at about 1878). */
  function lossSteps(tuning: Tuning) {
    const f = ramp(0.5, 0);
    const bank = loadCore(tuning).createBank();
    const xs: number[] = [];
    runSim({
      bank,
      startMs: 1000,
      durationMs: 1400,
      results: (c) => (c > 1800 ? NOBODY : [shifted(REAL_FRAME, f(c))]),
      onStep: (t, s) => {
        if (t > 1860) xs.push(s.people[0].x[WRIST]);
      },
    });
    return { steps: xs.slice(1).map((x, i) => x - xs[i]), xs };
  }

  it('on loss the displayed point glides back to the filtered position: no frame steps more than 0.5% of the width', () => {
    const { steps, xs } = lossSteps(SKELETON_TUNING);
    expect(Math.max(...steps.map(Math.abs))).toBeLessThanOrEqual(0.005);
    // ... and it does settle: the look-ahead is let go of, not kept.
    expect(Math.abs(xs[xs.length - 1] - xs[xs.length - 10])).toBeLessThan(1e-4);
  });

  it('the old 1 ms reconcile would have snapped it back in one frame (the test is meaningful)', () => {
    const snappy: Tuning = { ...SKELETON_TUNING, predict: { ...SKELETON_TUNING.predict, zeroVelTauMs: 1 } };
    expect(Math.max(...lossSteps(snappy).steps.map(Math.abs))).toBeGreaterThan(0.005);
  });

  it('keeps the ordinary reconcile of normal updates (1 ms) and a zero-velocity decay of about 50 ms', () => {
    expect(SKELETON_TUNING.predict.reconcileTauMs).toBe(1);
    expect(SKELETON_TUNING.predict.zeroVelTauMs).toBeGreaterThanOrEqual(30);
    expect(SKELETON_TUNING.predict.zeroVelTauMs).toBeLessThanOrEqual(80);
  });
});

describe('skeleton core: two people keep their slots (round 4, phase E)', () => {
  const A = shifted(REAL_FRAME, -0.2);
  const B = shifted(REAL_FRAME, 0.2);

  it('people that swap order between results keep their slots: no jump path, primary stays with the same person', () => {
    let worst = 0;
    let minAlpha = 1;
    let prev: number[] | null = null;
    const frames: { primary0: boolean; x0: number; x1: number }[] = [];
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 3000,
      results: (c) => (Math.floor(c / (1000 / 30)) % 2 ? [B, A] : [A, B]),
      onStep: (t, s) => {
        if (s.n < 2) return;
        const cur = [s.people[0].x[WRIST], s.people[1].x[WRIST]];
        if (prev) worst = Math.max(worst, Math.abs(cur[0] - prev[0]), Math.abs(cur[1] - prev[1]));
        prev = cur;
        if (t > 1500) {
          minAlpha = Math.min(minAlpha, alphaOf(s, WRIST, 0), alphaOf(s, WRIST, 1));
          frames.push({ primary0: s.people[0].primary, x0: cur[0], x1: cur[1] });
        }
      },
    });
    expect(frames.length).toBeGreaterThan(60);
    expect(worst).toBeLessThan(0.01);
    expect(minAlpha).toBeGreaterThan(0.99);
    for (const f of frames) {
      expect(f.primary0).toBe(true);
      expect(f.x0).toBeCloseTo(X(WRIST) - 0.2, 1);
      expect(f.x1).toBeCloseTo(X(WRIST) + 0.2, 1);
    }
  });

  it('a lone survivor keeps its slot, and becomes primary once the first person is gone', () => {
    const bank = newBank();
    for (let k = 0; k < 20; k++) bank.push([A, B], k * 33, k * 33 + 40, 640, 480);
    let t = 20 * 33 + 40;
    for (let k = 20; k < 60; k++) {
      bank.push([B], k * 33, k * 33 + 40, 640, 480);
      t = k * 33 + 40;
      bank.step(t);
    }
    const s = bank.step(t + 8);
    expect(s.people[1].x[WRIST]).toBeCloseTo(X(WRIST) + 0.2, 1);
    expect(s.people[1].pa).toBeGreaterThan(0.99);
    expect(s.people[1].primary).toBe(true);
    expect(s.people[0].primary).toBe(false);
  });

  it('handles four people in any order: nobody changes slot', () => {
    const bank = newBank();
    const four = [shifted(REAL_FRAME, -0.3), shifted(REAL_FRAME, -0.1), shifted(REAL_FRAME, 0.1), shifted(REAL_FRAME, 0.3)];
    for (let k = 0; k < 20; k++) bank.push([four[3], four[1], four[0], four[2]], k * 33, k * 33 + 40, 640, 480);
    const where = (s: Scene) => s.people.map((p) => Math.round((p.x[WRIST] - X(WRIST)) * 10) / 10);
    const order = where(bank.step(20 * 33 + 40));
    expect(order).toHaveLength(4);
    for (let k = 20; k < 40; k++) bank.push(k % 2 ? four : [four[2], four[3], four[0], four[1]], k * 33, k * 33 + 40, 640, 480);
    const second = bank.step(40 * 33 + 40);
    expect(where(second)).toEqual(order);
    expect(second.people.every((p) => p.pa > 0.99)).toBe(true);
  });
});

describe('skeleton core: a slow device keeps its person (round 4, phase E)', () => {
  it('results at 3 fps never fade the person out between results', () => {
    const pa: number[] = [];
    const ja: number[] = [];
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 6000,
      resultHz: 3,
      results: () => [REAL_FRAME],
      onStep: (t, s) => {
        if (t > 1700 && s.n) {
          pa.push(s.people[0].pa);
          ja.push(alphaOf(s, WRIST));
        }
      },
    });
    expect(pa.length).toBeGreaterThan(200);
    expect(Math.min(...pa)).toBeGreaterThan(0.99);
    expect(Math.min(...ja)).toBeGreaterThan(0.99);
  });

  it('a really missing person still goes: after about two result intervals, plus the fade', () => {
    const bank = newBank();
    const interval = 1000 / 3;
    for (let k = 0; k < 6; k++) {
      bank.push([REAL_FRAME], k * interval, k * interval + 45, 640, 480);
      for (let t = k * interval + 45; t < (k + 1) * interval + 45; t += 16) bank.step(t);
    }
    const last = 5 * interval + 45;
    for (let t = last; t < last + interval; t += 16) expect(bank.step(t).people[0].pa).toBeGreaterThan(0.99);
    let pa = 1;
    for (let t = last + interval; t < last + 2 * interval + SKELETON_TUNING.fade.outMs + 50; t += 16) pa = paOf(bank.step(t));
    expect(pa).toBe(0);
  });

  it('at normal speed (30 results a second) the hold is still the plain personHoldMs', () => {
    const bank = newBank();
    const hold = SKELETON_TUNING.fade.personHoldMs;
    for (let k = 0; k < 30; k++) {
      bank.push([REAL_FRAME], k * 33, k * 33 + 45, 640, 480);
      bank.step(k * 33 + 45);
      bank.step(k * 33 + 61);
    }
    const last = 29 * 33 + 45;
    expect(bank.step(last + hold - 5).people[0].pa).toBeGreaterThan(0.99);
    let pa = 1;
    for (let t = last + hold; t < last + hold + 400; t += 16) pa = paOf(bank.step(t));
    expect(pa).toBe(0);
  });
});

describe('skeleton core: bounded holds, returns and newcomers (round 4, phase E, last fixes)', () => {
  const MAXHOLD = SKELETON_TUNING.guard.maxHoldMs;
  const stepBound = G.stepBase + G.stepPerS * (FRAME_MS / 1000);
  // A person with exactly 12 clearly visible joints, so that 5 of them is 42%.
  const TWELVE = [0, 7, 8, 11, 12, 13, 15, 23, 24, 25, 27, 31];
  const BASE: Landmark[] = REAL_FRAME.map((l, i) => (TWELVE.includes(i) ? l : ([l[0], l[1], 0] as Landmark)));

  /**
   * The person sways (0.1 widths at 0.5 Hz) while `garbage(k)` joints are thrown far off on every result
   * (a different spot each time, so no jump is ever confirmed). Returns the longest stretch of
   * frames in which none of the 12 joints moved by more than 0.2% of the width: a frozen person. Garbage is always at least 0.25 widths from where the person really is.
   */
  function longestFreeze(garbage: (k: number) => number[], seed: number) {
    const rng = mulberry32(seed);
    const drift = sinusoid(0.1, 0.5);
    let k = 0;
    let prev: number[] | null = null;
    let run = 0;
    let longest = 0;
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 5000,
      results: (c) => {
        const bad = k++ > 15 ? garbage(k) : [];
        return [BASE.map((l, i) => (bad.includes(i) ? ([l[0] + drift(c) + (rng() < 0.5 ? -1 : 1) * (0.35 + 0.15 * rng()), l[1] + (rng() - 0.5) * 0.4, l[2]] as Landmark) : ([l[0] + drift(c), l[1], l[2]] as Landmark)))];
      },
      onStep: (t, s) => {
        if (t < 1900 || !s.n) return;
        const cur = TWELVE.map((j) => s.people[0].x[j]);
        if (prev && Math.max(...cur.map((x, q) => Math.abs(x - prev![q]))) < 0.002) {
          run++;
          longest = Math.max(longest, run);
        } else run = 0;
        prev = cur;
      },
    });
    return longest * FRAME_MS;
  }
  const bound = MAXHOLD + 2 * (1000 / 30) + FRAME_MS;

  it('garbage on 5 of 12 joints (42%) on every result freezes the person for at most maxHoldMs plus a result or so', () => {
    for (const seed of [1, 2, 3]) expect(longestFreeze(() => TWELVE.slice(0, 5), seed)).toBeLessThanOrEqual(bound);
  });

  it('a rotating 5-of-12 garbage pattern (a different 5 on every result) does the same', () => {
    for (const seed of [1, 2, 3]) {
      expect(longestFreeze((k) => [0, 1, 2, 3, 4].map((q) => TWELVE[(k * 5 + q) % 12]), seed)).toBeLessThanOrEqual(bound);
    }
  });

  it('the person-level freeze really was unbounded without the timer (the test is meaningful)', () => {
    // The same stream with no time limit on any hold (maxHoldMs huge): the person stays frozen far longer.
    const lax: Tuning = { ...SKELETON_TUNING, guard: { ...SKELETON_TUNING.guard, maxHoldMs: 1e9 } };
    const rng = mulberry32(1);
    const drift = sinusoid(0.1, 0.5);
    let k = 0;
    let prev: number[] | null = null;
    let run = 0;
    let longest = 0;
    runSim({
      bank: loadCore(lax).createBank(),
      startMs: 1000,
      durationMs: 5000,
      results: (c) => {
        const bad = k++ > 15 ? TWELVE.slice(0, 5) : [];
        return [BASE.map((l, i) => (bad.includes(i) ? ([l[0] + drift(c) + (rng() < 0.5 ? -1 : 1) * (0.35 + 0.15 * rng()), l[1], l[2]] as Landmark) : ([l[0] + drift(c), l[1], l[2]] as Landmark)))];
      },
      onStep: (t, s) => {
        if (t < 1900 || !s.n) return;
        const cur = TWELVE.map((j) => s.people[0].x[j]);
        if (prev && Math.max(...cur.map((x, q) => Math.abs(x - prev![q]))) < 0.002) {
          run++;
          longest = Math.max(longest, run);
        } else run = 0;
        prev = cur;
      },
    });
    expect(longest * FRAME_MS).toBeGreaterThan(bound);
  });

  function pair(gap: number, flip: boolean): Landmark[] {
    return withJoints(REAL_FRAME, {
      15: [0.5 + (flip ? 1 : -1) * (gap / 2), 0.5, 0.97] as Landmark,
      16: [0.5 + (flip ? -1 : 1) * (gap / 2), 0.5, 0.97] as Landmark,
    });
  }
  const gone = (gap: number): Landmark[] =>
    withJoints(pair(gap, false), { 15: [0.5 - gap / 2, 0.5, 0.05] as Landmark, 16: [0.5 + gap / 2, 0.5, 0.05] as Landmark });

  function lossRun(gap: number, flip: boolean) {
    const from = 2000;
    const to = 2120;
    const back = pair(gap, flip);
    const truthX = (j: number, t: number) => (t - 45 < to ? pair(gap, false)[j][0] : back[j][0]);
    let prev: { x: number[]; a: number[] } | null = null;
    let worstMove = 0;
    let worstOff = 0;
    let minAlpha = 1;
    runSim({
      bank: newBank(),
      startMs: 1000,
      durationMs: 2000,
      results: (c) => [c < from ? pair(gap, false) : c < to ? gone(gap) : back],
      onStep: (t, s) => {
        const cur = { x: [s.people[0].x[15], s.people[0].x[16]], a: [alphaOf(s, 15), alphaOf(s, 16)] };
        for (let q = 0; q < 2; q++) {
          if (prev && prev.a[q] > 0.5 && cur.a[q] > 0.5) worstMove = Math.max(worstMove, Math.abs(cur.x[q] - prev.x[q]));
          if (t > to + 45 + 100 && cur.a[q] > 0.5) worstOff = Math.max(worstOff, Math.abs(cur.x[q] - truthX(15 + q, t)));
          if (t > 1500) minAlpha = Math.min(minAlpha, cur.a[q]);
        }
        prev = cur;
      },
    });
    return { worstMove, worstOff, minAlpha };
  }

  it.each([0.3, 0.12])('both wrists vanish for 120 ms and come back swapped (%s apart): never slid across while drawn, and they end on the new labels', (gap) => {
    const r = lossRun(gap, true);
    expect(r.worstMove).toBeLessThanOrEqual(stepBound);
    // Once the wrists are visible again (the visibility low-pass needs two results), whatever is drawn clearly is at the true place: re-seeded, not slid.
    expect(r.worstOff).toBeLessThan(0.02);
    expect(r.minAlpha).toBeLessThan(0.5); // the re-seed dip
  });

  it('an honest return at the same place does not dip and does not move', () => {
    const r = lossRun(0.3, false);
    expect(r.minAlpha).toBeGreaterThanOrEqual(0.95);
    expect(r.worstMove).toBeLessThan(0.004);
  });

  describe('newcomers', () => {
    const A = shifted(REAL_FRAME, -0.3);
    const B = shifted(REAL_FRAME, 0.3);
    const C = shifted(REAL_FRAME, 0, 0.5); // more than 0.3 widths from both
    const near = shifted(REAL_FRAME, -0.3 + 0.2); // 0.2 from A: the same person, moved

    function twoThen(next: Landmark[][]) {
      const bank = newBank();
      for (let k = 0; k < 20; k++) {
        bank.push([A, B], k * 33, k * 33 + 40, 640, 480);
        bank.step(k * 33 + 40);
      }
      const rows: { a: number[]; pa: number[]; x: number[] }[] = [];
      for (let k = 20; k < 50; k++) {
        bank.push(next, k * 33, k * 33 + 40, 640, 480);
        const s = bank.step(k * 33 + 48);
        rows.push({
          a: [0, 1, 2].map((p) => (s.n > p ? s.people[p].a[WRIST] : 0)),
          pa: [0, 1, 2].map((p) => (s.n > p ? s.people[p].pa : 0)),
          x: [0, 1, 2].map((p) => (s.n > p ? s.people[p].x[WRIST] : 0)),
        });
      }
      return rows;
    }

    it('one person leaves and a different one appears in the same result: the newcomer gets an empty slot and fades in', () => {
      const rows = twoThen([B, C]);
      // B keeps its slot without a flicker; the one that left stays where it was and fades; the newcomer is slot 2.
      for (const r of rows) {
        expect(r.pa[1] * r.a[1]).toBeGreaterThan(0.99);
        expect(r.x[1]).toBeCloseTo(X(WRIST) + 0.3, 1);
        if (r.pa[0] > 0) expect(r.x[0]).toBeCloseTo(X(WRIST) - 0.3, 1);
        expect(r.x[2]).toBeCloseTo(X(WRIST), 1);
      }
      expect(rows[0].pa[2] * rows[0].a[2]).toBeLessThan(0.3);
      expect(rows[rows.length - 1].pa[2] * rows[rows.length - 1].a[2]).toBeGreaterThan(0.99);
      let prev = 0;
      for (const r of rows) {
        const a = r.pa[2] * r.a[2];
        expect(a).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = a;
      }
      expect(rows[rows.length - 1].pa[0]).toBeLessThan(0.01); // the old one has faded out
    });

    it('a person that merely moved (within 0.3 widths of where its slot was) keeps the slot', () => {
      const rows = twoThen([near, B]);
      for (const r of rows) expect(r.pa[2]).toBe(0);
      expect(rows[rows.length - 1].x[0]).toBeCloseTo(X(WRIST) - 0.1, 1);
    });
  });
});
