import { REAL_FRAME, type People } from './skeleton.fixtures';
import { pageScript, poseEngineHtml } from './poseEngineHtml';
import type { SkeletonPalette, SkeletonState } from './skeletonTypes';

/**
 * The phone page's script is source text that runs inside the WebView. These tests evaluate that
 * exact text against fake browser globals (a fake worker the test speaks for, a manual
 * requestAnimationFrame and clock, a canvas that records what is drawn) and check what the app
 * would see: the messages posted to it, and what reaches the canvas.
 */

const COLORS = { good: '#0f0', warn: '#ff0', other: '#f00' };
const PAL: SkeletonPalette = { good: '#E5825A', fix: '#F2B544', warn: '#D9A441', untrackable: '#D2BDA9', other: '#F07A6E', halo: '#17110E', highlight: '#F8ECDF' };
const PAL2: SkeletonPalette = { good: '#11AA11', fix: '#22BB22', warn: '#33CC33', untrackable: '#44DD44', other: '#55EE55', halo: '#0A0A0A', highlight: '#FAFAFA' };
const state = (o: Partial<SkeletonState> = {}): SkeletonState => ({ v: 1, tone: 'good', side: null, chain: [], palette: PAL, reduceMotion: false, ...o });

interface Ev {
  op: string;
  style?: string;
  alpha?: number;
}

/** A 2D context that records every call (fill and stroke with the style and alpha in force). */
function recorder(log: Ev[]) {
  const props: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
  return new Proxy(
    {},
    {
      get(_, key: string) {
        if (key in props) return props[key];
        return () => {
          if (key === 'fill' || key === 'stroke') log.push({ op: key, style: String(key === 'fill' ? props.fillStyle : props.strokeStyle), alpha: Number(props.globalAlpha) });
          else log.push({ op: key });
          return key === 'getImageData' ? { data: new Uint8ClampedArray(32 * 24 * 4) } : undefined;
        };
      },
      set(_, key: string, value) {
        props[key] = value;
        return true;
      },
    },
  );
}

type Msg = Record<string, unknown>;

