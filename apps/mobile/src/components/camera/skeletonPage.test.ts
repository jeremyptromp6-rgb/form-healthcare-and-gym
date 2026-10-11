import { MEDIAPIPE_POSE_INDEX, fromMediaPipePose } from '@form/domain';
import { SKELETON_TUNING } from './skeletonCore';
import { SKELETON_STYLE } from './skeletonRender';
import { SKELETON_BUNDLE, SKELETON_PAGE, createSkeletonPage, landmarksFromPeople, skeletonConfig } from './skeletonPage';
import type { SkeletonEnv, SkeletonPage, SkeletonPalette, SkeletonState } from './skeletonTypes';
import {
  NOBODY,
  OldPipeline,
  REAL_FRAME,
  createFakeClock,
  rms,
  runOldSim,
  runSim,
  shifted,
  sinusoid,
  type BankLike,
  type People,
} from './skeleton.fixtures';

/**
 * The page composes the tracker and the renderer and runs the per-frame work: canvas sizing, the
 * mapping to screen px, the quality governor, reduce motion and the rAF loop. These tests evaluate
 * the real bundle text against a fake env (recording 2D context, fake clock, manual rAF), so they
 * check what reaches the canvas, not how the page is written.
 */

const PAL: SkeletonPalette = { good: '#E5825A', fix: '#F2B544', warn: '#D9A441', untrackable: '#D2BDA9', other: '#F07A6E', halo: '#17110E', highlight: '#F8ECDF' };
const PAL2: SkeletonPalette = { good: '#11AA11', fix: '#22BB22', warn: '#33CC33', untrackable: '#44DD44', other: '#55EE55', halo: '#0A0A0A', highlight: '#FAFAFA' };
const state = (o: Partial<SkeletonState> = {}): SkeletonState => ({ v: 1, tone: 'good', side: null, chain: [], palette: PAL, reduceMotion: false, ...o });
const HALO = SKELETON_STYLE.haloAlpha;
const GOV = SKELETON_TUNING.governor;

interface Ev {
  op: string;
  args: number[];
  style?: string;
  alpha?: number;
}

