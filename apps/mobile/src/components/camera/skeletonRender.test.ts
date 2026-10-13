import { MEDIAPIPE_POSE_INDEX, SKELETON_EDGES } from '@form/domain';
import { SKELETON_BONES, SKELETON_RENDER, SKELETON_STYLE } from './skeletonRender';
import type { RenderFrame, RenderPerson, SkeletonPalette, SkeletonState, SkeletonTone } from './skeletonTypes';

/**
 * SKELETON_RENDER is source text that runs inside the camera page. These tests evaluate that exact
 * text against a recording fake 2D context: nothing here knows how the renderer is written, only
 * what it draws (colours, order, widths, dimming, transitions, quality levels).
 */

const PAL: SkeletonPalette = { good: '#E5825A', fix: '#F2B544', warn: '#D9A441', untrackable: '#D2BDA9', other: '#F07A6E', halo: '#17110E', highlight: '#F8ECDF' };
const PALETTE_VALUES = new Set(Object.values(PAL));
const W = 300;
const H = 533;

interface Call {
  kind: 'fill' | 'stroke';
  style: string;
  alpha: number;
  width: number;
  path: { op: string; args: number[] }[];
}

/** A fake CanvasRenderingContext2D that records every call and every property set. */
function recorder() {
  const calls: Call[] = [];
  const sets: { k: string; v: unknown }[] = [];
  const other: { op: string; args: unknown[] }[] = [];
  const stops: unknown[] = [];
  const arcCalls: { x: number; y: number; r: number }[] = [];
  const props: Record<string, unknown> = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1 };
  let path: Call['path'] = [];
  const ctx = new Proxy(
    {},
    {
      get(_, key: string) {
        if (key in props) return props[key];
        return (...args: unknown[]) => {
          if (key === 'beginPath') path = [];
          else if (key === 'moveTo' || key === 'lineTo' || key === 'arc' || key === 'closePath') {
            path.push({ op: key, args: args as number[] });
            if (key === 'arc') arcCalls.push({ x: args[0] as number, y: args[1] as number, r: args[2] as number });
          }
          else if (key === 'fill' || key === 'stroke') {
            calls.push({ kind: key, style: String(key === 'fill' ? props.fillStyle : props.strokeStyle), alpha: Number(props.globalAlpha), width: Number(props.lineWidth), path: path.slice() });
          } else if (key === 'createRadialGradient' || key === 'createLinearGradient') {
            return { addColorStop: (_o: number, c: string) => stops.push(c) };
          } else other.push({ op: key, args });
        };
      },
      set(_, key: string, v) {
        props[key] = v;
        sets.push({ k: key, v });
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, sets, other, stops, arcCalls, reset: () => (calls.length = other.length = arcCalls.length = 0) };
}

type Rec = ReturnType<typeof recorder>;

// ---- a front-on figure in screen px, built from MediaPipe indices ------------------------------------
const FRONT: Record<number, [number, number]> = {
  0: [0.5, 0.2], 2: [0.52, 0.185], 5: [0.48, 0.185], 7: [0.555, 0.2], 8: [0.445, 0.2],
  11: [0.6, 0.29], 12: [0.4, 0.29], 13: [0.67, 0.4], 14: [0.33, 0.4], 15: [0.7, 0.51], 16: [0.3, 0.51],
  19: [0.74, 0.56], 20: [0.26, 0.56], 23: [0.565, 0.53], 24: [0.435, 0.53], 25: [0.585, 0.69], 26: [0.415, 0.69],
  27: [0.595, 0.86], 28: [0.405, 0.86], 29: [0.595, 0.945], 30: [0.405, 0.945], 31: [0.64, 0.9], 32: [0.36, 0.9],
};

function person(over: { primary?: boolean; pa?: number; scale?: number; ox?: number; oy?: number; hide?: number[] } = {}): RenderPerson {
  const x = new Float32Array(33);
  const y = new Float32Array(33);
  const a = new Float32Array(33);
  const s = over.scale ?? 1;
  for (const [i, [nx, ny]] of Object.entries(FRONT)) {
    const k = Number(i);
    x[k] = (nx - 0.5) * W * s + W / 2 + (over.ox ?? 0);
    y[k] = (ny - 0.5) * H * s + H / 2 + (over.oy ?? 0);
    a[k] = over.hide?.includes(k) ? 0 : 1;
  }
  return { x, y, a, pa: over.pa ?? 1, primary: over.primary ?? true };
}

const frame = (...people: RenderPerson[]): RenderFrame => ({ w: W, h: H, n: 33, people });

const state = (o: Partial<SkeletonState> = {}): SkeletonState => ({ v: 1, tone: 'good', side: null, chain: [], palette: PAL, reduceMotion: false, ...o });

type Factory = (cfg: object) => { create(env: unknown): { setState(s: SkeletonState, now: number): void; setQuality(q: number): void; draw(ctx: unknown, f: RenderFrame, now: number): void; clear(ctx: unknown, w: number, h: number): void } };
const factory = new Function(`return ${SKELETON_RENDER}`)() as Factory;

function harness(q: 0 | 1 | 2 = 2) {
  const main = recorder();
  const sprites: Rec[] = [];
  const created: unknown[] = [];
  const env = {
    createCanvas: (w: number, h: number) => {
      const r = recorder();
      sprites.push(r);
      const cv = { width: w, height: h, getContext: () => r.ctx };
      created.push(cv);
      return cv;
    },
  };
  const r = factory({}).create(env);
  r.setQuality(q);
  const run = (f: RenderFrame, from: number, to: number, step = 33) => {
    for (let t = from; t <= to; t += step) r.draw(main.ctx, f, t);
  };
  return { r, main, sprites, created, run };
}

// ---- geometry helpers over the recorded calls ----------------------------------------------------------
type Pt = { x: number; y: number };
const pts = (c: Call): Pt[] => c.path.filter((p) => p.op === 'moveTo' || p.op === 'lineTo').map((p) => ({ x: p.args[0]!, y: p.args[1]! }));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const joint = (p: RenderPerson, i: number): Pt => ({ x: p.x[i]!, y: p.y[i]! });
const isQuad = (c: Call) => c.path.length === 5 && c.path[4]!.op === 'closePath';

/** The filled trapezoid of a bone a→b in a colour, with its width at each end. */
function bone(calls: Call[], p: RenderPerson, a: number, b: number, style: string) {
  for (const c of calls) {
    if (c.kind !== 'fill' || c.style !== style || !isQuad(c)) continue;
    const v = pts(c);
    if (dist(mid(v[0]!, v[3]!), joint(p, a)) < 0.6 && dist(mid(v[1]!, v[2]!), joint(p, b)) < 0.6) return { wA: dist(v[0]!, v[3]!), wB: dist(v[1]!, v[2]!), alpha: c.alpha };
  }
  return null;
}

const arcs = (c: Call) => c.path.filter((p) => p.op === 'arc').map((p) => ({ x: p.args[0]!, y: p.args[1]!, r: p.args[2]! }));
/** Radius of the core disc (filled, in a colour) centred on a joint. */
function disc(calls: Call[], p: RenderPerson, i: number, style: string): number | null {
  for (const c of calls) {
    if (c.kind !== 'fill' || c.style !== style) continue;
    for (const a of arcs(c)) if (dist(a, joint(p, i)) < 0.6) return a.r;
  }
  return null;
}

/** Arc calls centred on the face (the head circle), not the joints or rings around the body. */
function headArcs(rec: Rec, p: RenderPerson) {
  const face = [0, 2, 5, 7, 8].map((i) => joint(p, i));
  const c = { x: face.reduce((s, q) => s + q.x, 0) / face.length, y: face.reduce((s, q) => s + q.y, 0) / face.length };
  return rec.arcCalls.filter((a) => dist(a, c) < 25);
}

const toneCalls = (calls: Call[], tone: SkeletonTone) => calls.filter((c) => c.style === PAL[tone]);

describe('skeleton renderer text', () => {
  it('is plain ES2017 source with none of the banned constructs', () => {
    const t = SKELETON_RENDER;
    expect(() => new Function(`return ${t}`)()).not.toThrow();
    expect(t).not.toContain('`');
    expect(t).not.toContain('${');
    expect(t).not.toContain('\\');
    expect(t).not.toContain('.toString()');
    expect(t).not.toContain('?.');
    expect(t).not.toContain('??');
    expect(t).not.toContain('</script');
    expect(t).not.toContain('shadowBlur');
    expect(t).not.toContain(' ');
    expect(t).not.toContain(' ');
    expect(t).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // colours come only from the state palette
    expect(t).not.toMatch(/[=(,:;!&|?{}]\s*\/(?![/*])/); // no regex literals
    expect(t).not.toMatch(/\{\s*\.\.\./); // no object spread (ES2018)
  });

  it('the bones it draws are the domain skeleton minus the face loop and the heel', () => {
    const index = (name: string) => MEDIAPIPE_POSE_INDEX.indexOf(name as never);
    const expected = SKELETON_EDGES.filter(([a, b]) => ![a, b].some((n) => /eye|ear|nose|heel/.test(n))).map(([a, b]) => `${index(a)}-${index(b)}`);
    const actual = SKELETON_BONES.map(([a, b]) => `${a}-${b}`);
    expect(actual.slice().sort()).toEqual(expected.slice().sort());
    expect(SKELETON_RENDER).toContain(JSON.stringify(SKELETON_BONES));
    expect(SKELETON_RENDER).toContain(JSON.stringify(SKELETON_STYLE));
  });
});

describe('skeleton look', () => {
  it('clears the canvas first and draws nothing before it has a state', () => {
    const h = harness();
    h.r.draw(h.main.ctx, frame(person()), 0);
    expect(h.main.calls).toHaveLength(0);
    expect(h.main.other.some((o) => o.op === 'clearRect')).toBe(true);
    h.r.setState(state(), 0);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(person()), 33);
    expect(h.main.other[0]!.op).toBe('clearRect');
    expect(h.main.other[0]!.args).toEqual([0, 0, W, H]);
    h.main.reset();
    h.r.clear(h.main.ctx, W, H);
    expect(h.main.other).toEqual([{ op: 'clearRect', args: [0, 0, W, H] }]);
  });

  it('ignores a malformed state and keeps drawing with the previous one', () => {
    const h = harness();
    h.r.setState(state(), 0);
    h.r.setState({ v: 1 } as unknown as SkeletonState, 10);
    h.r.setState(null as unknown as SkeletonState, 20);
    h.run(frame(person()), 33, 66);
    expect(toneCalls(h.main.calls, 'good').length).toBeGreaterThan(0);
  });

  it('uses only palette colours and never a shadow blur, in every state and quality', () => {
    for (const q of [0, 1, 2] as const) {
      for (const reduceMotion of [false, true]) {
        const h = harness(q);
        h.r.setState(state({ side: 'left', chain: [23, 25, 27], reduceMotion }), 0);
        h.run(frame(person(), person({ primary: false, ox: -90 })), 0, 600);
        h.r.setState(state({ tone: 'fix', side: 'right', chain: [24, 26, 28], reduceMotion }), 650);
        h.run(frame(person(), person({ primary: false, ox: -90 })), 650, 800, 50); // mid cross-fade
        for (const rec of [h.main, ...h.sprites]) {
          const colours = rec.sets.filter((s) => s.k === 'fillStyle' || s.k === 'strokeStyle').map((s) => s.v as string);
          expect(colours.length).toBeGreaterThan(0);
          for (const c of colours) expect(PALETTE_VALUES.has(c)).toBe(true);
          for (const c of rec.stops) expect(PALETTE_VALUES.has(c as string)).toBe(true);
          expect(rec.sets.filter((s) => s.k === 'shadowBlur' || s.k === 'shadowColor')).toHaveLength(0);
        }
      }
    }
  });

  it('draws halo, then glow, then bones, then the highlight, then joints, then the head', () => {
    const h = harness();
    const p = person();
    h.r.setState(state({ side: 'left', chain: [23, 25, 27] }), 0);
    h.run(frame(p), 0, 400);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 433);
    const calls = h.main.calls;
    const first = (f: (c: Call) => boolean) => calls.findIndex(f);
    const last = (f: (c: Call) => boolean) => calls.length - 1 - [...calls].reverse().findIndex(f);
    const halo = first((c) => c.kind === 'fill' && c.style === PAL.halo);
    const glow = first((c) => c.kind === 'stroke' && c.style === PAL.good && c.path.some((q) => q.op === 'lineTo'));
    const core = first((c) => c.kind === 'fill' && c.style === PAL.good && isQuad(c) && c.alpha > 0.3);
    const highlight = first((c) => c.kind === 'stroke' && c.style === PAL.highlight && c.path.some((q) => q.op === 'lineTo'));
    const jointDisc = first((c) => c.kind === 'fill' && c.style === PAL.good && arcs(c).length > 0);
    const ring = first((c) => c.kind === 'stroke' && c.style === PAL.highlight && arcs(c).length > 0);
    const headStroke = last((c) => c.kind === 'stroke' && c.style === PAL.good && arcs(c).length > 0);
    expect(halo).toBe(0);
    expect(glow).toBeGreaterThan(halo);
    expect(core).toBeGreaterThan(glow);
    expect(highlight).toBeGreaterThan(core);
    expect(jointDisc).toBeGreaterThan(highlight);
    expect(ring).toBeGreaterThan(jointDisc);
    expect(headStroke).toBeGreaterThan(ring);
    // The last bone is filled before the first highlight line, and the last joint disc comes before the head.
    const lastBone = last((c) => c.kind === 'fill' && c.style === PAL.good && isQuad(c));
    expect(lastBone).toBeLessThan(highlight);
  });

  it('tapers every limb: wider at the root joint than at the far one, and continuous through a joint', () => {
    const h = harness();
    const p = person();
    h.r.setState(state(), 0);
    h.run(frame(p), 0, 300);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 333);
    const upper = bone(h.main.calls, p, 11, 13, PAL.good)!;
    const fore = bone(h.main.calls, p, 13, 15, PAL.good)!;
    const thigh = bone(h.main.calls, p, 23, 25, PAL.good)!;
    const shin = bone(h.main.calls, p, 25, 27, PAL.good)!;
    for (const b of [upper, fore, thigh, shin]) expect(b).not.toBeNull();
    for (const b of [upper, fore, thigh, shin]) expect(b.wA).toBeGreaterThan(b.wB);
    expect(upper.wB).toBeCloseTo(fore.wA, 3);
    expect(thigh.wB).toBeCloseTo(shin.wA, 3);
    expect(upper.wA).toBeGreaterThan(fore.wB * 1.4);
  });

  it('draws the chain you are judged on wider and brighter', () => {
    const p = person();
    const plain = harness();
    plain.r.setState(state(), 0);
    plain.run(frame(p), 0, 600);
    plain.main.reset();
    plain.r.draw(plain.main.ctx, frame(p), 633);
    const emph = harness();
    emph.r.setState(state({ chain: [23, 25, 27] }), 0);
    emph.run(frame(p), 0, 600);
    emph.main.reset();
    emph.r.draw(emph.main.ctx, frame(p), 633);
    const a = bone(plain.main.calls, p, 23, 25, PAL.good)!;
    const b = bone(emph.main.calls, p, 23, 25, PAL.good)!;
    expect(b.wA).toBeGreaterThan(a.wA * 1.3);
    expect(b.wB).toBeGreaterThan(a.wB * 1.3);
    expect(b.alpha).toBeGreaterThan(a.alpha);
    // Not-emphasised bones are unchanged.
    expect(bone(emph.main.calls, p, 11, 13, PAL.good)!.wA).toBeCloseTo(bone(plain.main.calls, p, 11, 13, PAL.good)!.wA, 3);
    // More highlight on the emphasised chain, and rings on its joints.
    const hi = (rec: Rec) => rec.calls.filter((c) => c.kind === 'stroke' && c.style === PAL.highlight);
    expect(hi(emph.main).length).toBeGreaterThan(hi(plain.main).length);
    expect(hi(emph.main).filter((c) => arcs(c).length > 0)).toHaveLength(3);
    expect(hi(plain.main).filter((c) => arcs(c).length > 0)).toHaveLength(0);
    // Emphasis eases in rather than snapping.
    const eased = harness();
    eased.r.setState(state({ chain: [23, 25, 27] }), 0);
    eased.run(frame(p), 0, 99); // 4 frames in: part-way
    eased.main.reset();
    eased.r.draw(eased.main.ctx, frame(p), 100);
    const mid1 = bone(eased.main.calls, p, 23, 25, PAL.good)!;
    expect(mid1.wA).toBeGreaterThan(a.wA);
    expect(mid1.wA).toBeLessThan(b.wA);
  });

  it('sizes joints by hierarchy and rings only the emphasised ones', () => {
    const h = harness();
    const p = person();
    h.r.setState(state({ chain: [23, 25, 27] }), 0);
    h.run(frame(p), 0, 600);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 633);
    const r = (i: number) => disc(h.main.calls, p, i, PAL.good)!;
    expect(r(11)).toBeGreaterThan(r(13));
    expect(r(13)).toBeGreaterThan(r(15));
    expect(r(15)).toBeGreaterThan(r(19));
    expect(r(24)).toBeGreaterThan(r(26));
    expect(r(26)).toBeGreaterThan(r(28));
    // The emphasised knee is bigger than the other knee.
    expect(r(25)).toBeGreaterThan(r(26));
  });

  it('dims the side that is not tracked, and nothing when no side is known', () => {
    const p = person();
    const side = harness();
    side.r.setState(state({ side: 'left' }), 0);
    side.run(frame(p), 0, 100);
    side.main.reset();
    side.r.draw(side.main.ctx, frame(p), 133);
    const l = bone(side.main.calls, p, 23, 25, PAL.good)!;
    const r = bone(side.main.calls, p, 24, 26, PAL.good)!;
    expect(r.alpha).toBeLessThan(l.alpha * 0.6);
    expect(bone(side.main.calls, p, 11, 12, PAL.good)!.alpha).toBeCloseTo(l.alpha, 5); // the shoulder line is shared
    const none = harness();
    none.r.setState(state({ side: null }), 0);
    none.run(frame(p), 0, 100);
    none.main.reset();
    none.r.draw(none.main.ctx, frame(p), 133);
    expect(bone(none.main.calls, p, 24, 26, PAL.good)!.alpha).toBeCloseTo(bone(none.main.calls, p, 23, 25, PAL.good)!.alpha, 5);
  });

  it('draws exactly one head circle, fitted on the face, and no heel bone', () => {
    const h = harness();
    const p = person();
    h.r.setState(state({ side: 'left', chain: [23, 25, 27] }), 0);
    h.run(frame(p), 0, 600);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 633);
    const big = headArcs(h.main, p);
    expect(big).toHaveLength(1);
    const face = [0, 2, 5, 7, 8].map((i) => joint(p, i));
    const cx = face.reduce((s, q) => s + q.x, 0) / face.length;
    const cy = face.reduce((s, q) => s + q.y, 0) / face.length;
    expect(Math.hypot(big[0]!.x - cx, big[0]!.y - cy)).toBeLessThan(12);
    // No stroke or fill anywhere near the heels (they sit well clear of every other joint)...
    const near = (q: Pt, i: number) => dist(q, joint(p, i)) < 14;
    for (const c of h.main.calls) {
      for (const q of pts(c)) for (const heel of [29, 30]) expect(near(q, heel)).toBe(false);
      for (const q of arcs(c)) for (const heel of [29, 30]) expect(near(q, heel)).toBe(false);
    }
    // ...while the simplified foot (ankle to foot index) is there.
    expect(bone(h.main.calls, p, 27, 31, PAL.good)).not.toBeNull();
    expect(bone(h.main.calls, p, 28, 32, PAL.good)).not.toBeNull();
    // And no face loop: no bone joins the nose, eyes or ears.
    for (const c of h.main.calls.filter(isQuad)) {
      const v = pts(c);
      for (const f of [0, 2, 5, 7, 8]) for (const q of v) expect(dist(q, joint(p, f))).toBeGreaterThan(3);
    }
  });

  it('draws a joint with alpha 0 not at all, and its bones with it', () => {
    const h = harness();
    const p = person({ hide: [15] });
    h.r.setState(state(), 0);
    h.run(frame(p), 0, 200);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 233);
    const wrist = { x: p.x[15]!, y: p.y[15]! };
    for (const c of h.main.calls) {
      for (const q of pts(c)) expect(dist(q, wrist)).toBeGreaterThan(1);
      for (const q of arcs(c)) expect(dist(q, wrist)).toBeGreaterThan(1);
    }
    expect(bone(h.main.calls, p, 11, 13, PAL.good)).not.toBeNull(); // the rest is still there
    expect(bone(h.main.calls, p, 13, 15, PAL.good)).toBeNull();
  });

  it('scales line widths with the person and clamps them to the style min and max', () => {
    const widest = (scale: number) => {
      const h = harness();
      const p = person({ scale });
      h.r.setState(state(), 0);
      h.run(frame(p), 0, 100);
      h.main.reset();
      h.r.draw(h.main.ctx, frame(p), 133);
      const t = bone(h.main.calls, p, 11, 23, PAL.good)!;
      const all = SKELETON_BONES.flatMap(([a, b]) => {
        const m = bone(h.main.calls, p, a, b, PAL.good)!;
        return [m.wA, m.wB];
      });
      return { w: t.wA, all };
    };
    const small = widest(0.35);
    const normal = widest(1);
    const huge = widest(6);
    expect(normal.w).toBeGreaterThan(small.w);
    expect(huge.w).toBeGreaterThan(normal.w);
    expect(huge.w).toBeLessThanOrEqual(SKELETON_STYLE.maxWidth + 0.001);
    expect(Math.max(...huge.all)).toBeLessThanOrEqual(SKELETON_STYLE.maxWidth + 0.001);
    expect(small.w).toBeGreaterThanOrEqual(SKELETON_STYLE.minWidth - 0.001);
  });

  it('draws the second person simply, dimmer and in the other colour', () => {
    const h = harness();
    const a = person();
    const b = person({ primary: false, scale: 0.5, ox: -80 });
    h.r.setState(state({ side: 'left', chain: [23, 25, 27] }), 0);
    h.run(frame(a, b), 0, 500);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(a, b), 533);
    const otherCalls = h.main.calls.filter((c) => c.style === PAL.other);
    expect(otherCalls.length).toBeGreaterThan(0);
    expect(Math.max(...otherCalls.map((c) => c.alpha))).toBeLessThanOrEqual(0.6 + 1e-6);
    expect(h.main.calls.filter((c) => c.style === PAL.other && c.kind === 'stroke').length).toBeLessThanOrEqual(8);
    // No emphasis, rings or highlight on them.
    const hi = h.main.calls.filter((c) => c.kind === 'stroke' && c.style === PAL.highlight && arcs(c).length > 0);
    expect(hi.every((c) => arcs(c).every((q) => dist(q, joint(a, 25)) < 20 || dist(q, joint(a, 23)) < 20 || dist(q, joint(a, 27)) < 20))).toBe(true);
    // A faded person fades everything with its alpha.
    const fade = harness();
    fade.r.setState(state(), 0);
    fade.run(frame(person({ pa: 0.5 })), 0, 100);
    fade.main.reset();
    fade.r.draw(fade.main.ctx, frame(person({ pa: 0.5 })), 133);
    expect(Math.max(...fade.main.calls.map((c) => c.alpha))).toBeLessThanOrEqual(0.5 + 1e-6);
    fade.main.reset();
    fade.r.draw(fade.main.ctx, frame(person({ pa: 0 })), 166);
    expect(fade.main.calls).toHaveLength(0);
  });
});

describe('skeleton transitions', () => {
  const settled = (reduceMotion = false) => {
    const h = harness();
    const p = person();
    h.r.setState(state({ tone: 'good', reduceMotion }), 0);
    h.run(frame(p), 0, 1000);
    return { h, p };
  };
  const coreAlpha = (h: ReturnType<typeof harness>, p: RenderPerson, tone: SkeletonTone) => bone(h.main.calls, p, 23, 25, PAL[tone])?.alpha ?? null;

  it('cross-fades a tone change: both tones at +100ms with complementary alphas, only the new one at +250ms', () => {
    const { h, p } = settled();
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 1033);
    const steady = coreAlpha(h, p, 'good')!;
    expect(coreAlpha(h, p, 'fix')).toBeNull();

    h.r.setState(state({ tone: 'fix' }), 1050);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 1083); // +33
    const early = { old: coreAlpha(h, p, 'good')!, next: coreAlpha(h, p, 'fix')! };
    expect(early.old).toBeGreaterThan(early.next);

    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 1150); // +100
    const old = coreAlpha(h, p, 'good')!;
    const next = coreAlpha(h, p, 'fix')!;
    expect(old).toBeGreaterThan(0);
    expect(next).toBeGreaterThan(0);
    expect(old + next).toBeCloseTo(steady, 5); // complementary
    expect(next).toBeGreaterThan(early.next);

    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 1300); // +250
    expect(coreAlpha(h, p, 'good')).toBeNull();
    expect(h.main.calls.some((c) => c.style === PAL.good)).toBe(false);
    expect(coreAlpha(h, p, 'fix')).toBeCloseTo(steady, 5);
  });

  it('changes tone instantly with reduce motion', () => {
    const { h, p } = settled(true);
    h.r.setState(state({ tone: 'fix', reduceMotion: true }), 1050);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 1083);
    expect(coreAlpha(h, p, 'good')).toBeNull();
    expect(coreAlpha(h, p, 'fix')).not.toBeNull();
  });

  it('changes tone instantly at the minimal quality', () => {
    const h = harness(0);
    const p = person();
    h.r.setState(state(), 0);
    h.run(frame(p), 0, 200);
    h.r.setState(state({ tone: 'untrackable' }), 233);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 250);
    expect(h.main.calls.some((c) => c.style === PAL.good)).toBe(false);
    expect(h.main.calls.some((c) => c.style === PAL.untrackable)).toBe(true);
  });

  it('snaps emphasis with reduce motion and pulses the ring only without it', () => {
    const run = (reduceMotion: boolean, at: number) => {
      const h = harness();
      const p = person();
      h.r.setState(state({ chain: [23, 25, 27], reduceMotion }), 0);
      if (reduceMotion) {
        h.main.reset();
        h.r.draw(h.main.ctx, frame(p), 33);
        expect(bone(h.main.calls, p, 23, 25, PAL.good)!.wA).toBeGreaterThan(0); // already fully emphasised on the first frame
      }
      h.run(frame(p), 0, 1500);
      h.main.reset();
      h.r.draw(h.main.ctx, frame(p), at);
      const ring = h.main.calls.find((c) => c.kind === 'stroke' && c.style === PAL.highlight && arcs(c).some((q) => dist(q, joint(p, 25)) < 0.6))!;
      return arcs(ring)[0]!.r;
    };
    // 1500 and 1875 ms are a quarter of the 1500 ms pulse apart.
    expect(run(false, 1875)).toBeGreaterThan(run(false, 1500) + 0.3);
    expect(run(true, 1875)).toBeCloseTo(run(true, 1500), 5);
  });
});

describe('skeleton quality levels', () => {
  const draw = (q: 0 | 1 | 2, o: Partial<SkeletonState> = {}) => {
    const h = harness(q);
    const p = person();
    h.r.setState(state({ side: 'left', chain: [23, 25, 27], ...o }), 0);
    h.run(frame(p), 0, 600);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 633);
    const strokes = h.main.calls.filter((c) => c.kind === 'stroke').length;
    const fills = h.main.calls.filter((c) => c.kind === 'fill').length;
    const glow = h.main.calls.filter((c) => c.kind === 'stroke' && c.style === PAL.good && c.path.some((q) => q.op === 'lineTo') && c.alpha < 0.15).length;
    return { h, strokes, fills, glow, images: h.main.other.filter((o) => o.op === 'drawImage').length };
  };

  it('quality 2 has glow and a bloom sprite made once; 1 has neither; 0 is minimal', () => {
    const q2 = draw(2);
    const q1 = draw(1);
    const q0 = draw(0);
    expect(q2.glow).toBeGreaterThan(0);
    expect(q2.images).toBe(1);
    expect(q2.h.created).toHaveLength(1);
    expect(q1.glow).toBe(0);
    expect(q1.images).toBe(0);
    expect(q1.h.created).toHaveLength(0);
    expect(q0.glow).toBe(0);
    expect(q0.images).toBe(0);
    expect(q0.h.created).toHaveLength(0);
    expect(q0.fills + q0.strokes).toBeLessThan((q1.fills + q1.strokes) / 2);
    // Minimal is still halo + core + joints + head.
    expect(q0.h.main.calls.some((c) => c.style === PAL.halo)).toBe(true);
    expect(q0.h.main.calls.some((c) => c.style === PAL.good && c.kind === 'stroke')).toBe(true);
    expect(q0.h.main.calls.some((c) => c.style === PAL.good && c.kind === 'fill' && arcs(c).length > 0)).toBe(true);
    expect(headArcs(q0.h.main, person())).toHaveLength(1);
  });

  it('builds the sprite once, however many frames are drawn, from palette colours', () => {
    const h = harness(2);
    h.r.setState(state({ chain: [23, 25, 27] }), 0);
    h.run(frame(person()), 0, 3000);
    h.r.setState(state({ tone: 'fix', chain: [24, 26, 28] }), 3050);
    h.run(frame(person()), 3050, 4000);
    expect(h.created).toHaveLength(1);
    expect(h.sprites[0]!.sets.filter((s) => s.k === 'fillStyle').every((s) => PALETTE_VALUES.has(s.v as string))).toBe(true);
  });

  it('with reduce motion there is no glow and no sprite, even at quality 2', () => {
    const r = draw(2, { reduceMotion: true });
    expect(r.glow).toBe(0);
    expect(r.images).toBe(0);
    expect(r.h.created).toHaveLength(0);
  });

  it('stays within about 60 stroke calls per frame, one person, in the heaviest case', () => {
    // Heaviest: quality 2, emphasis on, the side dimmed, and mid cross-fade (everything drawn twice).
    const h = harness(2);
    const p = person();
    h.r.setState(state({ side: 'left', chain: [23, 25, 27] }), 0);
    h.run(frame(p), 0, 600);
    h.r.setState(state({ tone: 'fix', side: 'left', chain: [23, 25, 27] }), 650);
    h.main.reset();
    h.r.draw(h.main.ctx, frame(p), 733);
    const strokes = h.main.calls.filter((c) => c.kind === 'stroke').length;
    const fills = h.main.calls.filter((c) => c.kind === 'fill').length;
    expect(strokes).toBeLessThanOrEqual(60);
    expect(fills).toBeLessThanOrEqual(160);
    // Two people at quality 2 are still cheap.
    const two = harness(2);
    two.r.setState(state({ side: 'left', chain: [23, 25, 27] }), 0);
    two.run(frame(p, person({ primary: false, ox: -90, scale: 0.5 })), 0, 600);
    two.main.reset();
    two.r.draw(two.main.ctx, frame(p, person({ primary: false, ox: -90, scale: 0.5 })), 633);
    expect(two.main.calls.filter((c) => c.kind === 'stroke').length).toBeLessThanOrEqual(60);
  });
});
