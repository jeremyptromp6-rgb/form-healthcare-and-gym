import type { Scene } from './skeletonTypes';

/**
 * Test helpers for the skeleton tracker: a real MediaPipe frame, seeded noise, motion
 * generators, a fake clock, a simulation loop that mimics the engine (results at a fixed rate,
 * each arriving late) and the page (a display frame at a fixed rate), and the OLD smoothing
 * pipeline (One Euro plus a glide) as plain TypeScript for before/after comparisons.
 */

export type Landmark = [number, number, number];
export type People = Landmark[][];

/** Real output of the engine's MediaPipe build for a side-on mini squat (camera.test.tsx). */
export const REAL_FRAME: Landmark[] = [[0.4703,0.2144,0.9989],[0.4771,0.2007,0.9984],[0.4791,0.2005,0.9983],[0.4813,0.2003,0.9986],[0.4757,0.2009,0.9975],[0.4766,0.2006,0.997],[0.4779,0.2003,0.9976],[0.498,0.2084,0.9966],[0.4938,0.207,0.9946],[0.4749,0.2288,0.9976],[0.4733,0.2285,0.9966],[0.513,0.298,0.9999],[0.5024,0.2941,0.9993],[0.5151,0.4211,0.9925],[0.5087,0.4205,0.0582],[0.5119,0.5413,0.9561],[0.5091,0.5293,0.1045],[0.5131,0.5717,0.9166],[0.5071,0.5604,0.1146],[0.5108,0.5717,0.9167],[0.5089,0.5615,0.1178],[0.5102,0.5636,0.8926],[0.5087,0.5481,0.1184],[0.505,0.5151,0.9997],[0.5003,0.5073,0.9996],[0.4735,0.6567,0.9135],[0.4771,0.6463,0.4294],[0.5058,0.8123,0.9041],[0.5012,0.7913,0.6192],[0.5197,0.8412,0.8229],[0.5166,0.82,0.6584],[0.4559,0.8447,0.8808],[0.4566,0.8199,0.6863]];

/** Joints of REAL_FRAME that are clearly visible (visibility at least 0.85). */
export const VISIBLE_JOINTS = REAL_FRAME.flatMap((l, i) => (l[2] >= 0.85 ? [i] : []));

/** Deterministic random numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal numbers from a uniform source (Box-Muller). */
export function gaussian(rng: () => number): () => number {
  return () => {
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

export function createFakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
      return t;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

/** Motion generators: offset (in normalised units) as a function of time in ms. */
export const sinusoid = (amp: number, hz: number) => (tMs: number) => amp * Math.sin(2 * Math.PI * hz * (tMs / 1000));
/** Triangle wave with the given peak amplitude, period in ms, starting at 0 and moving up. */
export const triangle = (amp: number, periodMs: number) => (tMs: number) => {
  const p = (((tMs / periodMs) % 1) + 1) % 1;
  return amp * (p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4);
};
/** Constant velocity (units per second) starting at tMs = from, standing still before. */
export const ramp = (perS: number, from = 0) => (tMs: number) => (tMs > from ? (perS * (tMs - from)) / 1000 : 0);

/** A person built from `base`, every joint shifted. */
export function shifted(base: Landmark[], dx: number, dy = 0): Landmark[] {
  return base.map((l) => [l[0] + dx, l[1] + dy, l[2]] as Landmark);
}

/** A copy of `base` with some joints replaced. */
export function withJoints(base: Landmark[], over: Record<number, Landmark>): Landmark[] {
  return base.map((l, i) => over[i] ?? l);
}

/** The people list of one result with no one in it. */
export const NOBODY: People = [];

export interface BankLike {
  push(people: People, captureMs: number, arriveMs: number, vw: number, vh: number): void;
  step(nowMs: number): Scene;
  latency(): number;
  reset(): void;
}

export interface SimOptions {
  bank: BankLike;
  /** Display times run from startMs to startMs + durationMs. */
  startMs?: number;
  durationMs: number;
  resultHz?: number;
  latencyMs?: number;
  displayHz?: number;
  vw?: number;
  vh?: number;
  /** What the model returns for the frame captured at captureMs. */
  results: (captureMs: number) => People;
  /** Called after each display frame. */
  onStep?: (tMs: number, scene: Scene) => void;
  /** Results for which this returns true never arrive. */
  lost?: (captureMs: number) => boolean;
}

/**
 * Runs the engine-and-page loop against a bank: results are captured at resultHz, arrive
 * latencyMs later (in order), and a display frame runs at displayHz. Within the same instant a
 * result is pushed before the frame is drawn.
 */
export function runSim(o: SimOptions): void {
  const start = o.startMs ?? 1000;
  const resultMs = 1000 / (o.resultHz ?? 30);
  const latency = o.latencyMs ?? 45;
  const frameMs = 1000 / (o.displayHz ?? 60);
  const vw = o.vw ?? 640;
  const vh = o.vh ?? 480;
  let k = 0;
  const end = start + o.durationMs;
  for (let j = 0; ; j++) {
    const t = start + j * frameMs;
    if (t > end) break;
    for (;;) {
      const capture = start - 200 + k * resultMs;
      if (capture + latency > t) break;
      k++;
      if (o.lost?.(capture)) continue;
      o.bank.push(o.results(capture), capture, capture + latency, vw, vh);
    }
    const scene = o.bank.step(t);
    o.onStep?.(t, scene);
  }
}

export function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
}
export function std(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) * (v - m))));
}
export function rms(a: number[]): number {
  return Math.sqrt(mean(a.map((v) => v * v)));
}