class FakeWorker {
  static all: FakeWorker[] = [];
  sent: Msg[] = [];
  terminated = false;
  onmessage: ((e: { data: Msg }) => void) | null = null;
  onerror: ((e: object) => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(m: Msg) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
}

interface Boot {
  win: Record<string, unknown> & { formStop(): void; formSkeleton(s: unknown): void };
  posts: Msg[];
  worker: FakeWorker;
  canvas: { width: number; height: number; clientWidth: number; clientHeight: number };
  log: Ev[];
  track: { stop: jest.Mock };
  appended: unknown[];
  video: { currentTime: number };
  /** A camera frame reaching the screen: requestVideoFrameCallback fires with this metadata. */
  vfc(meta?: object): void;
  now(): number;
  queued(): number;
  /** Everything drawn since the last clear. */
  lastDraw(): Ev[];
  /** Runs display frames for ms milliseconds at 16ms steps (the clock moves, queued rAF callbacks run). */
  advance(ms: number): void;
  /** Like advance, with a fresh result every 32ms (a live camera). */
  feed(ms: number): void;
  engine(m: Msg): void;
  result(people: People, ts?: number): void;
  flush(): Promise<void>;
  observers: (() => void)[];
}

/** The engine page's script from the real html, run against the fakes. */
async function boot(o: { before?: SkeletonState; reduce?: boolean; dpr?: number; cw?: number; ch?: number; observe?: boolean; ready?: 'GPU' | 'CPU' | null; html?: string; skeleton?: string; noVfc?: boolean } = {}): Promise<Boot> {
  FakeWorker.all = [];
  const html = o.html ?? poseEngineHtml({ modelUrl: 'https://example.test/pose.task', colors: COLORS });
  let script = /<script>\n([\s\S]*)<\/script>/.exec(html)![1]!;
  // A stand-in skeleton bundle (to watch what the page hands it, or to make it fail).
  if (o.skeleton !== undefined) script = script.replace(/const SKELETON_SRC = .*;\n/, () => `const SKELETON_SRC = ${JSON.stringify(o.skeleton)};\n`);
  let t = 5000;
  let queue: (() => void)[] = [];
  const posts: Msg[] = [];
  const log: Ev[] = [];
  const appended: unknown[] = [];
  const observers: (() => void)[] = [];
  const track = { stop: jest.fn(), addEventListener: jest.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const mainCtx = recorder(log);
  const canvas = { width: 0, height: 0, clientWidth: o.cw ?? 360, clientHeight: o.ch ?? 640, getContext: () => mainCtx };
  const vfcs: ((now: number, meta?: object) => void)[] = [];
  const video: Record<string, unknown> & { currentTime: number } = {
    videoWidth: 640,
    videoHeight: 480,
    readyState: 4,
    currentTime: 0,
    srcObject: null,
    play: () => Promise.resolve(),
    requestVideoFrameCallback: o.noVfc ? undefined : (cb: (now: number, meta?: object) => void) => vfcs.push(cb),
  };
  const document = {
    getElementById: (id: string) => (id === 'v' ? video : canvas),
    createElement: (tag: string) => (tag === 'canvas' ? { width: 0, height: 0, getContext: () => recorder([]) } : { tag }),
    head: { appendChild: (n: unknown) => appended.push(n) },
    style: {},
  };
  const win: Record<string, unknown> = {
    devicePixelRatio: o.dpr ?? 2,
    matchMedia: () => ({ matches: !!o.reduce }),
    ReactNativeWebView: { postMessage: (s: string) => posts.push(JSON.parse(s) as Msg) },
  };
  if (o.before) win.__formSkeleton = o.before;
  const RO =
    o.observe === false
      ? undefined
      : class {
          constructor(cb: () => void) {
            observers.push(cb);
          }
          observe() {}
        };
  const run = new Function(
    'window',
    'document',
    'navigator',
    'Worker',
    'Blob',
    'URL',
    'createImageBitmap',
    'requestAnimationFrame',
    'performance',
    'ResizeObserver',
    script,
  );
  run(
    win,
    document,
    { mediaDevices: { getUserMedia: () => Promise.resolve(stream) }, onLine: true },
    FakeWorker,
    class {},
    { createObjectURL: () => 'blob:engine' },
    () => Promise.resolve({ close: () => undefined }),
    (cb: () => void) => queue.push(cb),
    { now: () => t },
    RO,
  );
  const worker = FakeWorker.all[0]!;
  const b: Boot = {
    win: win as Boot['win'],
    posts,
    worker,
    canvas,
    log,
    track,
    appended,
    observers,
    video,
    vfc: (meta) => {
      video.currentTime += 1;
      const cb = vfcs.pop();
      if (cb) cb(t, meta);
    },
    now: () => t,
    queued: () => queue.length,
    lastDraw: () => {
      const i = log.map((e) => e.op).lastIndexOf('clearRect');
      return log.slice(i + 1);
    },
    advance: (ms) => {
      for (let el = 0; el < ms; el += 16) {
        t += 16;
        const q = queue;
        queue = [];
        q.forEach((cb) => cb());
      }
    },
    feed: (ms) => {
      for (let el = 0; el < ms; el += 32) {
        b.engine({ type: 'result', ts: t, people: [REAL_FRAME], ms: 20 });
        b.advance(32);
      }
    },
    engine: (m) => worker.onmessage!({ data: m }),
    result: (people, ts) => b.engine({ type: 'result', ts: ts ?? t, people, ms: 20 }),
    flush: async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    },
  };
  await b.flush();
  if (o.ready !== null) b.engine({ type: 'ready', backend: o.ready ?? 'GPU' });
  await b.flush();
  return b;
}

const colorsDrawn = (evs: Ev[]) => new Set(evs.filter((e) => e.op === 'stroke' || e.op === 'fill').map((e) => e.style));
const drawn = (evs: Ev[]) => evs.filter((e) => e.op === 'stroke' || e.op === 'fill').length;
const kinds = (b: Boot, k: string) => b.posts.filter((p) => p.t === 'pose' && p.kind === k);

describe('the phone page: camera and engine messages', () => {
  it('posts camera live, then pumps frames to the engine once it is ready', async () => {
    const b = await boot({ ready: null });
    expect(b.posts.some((p) => p.t === 'camera' && p.kind === 'requesting')).toBe(true);
    expect(b.posts.some((p) => p.t === 'camera' && p.kind === 'live')).toBe(true);
    expect(b.worker.sent[0]).toEqual({ type: 'init' });
    // No frames before the model is ready.
    expect(b.worker.sent.filter((m) => m.type === 'frame')).toHaveLength(0);
    b.engine({ type: 'ready', backend: 'GPU' });
    await b.flush();
    expect(kinds(b, 'ready')).toEqual([{ t: 'pose', kind: 'ready', backend: 'GPU' }]);
    expect(b.worker.sent.filter((m) => m.type === 'frame')).toHaveLength(1);
  });

  it('still posts the loading progress, and forwards the model variant', async () => {
    const b = await boot({ ready: null });
    b.engine({ type: 'progress', stage: 'model', pct: 40 });
    expect(b.posts).toContainEqual({ t: 'pose', kind: 'loading', stage: 'model', pct: 40 });
    b.engine({ type: 'model', variant: 'lite' });
    expect(b.posts).toContainEqual({ t: 'pose', kind: 'model', variant: 'lite' });
  });

  it('posts the raw people to the app unchanged, in the same frame message as before', async () => {
    const b = await boot();
    const people: People = [REAL_FRAME.map((l) => [...l] as [number, number, number])];
    b.result(people, 1234);
    const frame = b.posts.find((p) => p.t === 'frame')!;
    expect(frame).toEqual({ t: 'frame', ts: 1234, w: 640, h: 480, ms: 20, b: 0, people });
    expect(Object.keys(frame)).toEqual(['t', 'ts', 'w', 'h', 'ms', 'b', 'people']);
    // And the next camera frame goes out for the next result.
    await b.flush();
    expect(b.worker.sent.filter((m) => m.type === 'frame').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the phone page: the skeleton on the canvas', () => {
  it('draws a result on the canvas, in palette colours only', async () => {
    const b = await boot();
    b.engine({ type: 'result', ts: 1, people: [REAL_FRAME], ms: 20 });
    b.advance(400);
    const d = b.lastDraw();
    expect(drawn(d)).toBeGreaterThan(10);
    // The default state is the colours the page was given (tone: good, as the tracker starts), plus the Evening halo and highlight.
    const cfg = JSON.parse(/const CFG = (.*);\n/.exec(poseEngineHtml({ modelUrl: 'https://example.test/pose.task', colors: COLORS }))![1]!) as { skeletonState: SkeletonState };
    const palette = new Set(Object.values(cfg.skeletonState.palette));
    for (const style of colorsDrawn(d)) expect(palette.has(style!)).toBe(true);
    expect(colorsDrawn(d).has(COLORS.good)).toBe(true);
  });

  it('draws nothing before the first result', async () => {
    const b = await boot();
    b.advance(200);
    expect(drawn(b.lastDraw())).toBe(0);
  });

  it('formSkeleton changes the colours of the next draw', async () => {
    const b = await boot();
    b.result([REAL_FRAME]);
    b.advance(400);
    expect(colorsDrawn(b.lastDraw()).has(COLORS.good)).toBe(true);
    b.win.formSkeleton(state({ tone: 'good', palette: PAL }));
    b.feed(500);
    const d = colorsDrawn(b.lastDraw());
    expect(d.has(PAL.good)).toBe(true);
    expect(d.has(COLORS.good)).toBe(false);
    b.win.formSkeleton(state({ tone: 'fix', palette: PAL2 }));
    b.feed(500);
    const d2 = colorsDrawn(b.lastDraw());
    expect(d2.has(PAL2.fix)).toBe(true);
    expect(d2.has(PAL.good)).toBe(false);
  });

  it('ignores a malformed state and keeps the previous look', async () => {
    const b = await boot();
    b.result([REAL_FRAME]);
    b.win.formSkeleton({ v: 2 });
    b.win.formSkeleton(null);
    b.advance(400);
    expect(colorsDrawn(b.lastDraw()).has(COLORS.good)).toBe(true);
  });

  it('applies a state the app injected before the page script ran', async () => {
    const b = await boot({ before: state({ tone: 'fix', palette: PAL2 }) });
    b.result([REAL_FRAME]);
    b.advance(400);
    const d = colorsDrawn(b.lastDraw());
    expect(d.has(PAL2.fix)).toBe(true);
    expect(d.has(COLORS.good)).toBe(false);
  });

  it('changes tone at once when the phone asks for reduced motion', async () => {
    const b = await boot({ reduce: true });
    b.result([REAL_FRAME]);
    b.feed(400);
    b.win.formSkeleton(state({ tone: 'fix', palette: PAL2, reduceMotion: true }));
    b.feed(32);
    const d = colorsDrawn(b.lastDraw());
    expect(d.has(PAL2.fix)).toBe(true);
    expect(d.has(COLORS.good)).toBe(false);
  });

  it('draws the full look on the GPU, and never the glow in the page-run fallback or on the CPU', async () => {
    const chain = state({ side: 'left', chain: [23, 25, 27], palette: PAL });
    const glow = async (b: Boot) => {
      b.win.formSkeleton(chain);
      b.result([REAL_FRAME]);
      b.advance(600);
      return b.log.filter((e) => e.op === 'drawImage').length;
    };
    expect(await glow(await boot())).toBeGreaterThan(0);

    // The worker fails before the model is ready: the page runs the model itself (and says it is slow).
    const inline = await boot({ ready: null });
    inline.worker.onerror!({});
    expect(inline.appended).toHaveLength(1);
    inline.engine({ type: 'ready', backend: 'GPU' });
    expect(await glow(inline)).toBe(0);

    // A CPU backend, from the start or after a later verdict, is capped the same way.
    expect(await glow(await boot({ ready: 'CPU' }))).toBe(0);
    const late = await boot();
    late.engine({ type: 'backend', backend: 'CPU', ms: 50 });
    expect(await glow(late)).toBe(0);
  });
});

describe('the phone page: stalls and stopping', () => {
  it('does not freeze the skeleton when results stop (a hung worker)', async () => {
    const b = await boot();
    for (let i = 0; i < 10; i++) {
      b.result([REAL_FRAME]);
      b.advance(32);
    }
    expect(drawn(b.lastDraw())).toBeGreaterThan(10);
    // Then silence: held at first, gone well before a second has passed.
    b.advance(100);
    expect(drawn(b.lastDraw())).toBeGreaterThan(10);
    b.advance(1200);
    expect(drawn(b.lastDraw())).toBe(0);
    // A result after the stall brings it back.
    b.result([REAL_FRAME]);
    b.advance(400);
    expect(drawn(b.lastDraw())).toBeGreaterThan(10);
  });

  it('shows nothing when a result has nobody in it', async () => {
    const b = await boot();
    b.result([REAL_FRAME]);
    b.advance(300);
    for (let i = 0; i < 40; i++) {
      b.result([]);
      b.advance(32);
    }
    expect(drawn(b.lastDraw())).toBe(0);
  });

  it('formStop clears the canvas, stops the camera and the model, and ends the loop', async () => {
    const b = await boot();
    b.result([REAL_FRAME]);
    b.advance(300);
    expect(drawn(b.lastDraw())).toBeGreaterThan(10);
    b.win.formStop();
    expect(b.track.stop).toHaveBeenCalled();
    expect(b.worker.terminated).toBe(true);
    expect(b.log.at(-1)!.op).toBe('clearRect');
    expect(drawn(b.lastDraw())).toBe(0);
    const before = b.log.length;
    b.advance(200);
    expect(b.log.length).toBe(before);
    expect(b.queued()).toBe(0);
    // A late result is ignored: nothing posted, nothing drawn.
    const posted = b.posts.length;
    b.result([REAL_FRAME]);
    b.advance(100);
    expect(b.posts.length).toBe(posted);
    expect(b.log.length).toBe(before);
  });
});

describe('the phone page: canvas size', () => {
  it('backs the canvas at the view size times the pixel ratio (at most 2)', async () => {
    const b = await boot({ dpr: 3, cw: 360, ch: 640 });
    b.result([REAL_FRAME]);
    b.advance(32);
    expect(b.canvas.width).toBe(720);
    expect(b.canvas.height).toBe(1280);
    const c = await boot({ dpr: 1.5, cw: 360, ch: 640 });
    c.result([REAL_FRAME]);
    c.advance(32);
    expect(c.canvas.width).toBe(540);
    expect(c.canvas.height).toBe(960);
  });

  it('re-reads the view size every frame when there is no ResizeObserver', async () => {
    const b = await boot({ dpr: 2, observe: false });
    b.result([REAL_FRAME]);
    b.advance(32);
    expect(b.canvas.width).toBe(720);
    b.canvas.clientWidth = 400;
    b.advance(32);
    expect(b.canvas.width).toBe(800);
  });

  it('uses the cached size, updated by the ResizeObserver, when there is one', async () => {
    const b = await boot({ dpr: 2 });
    b.result([REAL_FRAME]);
    b.advance(32);
    expect(b.canvas.width).toBe(720);
    b.canvas.clientWidth = 400;
    b.advance(32);
    expect(b.canvas.width).toBe(720);
    b.observers.forEach((cb) => cb());
    b.advance(32);
    expect(b.canvas.width).toBe(800);
  });
});

/** A stand-in skeleton bundle: records its calls in globalThis.__spy, and throws from every method if asked to. */
const spyBundle = (opts: { throws?: boolean } = {}) =>
  `(function(){var g=globalThis;g.__spy={calls:[],pushes:[]};return function(env,cfg){function m(n){return function(a,b,c){g.__spy.calls.push(n);if(n==='push')g.__spy.pushes.push([b,c]);if(${opts.throws ? 'true' : 'false'})throw new Error(n);};}return {push:m('push'),setState:m('setState'),setBackend:m('setBackend'),setInline:m('setInline'),start:m('start'),stop:m('stop'),frame:m('frame'),stats:m('stats')};};})()`;
const spy = () => (globalThis as unknown as { __spy: { calls: string[]; pushes: [number, number][] } }).__spy;
const sentFrames = (b: Boot) => b.worker.sent.filter((m) => m.type === 'frame');

describe('the phone page: a skeleton fault never stops the camera or the rep counting', () => {
  const FAULTS: [string, string][] = [
    ['a bundle that throws when it is evaluated', '(function(){throw new Error("bundle broke");})()'],
    ['a factory that throws when it is called', '(function(){return function(){throw new Error("factory broke");};})()'],
    ['a skeleton whose every method throws', spyBundle({ throws: true })],
  ];

  it.each(FAULTS)('%s: the camera goes live, frames flow and the raw landmarks still reach the app', async (_name, skeleton) => {
    const b = await boot({ skeleton });
    expect(b.posts.some((p) => p.t === 'camera' && p.kind === 'live')).toBe(true);
    expect(kinds(b, 'ready')).toEqual([{ t: 'pose', kind: 'ready', backend: 'GPU' }]);
    expect(sentFrames(b)).toHaveLength(1);
    const people: People = [REAL_FRAME.map((l) => [...l] as [number, number, number])];
    b.result(people, 1234);
    expect(b.posts.find((p) => p.t === 'frame')).toEqual({ t: 'frame', ts: 1234, w: 640, h: 480, ms: 20, b: 0, people });
    await b.flush();
    expect(sentFrames(b)).toHaveLength(2);
    // The rest of the page's calls into the skeleton are harmless too.
    b.win.formSkeleton(state({ tone: 'fix', palette: PAL2 }));
    b.win.formSkeleton(null);
    b.engine({ type: 'backend', backend: 'CPU', ms: 50 });
    expect(kinds(b, 'ready')).toHaveLength(2);
    b.engine({ type: 'model', variant: 'lite' });
    b.advance(200);
    b.feed(200);
    expect(b.posts.filter((p) => p.t === 'frame').length).toBeGreaterThan(3);
  });

  it.each(FAULTS)('%s: formStop still clears the canvas and stops the camera and the model', async (_name, skeleton) => {
    const b = await boot({ skeleton });
    b.result([REAL_FRAME]);
    b.advance(100);
    b.win.formStop();
    expect(b.track.stop).toHaveBeenCalled();
    expect(b.worker.terminated).toBe(true);
    expect(b.log.at(-1)!.op).toBe('clearRect');
    const posted = b.posts.length;
    b.result([REAL_FRAME]);
    expect(b.posts.length).toBe(posted);
  });

  it('a skeleton whose methods throw is called, not skipped (the faults are swallowed, not avoided)', async () => {
    const b = await boot({ skeleton: spyBundle({ throws: true }) });
    b.result([REAL_FRAME]);
    b.win.formSkeleton(state());
    b.win.formStop();
    expect(spy().calls).toEqual(expect.arrayContaining(['setBackend', 'setState', 'push', 'start', 'stop']));
  });
});

describe('the phone page: when a frame was captured', () => {
  it('sends the capture time next to ts, which stays the engine timeline', async () => {
    const b = await boot({ skeleton: spyBundle() });
    const f1 = sentFrames(b)[0]!;
    // No camera metadata yet: the capture time is the time the frame was taken from the video.
    expect(f1.cap).toBe(f1.ts);
    expect(f1.ts).toBe(b.now());
  });

  it('hands the skeleton the camera capture time from requestVideoFrameCallback, not the arrival time', async () => {
    const b = await boot({ skeleton: spyBundle() });
    const f1 = sentFrames(b)[0]!;
    b.advance(48);
    const captured = b.now() - 40;
    b.vfc({ captureTime: captured, expectedDisplayTime: b.now() + 8, presentationTime: b.now() });
    // The first result belongs to the frame sent before any metadata.
    b.result([REAL_FRAME], f1.ts as number);
    expect(spy().pushes.at(-1)![0]).toBe(f1.cap);
    await b.flush();
    const f2 = sentFrames(b)[1]!;
    expect(f2.cap).toBe(captured);
    expect(f2.ts).toBe(b.now());
    b.advance(32);
    b.result([REAL_FRAME], f2.ts as number);
    expect(spy().pushes.at(-1)![0]).toBe(captured);
    // The raw message to the app still carries ts as before.
    expect(b.posts.filter((p) => p.t === 'frame').at(-1)!.ts).toBe(f2.ts);
  });

  it.each([
    ['captureTime', (n: number) => ({ captureTime: n - 30, expectedDisplayTime: n + 5, presentationTime: n - 1 }), (n: number) => n - 30],
    ['expectedDisplayTime without captureTime, never later than now', (n: number) => ({ expectedDisplayTime: n + 500 }), (n: number) => n],
    ['presentationTime when that is all there is', (n: number) => ({ presentationTime: n - 12 }), (n: number) => n - 12],
    ['the arrival time when the metadata has nothing usable', () => ({ width: 640 }), (n: number) => n],
  ])('uses %s', async (_name, meta, want) => {
    const b = await boot({ skeleton: spyBundle() });
    const f1 = sentFrames(b)[0]!;
    b.advance(48);
    b.vfc(meta(b.now()));
    b.result([REAL_FRAME], f1.ts as number);
    await b.flush();
    const f2 = sentFrames(b)[1]!;
    expect(f2.cap).toBe(want(b.now()));
    expect(f2.cap as number).toBeLessThanOrEqual(f2.ts as number);
  });

  it('keeps working without requestVideoFrameCallback (timer fallback, no metadata: performance.now)', async () => {
    const b = await boot({ skeleton: spyBundle(), noVfc: true });
    try {
      const f1 = sentFrames(b)[0]!;
      expect(f1.cap).toBe(f1.ts);
      b.result([REAL_FRAME], f1.ts as number);
      expect(spy().pushes.at(-1)![0]).toBe(f1.ts);
      await b.flush();
      expect(sentFrames(b)).toHaveLength(2);
    } finally {
      b.win.formStop();
    }
  });
});

describe('the phone page: text hygiene', () => {
  const html = poseEngineHtml({ modelUrl: 'https://example.test/pose.task', colors: COLORS });
  const cfgJson = /const CFG = (.*);\n/.exec(html)![1]!;

  it('is one script that holds the page script, with the settings on one line', () => {
    expect(html.split('</script').length - 1).toBe(1);
    expect(html).toContain(pageScript(cfgJson));
    const cfg = JSON.parse(cfgJson) as { skeleton: { tuning: unknown; render: unknown }; skeletonState: SkeletonState };
    expect(cfg.skeleton.tuning).toBeDefined();
    expect(cfg.skeleton.render).toBeDefined();
    expect(cfg.skeletonState.palette.warn).toBe(COLORS.warn);
    expect(cfg.skeletonState.palette.good).toBe(COLORS.good);
    expect(cfg.skeletonState.palette.other).toBe(COLORS.other);
  });

  it('has nothing that breaks the html or Hermes', () => {
    const script = pageScript(cfgJson);
    expect(script).not.toContain('</script');
    expect(script).not.toContain('.toString()');
    expect(html).not.toContain('.toString()');
    expect(html).not.toContain(String.fromCharCode(0x2028));
    expect(html).not.toContain(String.fromCharCode(0x2029));
    expect(script).not.toContain('shadowBlur');
    // The old drawing code is gone: no One Euro filter, no glide, no own draw loop.
    expect(script).not.toContain('smoothInto');
    expect(script).not.toContain('MIN_CUTOFF');
    expect(script).not.toContain('function draw(');
    // The legacy one-colour line stays for older callers, but is no longer used to draw.
    expect(script).toContain('window.__skeletonColor = CFG.colors.warn;');
    expect(script.split('window.__skeletonColor').length - 1).toBe(1);
  });

  it('keeps the video mirrored and the skeleton canvas plain (the mapper does the mirroring)', () => {
    const style = /<style>(.*)<\/style>/.exec(html)![1]!;
    expect(style).toContain('canvas{position:absolute;inset:0;width:100%;height:100%}');
    expect(style).toContain('video{object-fit:cover;transform:scaleX(-1)}');
    expect(style.split('video{')[0]).not.toMatch(/object-fit|scaleX/);
  });

  it('compiles on its own as a function body', () => {
    expect(() => new Function('window', 'document', pageScript(cfgJson))).not.toThrow();
  });
});