/** A recording 2D context: every call in order, fill and stroke with the style and alpha in force. */
function recorder(log: Ev[], onClear: () => void) {
  const props: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
  return new Proxy(
    {},
    {
      get(_, key: string) {
        if (key in props) return props[key];
        return (...args: unknown[]) => {
          const nums = args.filter((a) => typeof a === 'number') as number[];
          if (key === 'fill' || key === 'stroke') log.push({ op: key, args: nums, style: String(key === 'fill' ? props.fillStyle : props.strokeStyle), alpha: Number(props.globalAlpha) });
          else log.push({ op: key, args: nums });
          if (key === 'clearRect') onClear();
        };
      },
      set(_, key: string, v) {
        props[key] = v;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

interface Rig {
  page: SkeletonPage;
  log: Ev[];
  clock: ReturnType<typeof createFakeClock>;
  view: { cw: number; ch: number; dpr: number };
  video: { w: number; h: number };
  canvas: { width: number; height: number };
  env: SkeletonEnv;
  raf: { queue: (() => void)[]; run(): void };
  sprites: number;
  /** Simulated draw cost in ms, charged when the renderer clears the canvas (the first thing a draw does). */
  cost: () => number;
  setCost(c: number | (() => number)): void;
  /** Draws one frame at time t. */
  frame(t: number): void;
}

function rig(o: { mirror?: boolean; cw?: number; ch?: number; dpr?: number; vw?: number; vh?: number } = {}): Rig {
  const clock = createFakeClock(1000);
  const log: Ev[] = [];
  let costFn: () => number = () => 0;
  const r = {} as Rig;
  const ctx = recorder(log, () => {
    clock.advance(costFn());
  });
  const canvas = {
    w: 0,
    h: 0,
    get width() {
      return this.w;
    },
    set width(v: number) {
      log.push({ op: 'canvas.width', args: [v] });
      this.w = v;
    },
    get height() {
      return this.h;
    },
    set height(v: number) {
      log.push({ op: 'canvas.height', args: [v] });
      this.h = v;
    },
    getContext: () => ctx,
  };
  const queue: (() => void)[] = [];
  r.sprites = 0;
  const view = { cw: o.cw ?? 320, ch: o.ch ?? 240, dpr: o.dpr ?? 2 };
  const video = { w: o.vw ?? 640, h: o.vh ?? 480 };
  const env: SkeletonEnv = {
    canvas,
    size: () => view,
    video: () => video,
    raf: (cb) => {
      queue.push(cb);
    },
    now: () => clock.now(),
    createCanvas: (w, h) => {
      r.sprites++;
      return { width: w, height: h, getContext: () => ctx };
    },
    mirror: !!o.mirror,
  };
  r.page = createSkeletonPage(env);
  r.log = log;
  r.clock = clock;
  r.view = view;
  r.video = video;
  r.canvas = canvas;
  r.env = env;
  r.raf = {
    queue,
    run() {
      const cb = queue.shift();
      if (cb) cb();
    },
  };
  r.cost = () => costFn();
  r.setCost = (c) => {
    costFn = typeof c === 'number' ? () => c : c;
  };
  r.frame = (t) => {
    clock.set(t);
    log.length = 0;
    r.page.frame();
  };
  return r;
}

/** The page seen as a bank, so the fixture simulation (results at 30 Hz, late, display at 60 Hz) can drive it. */
function asBank(r: Rig, onFrame: () => void): BankLike {
  return {
    push: (people, capture, arrive, vw, vh) => r.page.push(people, capture, arrive, vw, vh),
    step: (t) => {
      r.frame(t);
      onFrame();
      return { n: 0, people: [] };
    },
    latency: () => 0,
    reset: () => undefined,
  };
}

/** The first arc a draw makes is the halo disc of joint 11 (left shoulder), the first joint with a disc. */
function shoulder(log: Ev[]): { x: number; y: number; alpha: number } | null {
  const i = log.findIndex((e) => e.op === 'arc');
  if (i < 0) return null;
  const fill = log.slice(i).find((e) => e.op === 'fill');
  return { x: log[i]!.args[0]!, y: log[i]!.args[1]!, alpha: (fill?.alpha ?? 0) / HALO };
}

const X11 = REAL_FRAME[11]![0];
const Y11 = REAL_FRAME[11]![1];

/** Runs the simulation of a static person; results during [gapFrom, gapTo) are empty or never arrive. */
function staticRun(r: Rig, o: { from?: number; ms: number; gap?: [number, number]; mode?: 'empty' | 'lost' }, seen: (t: number, s: ReturnType<typeof shoulder>) => void) {
  const gap = o.gap;
  const inGap = (c: number) => !!gap && c >= gap[0] && c < gap[1];
  runSim({
    bank: asBank(r, () => seen(r.clock.now(), shoulder(r.log))),
    startMs: o.from ?? 1000,
    durationMs: o.ms,
    results: (c) => (inGap(c) && o.mode !== 'lost' ? NOBODY : [REAL_FRAME]),
    lost: (c) => inGap(c) && o.mode === 'lost',
  });
}

describe('skeleton page: end-to-end lag', () => {
  const durationMs = 6000;
  const truth = sinusoid(0.15, 0.7);
  const results = (c: number): People => [shifted(REAL_FRAME, truth(c))];

  function pageErrors() {
    const r = rig();
    r.page.setState(state());
    const errs: number[] = [];
    runSim({
      bank: asBank(r, () => {
        const s = shoulder(r.log);
        if (r.clock.now() > 2000 && s) errs.push(s.x / r.view.cw - (X11 + truth(r.clock.now())));
      }),
      durationMs,
      results,
    });
    return errs;
  }
  function oldErrors() {
    const errs: number[] = [];
    runOldSim(new OldPipeline(), {
      durationMs,
      results,
      onStep: (t, shown) => {
        if (t > 2000 && shown.length) errs.push(shown[0]![11]![0] - (X11 + truth(t)));
      },
    });
    return errs;
  }

  it('follows the 0.7 Hz sinusoid at least 2x better than the old One Euro + glide pipeline, measured at the canvas', () => {
    const neu = rms(pageErrors());
    const old = rms(oldErrors());
    expect(old).toBeGreaterThan(0.035); // the reference really lags
    expect(old / neu).toBeGreaterThanOrEqual(2);
    expect(neu).toBeLessThanOrEqual(0.02);
  });
});

describe('skeleton page: mapping to the screen', () => {
  const cases: [string, boolean][] = [
    ['cover crop', false],
    ['cover crop, mirrored', true],
  ];
  it.each(cases)('puts the joint where the %s says (360x640 view of a 640x480 video)', (_n, mirror) => {
    const r = rig({ cw: 360, ch: 640, dpr: 2, mirror });
    r.page.setState(state());
    let last: ReturnType<typeof shoulder> = null;
    staticRun(r, { ms: 1500 }, (_t, s) => {
      last = s;
    });
    const scale = Math.max(360 / 640, 640 / 480);
    const dw = 640 * scale;
    const dh = 480 * scale;
    const ex = (360 - dw) / 2 + X11 * dw;
    const ey = (640 - dh) / 2 + Y11 * dh;
    expect(last!.x).toBeCloseTo(mirror ? 360 - ex : ex, 1);
    expect(last!.y).toBeCloseTo(ey, 1);
  });
});

describe('skeleton page: canvas backing store', () => {
  it('sizes the backing store to css x min(dpr, 2) and sets the transform before anything is drawn', () => {
    const r = rig({ cw: 360, ch: 640, dpr: 3 });
    r.page.setState(state());
    r.frame(1000);
    expect(r.canvas.width).toBe(720);
    expect(r.canvas.height).toBe(1280);
    const names = r.log.map((e) => e.op);
    expect(names.indexOf('canvas.width')).toBeLessThan(names.indexOf('setTransform'));
    expect(names.indexOf('setTransform')).toBeLessThan(names.indexOf('clearRect'));
    const t = r.log.find((e) => e.op === 'setTransform')!;
    expect(t.args).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('follows dpr 1 and 1.5, and stays under the pixel budget on a huge view', () => {
    const a = rig({ cw: 360, ch: 640, dpr: 1 });
    a.frame(1000);
    expect([a.canvas.width, a.canvas.height]).toEqual([360, 640]);
    const b = rig({ cw: 360, ch: 640, dpr: 1.5 });
    b.frame(1000);
    expect([b.canvas.width, b.canvas.height]).toEqual([540, 960]);
    const c = rig({ cw: 1000, ch: 1000, dpr: 2 });
    c.frame(1000);
    expect(c.canvas.width * c.canvas.height).toBeLessThanOrEqual(SKELETON_TUNING.view.maxPixels);
    const t = c.log.find((e) => e.op === 'setTransform')!;
    expect(t.args[0]).toBeCloseTo(c.canvas.width / 1000, 2);
  });

  it('sets the transform on every frame (resizing a canvas resets its context) and only resizes when the size changed', () => {
    const r = rig({ cw: 320, ch: 240, dpr: 2 });
    r.page.setState(state());
    r.frame(1000);
    r.frame(1016);
    expect(r.log.some((e) => e.op === 'canvas.width' || e.op === 'canvas.height')).toBe(false);
    expect(r.log.filter((e) => e.op === 'setTransform')).toHaveLength(1);
  });

  it('does nothing while the view has no size', () => {
    const r = rig({ cw: 0, ch: 0 });
    r.page.setState(state());
    r.frame(1000);
    expect(r.log).toHaveLength(0);
    expect(r.page.stats().draws).toBe(0);
  });

  it('a resize mid-session updates the backing store and the person lands on the new mapping with no jump', () => {
    const r = rig({ cw: 320, ch: 240, dpr: 2 });
    r.page.setState(state());
    const nx: number[] = [];
    let sawResize = false;
    staticRun(r, { ms: 1500 }, () => {
      const s = shoulder(r.log);
      if (s) nx.push(s.x / r.view.cw);
      if (r.clock.now() > 1700 && !sawResize) {
        sawResize = true;
        r.view.cw = 480;
        r.view.ch = 360;
      }
    });
    expect(sawResize).toBe(true);
    expect(r.canvas.width).toBe(960);
    expect(r.canvas.height).toBe(720);
    // Normalised position of the same joint: identical before and after the resize, frame to frame.
    const settled = nx.slice(20);
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(1e-3);
  });
});

describe('skeleton page: no blink on a gap, fade on a long one', () => {
  it('keeps the joint fully drawn through a 200 ms gap (empty results)', () => {
    const r = rig();
    r.page.setState(state());
    const alphas: number[] = [];
    staticRun(r, { ms: 3000, gap: [1600, 1800] }, (t, s) => {
      if (t > 1500) alphas.push(s ? s.alpha : 0);
    });
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.95);
  });

  it('keeps the joint fully drawn through a 200 ms gap in which no results arrive at all', () => {
    const r = rig();
    r.page.setState(state());
    const alphas: number[] = [];
    staticRun(r, { ms: 3000, gap: [1600, 1800], mode: 'lost' }, (t, s) => {
      if (t > 1500) alphas.push(s ? s.alpha : 0);
    });
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.95);
  });

  it('fades the joint out to nothing over a 600 ms gap, in steps, and brings it back', () => {
    const r = rig();
    r.page.setState(state());
    const alphas: number[] = [];
    staticRun(r, { ms: 3500, gap: [1600, 2200] }, (t, s) => {
      if (t > 1500) alphas.push(s ? s.alpha : 0);
    });
    expect(Math.min(...alphas)).toBe(0);
    expect(alphas.some((a) => a > 0.05 && a < 0.95)).toBe(true); // a ramp, not a pop
    expect(alphas[alphas.length - 1]).toBeGreaterThanOrEqual(0.95);
  });
});

describe('skeleton page: state and palette', () => {
  const fillStyles = (log: Ev[]) => new Set(log.filter((e) => e.op === 'fill' || e.op === 'stroke').map((e) => e.style));

  it('draws nothing before a state arrives', () => {
    const r = rig();
    staticRun(r, { ms: 600 }, () => {
      expect(r.log.some((e) => e.op === 'fill' || e.op === 'stroke')).toBe(false);
    });
  });

  it('draws only palette colours, and a new state changes the colours of the next draws', () => {
    const r = rig();
    r.page.setState(state({ tone: 'good' }));
    staticRun(r, { ms: 800 }, () => undefined);
    const before = fillStyles(r.log);
    expect(before.has(PAL.good)).toBe(true);
    for (const s of before) expect(Object.values(PAL)).toContain(s);
    r.page.setState(state({ tone: 'warn', palette: PAL2 }));
    // The tone fades over about 200 ms from the old colour, then only the new palette is used.
    for (let i = 0; i < 30; i++) {
      const t = r.clock.now() + 16;
      r.page.push([REAL_FRAME], t - 40, t, 640, 480);
      r.frame(t);
    }
    const after = fillStyles(r.log);
    for (const s of after) expect(Object.values(PAL2)).toContain(s);
    expect(after.has(PAL2.warn)).toBe(true);
  });

  it('ignores malformed state and keeps drawing with the previous one', () => {
    const r = rig();
    r.page.setState(state({ tone: 'fix' }));
    staticRun(r, { ms: 800 }, () => undefined);
    const bad = [
      { ...state({ palette: PAL2, tone: 'warn' }), v: 2 },
      { ...state({ palette: PAL2 }), palette: undefined },
      { ...state({ palette: PAL2 }), tone: 'nope' },
      null,
      undefined,
    ] as unknown as SkeletonState[];
    for (const s of bad) r.page.setState(s);
    r.frame(r.clock.now() + 16);
    const styles = fillStyles(r.log);
    expect(styles.has(PAL.fix)).toBe(true);
    for (const s of styles) expect(Object.values(PAL)).toContain(s);
  });
});

describe('skeleton page: reduce motion', () => {
  const chain = [23, 25, 27];

  it('uses no glow sprite, and fully on or off alpha, while hold still bridges a short gap', () => {
    const r = rig();
    r.page.setState(state({ side: 'left', chain, reduceMotion: true }));
    const alphas: number[] = [];
    staticRun(r, { ms: 3200, gap: [1600, 1800] }, (t, s) => {
      alphas.push(s ? s.alpha : 0);
      expect(r.log.some((e) => e.op === 'drawImage')).toBe(false);
      if (t > 1700) expect(s!.alpha).toBeCloseTo(1, 5); // held through the gap
    });
    expect(r.sprites).toBe(0);
    // From the very first frame the joint is either off or fully on: no fade-in ramp.
    for (const a of alphas) expect(Math.abs(a) < 1e-6 || Math.abs(a - 1) < 1e-6).toBe(true);
  });

  it('a long gap switches the joint off in one frame instead of ramping', () => {
    const r = rig();
    r.page.setState(state({ reduceMotion: true }));
    const alphas: number[] = [];
    staticRun(r, { ms: 3500, gap: [1600, 2300] }, (t, s) => {
      if (t > 1500) alphas.push(s ? s.alpha : 0);
    });
    expect(alphas.some((a) => a > 0.05 && a < 0.95)).toBe(false);
    expect(alphas.some((a) => a === 0)).toBe(true);
  });

  it('with motion on, the emphasised chain does draw its glow sprite', () => {
    const r = rig();
    r.page.setState(state({ side: 'left', chain, reduceMotion: false }));
    staticRun(r, { ms: 1500 }, () => undefined);
    expect(r.sprites).toBeGreaterThan(0);
  });
});

describe('skeleton page: quality governor', () => {
  /** Runs n frames of 16.7 ms with the simulated cost; returns the quality after every frame. */
  function frames(r: Rig, n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      r.clock.advance(1000 / 60);
      r.frame(r.clock.now());
      out.push(r.page.stats().quality);
    }
    return out;
  }
  const rigWithPerson = () => {
    const r = rig();
    r.page.setState(state({ side: 'left', chain: [23, 25, 27] }));
    r.page.push([REAL_FRAME], 900, 940, 640, 480);
    return r;
  };

  it('starts at full quality and stays there while drawing is cheap', () => {
    const r = rigWithPerson();
    r.setCost(1);
    expect(new Set(frames(r, GOV.windowFrames * 4))).toEqual(new Set([2]));
  });

  it('a draw cost just over glowOffDrawMs turns the glow off (quality 1) after one window, not before', () => {
    const r = rigWithPerson();
    r.setCost(GOV.glowOffDrawMs + 1);
    const q = frames(r, GOV.windowFrames * 3);
    expect(q[GOV.windowFrames - 2]).toBe(2);
    expect(q[GOV.windowFrames - 1]).toBe(1);
    expect(q[q.length - 1]).toBe(1);
  });

  it('a draw cost just over minimalDrawMs goes to minimal (quality 0)', () => {
    const r = rigWithPerson();
    r.setCost(GOV.minimalDrawMs + 1);
    const q = frames(r, GOV.windowFrames * 3);
    expect(q[GOV.windowFrames - 1]).toBe(0);
    expect(q[q.length - 1]).toBe(0);
  });

  it('a draw cost just under glowOffDrawMs keeps full quality', () => {
    const r = rigWithPerson();
    r.setCost(GOV.glowOffDrawMs - 1);
    expect(new Set(frames(r, GOV.windowFrames * 4))).toEqual(new Set([2]));
  });

  it('one slow frame in a window does not demote', () => {
    const r = rigWithPerson();
    let n = 0;
    r.setCost(() => (n++ === 10 ? 200 : 1));
    expect(new Set(frames(r, GOV.windowFrames * 3))).toEqual(new Set([2]));
  });

  it('the lower quality really draws less', () => {
    const r = rigWithPerson();
    r.setCost(1);
    frames(r, 10);
    r.frame(r.clock.now() + 16);
    const full = r.log.filter((e) => e.op === 'fill' || e.op === 'stroke').length;
    r.setCost(GOV.minimalDrawMs + 1);
    frames(r, GOV.windowFrames * 2);
    r.setCost(1);
    r.frame(r.clock.now() + 16);
    const minimal = r.log.filter((e) => e.op === 'fill' || e.op === 'stroke').length;
    expect(r.page.stats().quality).toBe(0);
    expect(minimal).toBeLessThan(full);
  });

  it('the CPU backend caps quality at 1 at once, and lifting it lets cheap drawing recover to 2', () => {
    const r = rigWithPerson();
    r.setCost(1);
    r.page.setBackend('CPU');
    expect(r.page.stats().quality).toBe(1);
    expect(new Set(frames(r, GOV.windowFrames * 20))).toEqual(new Set([1]));
    r.page.setBackend('GPU');
    expect(frames(r, GOV.windowFrames * 6).pop()).toBe(2);
  });

  it('inline mode caps quality at 1 for good, even when drawing is free', () => {
    const r = rigWithPerson();
    r.setCost(0);
    r.page.setInline();
    expect(r.page.stats().quality).toBe(1);
    expect(new Set(frames(r, GOV.windowFrames * 20))).toEqual(new Set([1]));
    r.page.setBackend('GPU');
    expect(new Set(frames(r, GOV.windowFrames * 20))).toEqual(new Set([1]));
  });

  it('the cap holds while the governor is on its way down too (CPU + slow draw -> minimal)', () => {
    const r = rigWithPerson();
    r.page.setBackend('CPU');
    r.setCost(GOV.minimalDrawMs + 1);
    const q = frames(r, GOV.windowFrames * 2);
    expect(q[0]).toBe(1);
    expect(q[q.length - 1]).toBe(0);
  });

  it('recovers step by step once drawing is cheap again', () => {
    const r = rigWithPerson();
    r.setCost(GOV.minimalDrawMs + 1);
    expect(frames(r, GOV.windowFrames).pop()).toBe(0);
    r.setCost(0);
    const q = frames(r, GOV.windowFrames * 40);
    expect(q).toContain(1);
    expect(q[q.length - 1]).toBe(2);
    // never a jump of two levels
    for (let i = 1; i < q.length; i++) expect(Math.abs(q[i]! - q[i - 1]!)).toBeLessThanOrEqual(1);
  });

  it('does not flap when the full look is the thing that is too slow (retries get ever slower)', () => {
    const r = rigWithPerson();
    r.setCost(() => [1, 2, 8][r.page.stats().quality]!); // quality 2 costs 8 ms, quality 1 costs 2 ms
    const q = frames(r, GOV.windowFrames * 120);
    let changes = 0;
    for (let i = 1; i < q.length; i++) if (q[i] !== q[i - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(10);
    expect(q[0]).toBe(2);
  });
});

describe('skeleton page: loop', () => {
  it('start schedules one raf, each loop draws one frame and reschedules, stop clears the canvas and ends the loop', () => {
    const r = rig();
    r.page.setState(state());
    r.page.start();
    r.page.start();
    expect(r.raf.queue).toHaveLength(1);
    r.clock.set(1016);
    r.raf.run();
    expect(r.page.stats().draws).toBe(1);
    expect(r.raf.queue).toHaveLength(1);
    r.clock.set(1033);
    r.raf.run();
    expect(r.page.stats().draws).toBe(2);
    expect(r.raf.queue).toHaveLength(1);

    r.log.length = 0;
    r.page.stop();
    const clear = r.log.find((e) => e.op === 'clearRect')!;
    expect(clear.args).toEqual([0, 0, r.canvas.width, r.canvas.height]);
    expect(r.log.findIndex((e) => e.op === 'setTransform')).toBeLessThan(r.log.findIndex((e) => e.op === 'clearRect'));
    expect(r.log.some((e) => e.op === 'fill' || e.op === 'stroke')).toBe(false);

    // The loop that was already scheduled ends without drawing or rescheduling.
    r.raf.run();
    expect(r.page.stats().draws).toBe(2);
    expect(r.raf.queue).toHaveLength(0);
  });

  it('can be started again after a stop', () => {
    const r = rig();
    r.page.setState(state());
    r.page.start();
    r.page.stop();
    // The frame scheduled before the stop is still in the queue: it must not become a second chain.
    r.page.start();
    expect(r.raf.queue).toHaveLength(2);
    r.raf.run();
    r.raf.run();
    expect(r.page.stats().draws).toBe(1);
    expect(r.raf.queue).toHaveLength(1);
  });

  /** Runs every callback that is queued now (one display frame), at time t. */
  function runFrame(r: Rig, t: number) {
    r.clock.set(t);
    const batch = r.raf.queue.splice(0);
    batch.forEach((cb) => cb());
  }

  it('start, stop, start without clearing the queue leaves exactly one chain: one draw per frame', () => {
    const r = rig();
    r.page.setState(state());
    r.page.start();
    r.page.stop();
    r.page.start();
    let t = 1000;
    let prev = r.page.stats().draws;
    for (let i = 0; i < 8; i++) {
      runFrame(r, (t += 16));
      const now = r.page.stats().draws;
      expect(now - prev).toBe(1);
      prev = now;
      expect(r.raf.queue).toHaveLength(1);
    }
  });

  it('repeated stop and start cycles never multiply the chains', () => {
    const r = rig();
    r.page.setState(state());
    let t = 1000;
    for (let cycle = 0; cycle < 6; cycle++) {
      r.page.start();
      r.page.stop();
      r.page.start();
      r.page.stop();
      r.page.start();
      runFrame(r, (t += 16)); // wakes the stale chains (they end) and the live one (it draws)
    }
    expect(r.raf.queue).toHaveLength(1);
    const before = r.page.stats().draws;
    for (let i = 0; i < 5; i++) {
      runFrame(r, (t += 16));
      expect(r.raf.queue).toHaveLength(1);
    }
    expect(r.page.stats().draws - before).toBe(5);
  });

  it('a chain that survives a stop ends instead of drawing or rescheduling', () => {
    const r = rig();
    r.page.setState(state());
    r.page.start();
    r.page.stop();
    const draws = r.page.stats().draws;
    runFrame(r, 1016);
    expect(r.page.stats().draws).toBe(draws);
    expect(r.raf.queue).toHaveLength(0);
  });

  it('a stop forgets the people, so a restart does not show a stale skeleton', () => {
    const r = rig();
    r.page.setState(state());
    r.page.push([REAL_FRAME], 1000, 1040, 640, 480);
    r.frame(1100);
    expect(shoulder(r.log)).not.toBeNull();
    r.page.stop();
    r.frame(1120);
    expect(shoulder(r.log)).toBeNull();
  });

  it('survives a frame that throws and keeps the loop going', () => {
    const r = rig();
    r.page.setState(state());
    let boom = true;
    const real = r.env.size;
    r.env.size = () => {
      if (boom) {
        boom = false;
        throw new Error('layout');
      }
      return real();
    };
    r.page.start();
    r.raf.run();
    expect(r.raf.queue).toHaveLength(1);
    r.raf.run();
    expect(r.page.stats().draws).toBe(1);
  });

  it('reports the latency of the results it was given', () => {
    const r = rig();
    r.page.push([REAL_FRAME], 1000, 1045, 640, 480);
    expect(r.page.stats().latencyMs).toBeCloseTo(45, 5);
  });
});

describe('landmarksFromPeople', () => {
  const people = (landmarks: readonly (readonly [number, number, number])[]) => [{ keypoints: fromMediaPipePose(landmarks.map(([x, y, v]) => ({ x, y, visibility: v }))) }];

  it('rebuilds 33 MediaPipe-indexed landmarks from canonical names (round trip with the real frame)', () => {
    const out = landmarksFromPeople(people(REAL_FRAME));
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(33);
    REAL_FRAME.forEach((l, i) => {
      if (MEDIAPIPE_POSE_INDEX[i]) expect(out[0]![i]).toEqual([l[0], l[1], l[2]]);
      else expect(out[0]![i]).toEqual([0, 0, 0]); // dropped points come back invisible
    });
  });

  it('gives missing points visibility 0, handles several people and nobody', () => {
    const partial = { keypoints: [{ name: 'left_hip', x: 0.4, y: 0.5, confidence: 0.9 }] };
    const out = landmarksFromPeople([partial, { keypoints: [] }]);
    expect(out).toHaveLength(2);
    expect(out[0]![23]).toEqual([0.4, 0.5, 0.9]);
    expect(out[0]!.filter((l) => l[2] > 0)).toHaveLength(1);
    expect(out[1]!.every((l) => l[2] === 0)).toBe(true);
    expect(landmarksFromPeople([])).toEqual([]);
  });

  it('ignores unknown names and non-finite points', () => {
    const out = landmarksFromPeople([{ keypoints: [{ name: 'tail', x: 0.1, y: 0.1, confidence: 1 }, { name: 'nose', x: NaN, y: 0.1, confidence: 1 }] }]);
    expect(out[0]!.every((l) => l[2] === 0)).toBe(true);
  });

  it('feeds the page: a person built this way is drawn where the landmarks say', () => {
    const r = rig();
    r.page.setState(state());
    r.page.push(landmarksFromPeople(people(REAL_FRAME)), 1000, 1040, 640, 480);
    r.frame(1100);
    expect(shoulder(r.log)!.x / r.view.cw).toBeCloseTo(X11, 2);
  });
});

describe('skeleton page: config and bundle', () => {
  it('skeletonConfig is JSON-safe, reflects SKELETON_TUNING and the look, and is a fresh copy', () => {
    const c = skeletonConfig();
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(c.tuning).toEqual(SKELETON_TUNING);
    expect(c.render.style).toEqual(SKELETON_STYLE);
    expect(c.render.edges.length).toBeGreaterThan(10);
    c.tuning.governor.windowFrames = 1;
    expect(skeletonConfig().tuning.governor.windowFrames).toBe(SKELETON_TUNING.governor.windowFrames);
  });

  it('the governor follows the config it is given', () => {
    const cfg = skeletonConfig();
    cfg.tuning.governor.windowFrames = 5;
    const r = rig();
    const page = createSkeletonPage(r.env, cfg);
    page.setState(state());
    r.setCost(GOV.minimalDrawMs + 1);
    for (let i = 0; i < 5; i++) {
      r.clock.advance(16);
      r.log.length = 0;
      page.frame();
    }
    expect(page.stats().quality).toBe(0);
  });

  it('evaluates with new Function and with an indirect eval (the engine page uses eval), to a (env, CFG) factory', () => {
    const viaFunction = new Function('return ' + SKELETON_BUNDLE)();
    const viaEval = (0, eval)(SKELETON_BUNDLE);
    expect(typeof viaFunction).toBe('function');
    expect(typeof viaEval).toBe('function');
    const r = rig();
    const page = viaEval(r.env, skeletonConfig()) as SkeletonPage;
    page.setState(state());
    page.push([REAL_FRAME], 1000, 1040, 640, 480);
    r.clock.set(1100);
    page.frame();
    expect(page.stats().draws).toBe(1);
  });

  it('SKELETON_PAGE is a single function expression of its own', () => {
    expect(SKELETON_PAGE.startsWith('function skeletonPage(core, render, env, CFG)')).toBe(true);
    expect(() => new Function('return (' + SKELETON_PAGE + ')')).not.toThrow();
  });

  const bad = String.fromCharCode(0x2028) + '|' + String.fromCharCode(0x2029);
  const forbidden: [string, RegExp][] = [
    ['backtick', /`/],
    ['dollar-brace', /\$\{/],
    ['backslash', /[\\]/],
    ['regex literal', /(^|[=(,:;!&|?{}[]|\breturn)\s*\/[^/*\n]/m],
    ['toString', /\.toString\(\)/],
    ['optional chaining', /\?\./],
    ['nullish coalescing', /\?\?/],
    ['closing script tag', /<\/script/i],
    ['line or paragraph separator', new RegExp(bad)],
    ['shadowBlur', /shadowBlur/],
    ['hex colour', /#[0-9a-fA-F]{3,8}\b/],
    ['object spread', /\{\s*\.\.\./],
  ];
  describe.each([
    ['SKELETON_PAGE', SKELETON_PAGE],
    ['SKELETON_BUNDLE', SKELETON_BUNDLE],
  ])('%s text hygiene', (_name, text) => {
    it.each(forbidden)('contains no %s', (_n, pattern) => {
      expect(text).not.toMatch(pattern);
    });
  });

  it('SKELETON_PAGE is driven only by the times and the env it is given (no clock, no randomness, no timers)', () => {
    expect(SKELETON_PAGE).not.toMatch(/Date|performance|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  });
});