/**
 * The OLD smoothing pipeline, as it was in the engine page: a One Euro filter on every result
 * (minCutoff 1.5, beta 10, dCutoff 1), then a 30 ms exponential glide to it on every display frame.
 * x and y are normalised, joints are [x, y, vis].
 */
export class OldPipeline {
  private filters: { x: number; y: number; dx: number; dy: number }[][] = [];
  private targets: Landmark[][] = [];
  private shown: Landmark[][] = [];
  private lastResultTs = 0;
  private lastDraw = 0;
  private static readonly MIN_CUTOFF = 1.5;
  private static readonly BETA = 10;
  private static readonly D_CUTOFF = 1;

  private static alpha(cutoff: number, dt: number) {
    return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  }

  push(people: People, captureMs: number): void {
    const ts = captureMs;
    const dt = this.lastResultTs ? Math.max(0.001, (ts - this.lastResultTs) / 1000) : 1 / 30;
    this.lastResultTs = ts;
    this.targets = people.map((p, pi) => {
      const f = this.filters[pi] || (this.filters[pi] = []);
      return p.map((k, ki) => {
        const s = f[ki];
        if (!s) {
          f[ki] = { x: k[0], y: k[1], dx: 0, dy: 0 };
          return [k[0], k[1], k[2]] as Landmark;
        }
        const dx = (k[0] - s.x) / dt;
        const dy = (k[1] - s.y) / dt;
        const ad = OldPipeline.alpha(OldPipeline.D_CUTOFF, dt);
        s.dx = s.dx + ad * (dx - s.dx);
        s.dy = s.dy + ad * (dy - s.dy);
        const ax = OldPipeline.alpha(OldPipeline.MIN_CUTOFF + OldPipeline.BETA * Math.abs(s.dx), dt);
        const ay = OldPipeline.alpha(OldPipeline.MIN_CUTOFF + OldPipeline.BETA * Math.abs(s.dy), dt);
        s.x = s.x + ax * (k[0] - s.x);
        s.y = s.y + ay * (k[1] - s.y);
        return [s.x, s.y, k[2]] as Landmark;
      });
    });
    this.filters.length = people.length;
  }

  step(nowMs: number): Landmark[][] {
    const dt = this.lastDraw ? Math.min(100, nowMs - this.lastDraw) : 16;
    this.lastDraw = nowMs;
    const k = 1 - Math.exp(-dt / 30);
    this.shown = this.targets.map((p, pi) =>
      p.map((t, ki) => {
        const s = this.shown[pi] && this.shown[pi][ki];
        return s ? ([s[0] + (t[0] - s[0]) * k, s[1] + (t[1] - s[1]) * k, t[2]] as Landmark) : t;
      }),
    );
    return this.shown;
  }
}

/** Runs the old pipeline through the same simulation loop as runSim. */
export function runOldSim(old: OldPipeline, o: Omit<SimOptions, 'bank' | 'onStep'> & { onStep: (tMs: number, shown: Landmark[][]) => void }): void {
  const start = o.startMs ?? 1000;
  const resultMs = 1000 / (o.resultHz ?? 30);
  const latency = o.latencyMs ?? 45;
  const frameMs = 1000 / (o.displayHz ?? 60);
  let k = 0;
  const end = start + o.durationMs;
  for (let j = 0; ; j++) {
    const t = start + j * frameMs;
    if (t > end) break;
    for (;;) {
      const capture = start - 200 + k * resultMs;
      if (capture + latency > t) break;
      k++;
      if (o.lost?.(capture)) continue;
      old.push(o.results(capture), capture);
    }
    o.onStep(t, old.step(t));
  }
}
