import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { MuscleTier } from '@form/domain';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { ACCENTS, ANATOMY, artPalettes, LIGHT_DIR, METALS, STROKE, useArtId, type ArtTone, type MetalName } from '@/theme/artPalette';
import { fonts, palettes, scheme } from '@/theme/tokens';

/**
 * An anatomical muscle map, front and back: a stylised grey anatomy figure (neck, hands and feet,
 * a mannequin head, every muscle group segmented) whose worked muscles light up: the main movers in the
 * accent red, the helpers in a softer amber, a heat scale (e.g. sets per muscle) from amber through coral to deep red, or a rank tier
 * per muscle (`tiers`: grey for untrained, then bronze, silver, gold, platinum and sapphire metal). Matches the
 * catalogue's muscle groups exactly. `MuscleThumb` shows one group on a body-part silhouette, for filters and
 * lists. Style rules: docs/art-style.md. Budget: 200 SVG elements for the map, 40 for a thumb.
 */

export type Muscle = 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'chest' | 'back' | 'lats' | 'traps' | 'shoulders' | 'biceps' | 'triceps' | 'forearms' | 'core';
export const MUSCLES: Muscle[] = ['chest', 'back', 'lats', 'traps', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];
export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: 'Chest',
  back: 'Back',
  lats: 'Lats',
  traps: 'Traps',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  core: 'Core',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
};

type View2 = 'front' | 'back';
type V = readonly [number, number];

/* ------------------------------------------------------------ geometry */

const f1 = (n: number) => Math.round(n * 10) / 10;
const fp = (x: number, y: number) => `${f1(x)} ${f1(y)}`;
const unit = (x: number, y: number): V => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

/** Smooth curve through the points (Catmull-Rom as cubic Beziers). */
function curve(pts: readonly V[]): string {
  let s = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    s += `C${fp(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)} ${fp(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)} ${fp(p2[0], p2[1])}`;
  }
  return s;
}

/** A soft tapered limb along the points, with a half-width at each, as one closed shape. */
function tube(pts: readonly V[], hw: readonly number[]): string {
  const n = pts.length;
  const nor: V[] = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    const [tx, ty] = unit(b[0] - a[0], b[1] - a[1]);
    return [-ty, tx];
  });
  const left = pts.map((p, i): V => [p[0] + nor[i]![0] * hw[i]!, p[1] + nor[i]![1] * hw[i]!]);
  const right = pts.map((p, i): V => [p[0] - nor[i]![0] * hw[i]!, p[1] - nor[i]![1] * hw[i]!]).reverse();
  const l0 = left[0]!;
  const r0 = right[0]!;
  return `M${fp(l0[0], l0[1])}${curve(left)}A${f1(hw[n - 1]!)} ${f1(hw[n - 1]!)} 0 0 0 ${fp(r0[0], r0[1])}${curve(right)}A${f1(hw[0]!)} ${f1(hw[0]!)} 0 0 0 ${fp(l0[0], l0[1])}Z`;
}

/** An ellipse as four cubic curves (so it can be mirrored like any other shape). */
function ell(cx: number, cy: number, rx: number, ry: number): string {
  const k = 0.5523;
  return `M${fp(cx - rx, cy)} C${fp(cx - rx, cy - ry * k)} ${fp(cx - rx * k, cy - ry)} ${fp(cx, cy - ry)} C${fp(cx + rx * k, cy - ry)} ${fp(cx + rx, cy - ry * k)} ${fp(cx + rx, cy)} C${fp(cx + rx, cy + ry * k)} ${fp(cx + rx * k, cy + ry)} ${fp(cx, cy + ry)} C${fp(cx - rx * k, cy + ry)} ${fp(cx - rx, cy + ry * k)} ${fp(cx - rx, cy)} Z`;
}

/** A rounded rectangle from absolute "x y" pairs (mirrorable). */
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;

const PAIR = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;
/** A left-half shape (x <= 0) placed on the figure at `cx`, on its own side (s = 1) or mirrored to the other (s = -1). */
const place = (d: string, cx: number, s: number) => d.replace(PAIR, (_, x: string, y: string) => `${f1(cx + s * +x)} ${y}`);
/** The shape on both sides of the figure. */
const both = (d: string, cx: number) => `${place(d, cx, 1)} ${place(d, cx, -1)}`;
/** A limb on both sides. */
const bothTubes = (pts: readonly V[], hw: readonly number[], cx: number) => `${tube(pts.map(([x, y]): V => [cx + x, y]), hw)} ${tube(pts.map(([x, y]): V => [cx - x, y]), hw)}`;

type Seg = readonly ['L', number, number] | readonly ['C', number, number, number, number, number, number];

/** A symmetric outline from its left half: down the left side from the top centre, then back up the right. */
function symmetric(cx: number, start: V, segs: readonly Seg[]): string {
  const at = (x: number, y: number, s: number) => fp(cx + s * x, y);
  const ends: V[] = [start];
  let d = `M${at(start[0], start[1], 1)}`;
  for (const g of segs) {
    if (g[0] === 'L') {
      d += `L${at(g[1], g[2], 1)}`;
      ends.push([g[1], g[2]]);
    } else {
      d += `C${at(g[1], g[2], 1)} ${at(g[3], g[4], 1)} ${at(g[5], g[6], 1)}`;
      ends.push([g[5], g[6]]);
    }
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    const g = segs[i]!;
    const from = ends[i]!;
    d += g[0] === 'L' ? `L${at(from[0], from[1], -1)}` : `C${at(g[3], g[4], -1)} ${at(g[1], g[2], -1)} ${at(from[0], from[1], -1)}`;
  }
  return `${d}Z`;
}

/* ------------------------------------------------------------- anatomy */

/** The torso, shoulders to hips, left half (the figure is mirrored). */
const TRUNK: readonly Seg[] = [
  ['L', -5.5, 33],
  ['C', -12, 34, -18, 37, -23, 41],
  ['C', -26, 43, -26, 48, -24.5, 53],
  ['C', -22, 64, -19, 72, -17.5, 80],
  ['C', -16.5, 90, -19, 98, -20, 108],
  ['L', -17, 119],
  ['L', 0, 120],
];
const ARM: { pts: readonly V[]; hw: readonly number[] } = {
  pts: [[-26, 45], [-30.5, 64], [-33.5, 84], [-35.3, 100], [-36.8, 116]],
  hw: [7.5, 6.8, 5.6, 5, 3.9],
};
const LEG: { pts: readonly V[]; hw: readonly number[] } = {
  pts: [[-11, 112], [-12.2, 132], [-11.5, 150], [-12.8, 161], [-11.8, 175]],
  hw: [11, 10, 7.3, 7, 4.2],
};

type Part = 'legs' | 'feet' | 'arms' | 'hands' | 'trunk' | 'neck' | 'head';
const PART_ORDER: Part[] = ['legs', 'feet', 'arms', 'hands', 'trunk', 'neck', 'head'];

function partPath(part: Part, cx: number): string {
  switch (part) {
    case 'legs':
      return bothTubes(LEG.pts, LEG.hw, cx);
    case 'feet':
      return both(ell(-13.3, 180.4, 6.2, 3.7), cx);
    case 'arms':
      return bothTubes(ARM.pts, ARM.hw, cx);
    case 'hands':
      return both(ell(-37.4, 123.5, 3.9, 5.4), cx);
    case 'trunk':
      return symmetric(cx, [0, 32], TRUNK);
    case 'neck':
      return tube([[cx, 22], [cx, 35]], [4.8, 6.3]);
    case 'head':
      return ell(cx, 14, 9.5, 11.5);
  }
}

/** Where each muscle lies on the left half (absolute "x y" pairs, mirrored to the right). */
const SHAPES: Record<View2, Partial<Record<Muscle, string[]>>> = {
  front: {
    shoulders: ['M-20 40 C-25 39 -31 42 -33 48 C-34.5 53 -34 58 -32 62 C-28.5 60 -25 56 -23.5 51 C-22 47 -21 43 -20 40 Z'],
    chest: ['M-0.8 42 C-6 40.5 -13 40.5 -19 44 C-22.5 51 -21.5 58 -17 62 C-11 65 -4 63.5 -0.8 60 Z'],
    biceps: ['M-30 56 C-34.5 62 -35 72 -33 81 C-30 82 -27.5 80 -26.5 76 C-25.5 69 -26 61 -27.5 56 Z'],
    core: [rr(-8.5, 66, 7.3, 8, 2.6), rr(-8.5, 76, 7.3, 8, 2.6), rr(-8.5, 86, 7.3, 8, 2.6), 'M-14.5 66 C-18.5 76 -18.5 88 -16 98 L-10.8 99 L-10.4 67 Z'],
    quads: ['M-18.5 120 C-20 131 -20 143 -17 153 C-14 155 -10 154.5 -8 152 C-6 142 -5.5 130 -6 121 C-9.5 119 -14 119 -18.5 120 Z'],
    forearms: ['M-39 87 C-41 96 -41 105 -39.5 112 C-37.5 114 -34.5 113.5 -33 111 C-31.5 104 -31 95 -31.5 87 C-34 85.5 -36.5 85.5 -39 87 Z'],
    calves: ['M-17 157 C-18.5 164 -17 171 -14.5 175 C-12 172 -10.5 164 -10.5 157 Z'],
  },
  back: {
    back: ['M-0.8 33.5 L-5.5 34 C-11 35.5 -17 38.5 -21 42 C-17 49 -9 56 -0.8 66 Z', rr(-8.5, 76, 7.7, 25, 3)],
    shoulders: ['M-20 40 C-25 39 -31 42 -33 48 C-34.5 53 -34 58 -32 62 C-28.5 60 -25 56 -23.5 51 C-22 47 -21 43 -20 40 Z'],
    traps: ['M-0.8 24.5 C-3 26.5 -4.5 29 -5.5 33 C-12 34.5 -17 37.5 -21 41 C-17 44 -11 46 -6 48 C-3 44 -1.5 40 -0.8 36 Z'],
    lats: ['M-21.5 50 C-24 62 -20.5 76 -15.5 88 L-9 94 C-9.5 82 -10 70 -11 60 C-14.5 57.5 -18.5 54 -21.5 50 Z'],
    triceps: ['M-30.5 56 C-35.5 62 -36 72 -33.5 82 C-30.5 83 -27.5 80.5 -26.5 75 C-25.5 68 -26 61 -27 56 Z'],
    forearms: ['M-39 87 C-41 96 -41 105 -39.5 112 C-37.5 114 -34.5 113.5 -33 111 C-31.5 104 -31 95 -31.5 87 C-34 85.5 -36.5 85.5 -39 87 Z'],
    glutes: ['M-0.8 103 C-8 100.5 -17.5 102 -20.5 110 C-21.5 118 -16 124 -8 123.5 C-4 123 -1.5 120 -0.8 117 Z'],
    hamstrings: ['M-18.5 126 C-20.5 137 -20 147 -16.5 154 C-13 155.5 -9.5 155 -7.5 152.5 C-5.5 143 -5 134 -5.5 126 C-9.5 124.5 -14 124.5 -18.5 126 Z'],
    calves: ['M-18 157 C-20.5 164 -18.5 172 -14.5 176 C-10.5 172 -9.5 164 -9.5 157 C-12 155.5 -15.5 155.5 -18 157 Z'],
  },
};

/** Fine lines that give the figure shape: collarbones and breastbone in front, spine and blades behind. */
const LINES: Record<View2, { side: string; centre: string }> = {
  front: { side: 'M-5 35.5 Q-13 37 -20 40.5', centre: 'M0 42 L0 100' },
  back: { side: 'M-12 52 Q-16 60 -13 68', centre: 'M0 34 L0 104' },
};

/** Creases and joints (knees, elbows, hips, forearms) that give the figure its anatomy, left half. */
const JOINTS: Record<View2, string> = {
  front: 'M-14 101 Q-9 106.5 -1.5 109 M-34.6 83 Q-31 86.5 -27.6 84 M-35.2 91 Q-35.8 101 -36 110 M-16.5 150 Q-11.5 154.5 -6.6 150.5 M-16.4 160 Q-12 162.5 -8.8 160',
  back: 'M-34.6 83 Q-31 86.5 -27.6 84 M-35.2 91 Q-35.8 101 -36 110 M-17 151.5 Q-12 149 -7 151.5 M-16 124 Q-11 127 -3 125',
};

/** A soft band of shade down the edge away from the light: the torso flank, the arm and the leg. */
const SHADE = 'M-22.5 55 Q-20 68 -15.5 80 Q-16 94 -18 108 M-31.3 52 Q-35.1 66 -36.9 84 Q-38.1 100 -38.5 114 M-20 122 Q-21 138 -17.5 152 Q-16 164 -14 173';

/** Which body parts a thumb draws, and where it looks: the centre of a square window and its side. */
const THUMB: Record<Muscle, { view: View2; parts: Part[]; at: V; span: number }> = {
  chest: { view: 'front', parts: ['trunk', 'neck', 'arms'], at: [0, 52], span: 60 },
  shoulders: { view: 'front', parts: ['trunk', 'neck', 'arms'], at: [-19, 50], span: 60 },
  biceps: { view: 'front', parts: ['trunk', 'arms'], at: [-28, 68], span: 58 },
  core: { view: 'front', parts: ['trunk', 'arms'], at: [0, 82], span: 58 },
  quads: { view: 'front', parts: ['trunk', 'legs'], at: [-2, 134], span: 60 },
  back: { view: 'back', parts: ['trunk', 'neck', 'arms'], at: [0, 56], span: 62 },
  lats: { view: 'back', parts: ['trunk', 'arms'], at: [-8, 70], span: 60 },
  traps: { view: 'back', parts: ['trunk', 'neck', 'arms'], at: [-5, 38], span: 50 },
  forearms: { view: 'front', parts: ['trunk', 'arms', 'hands'], at: [-35, 98], span: 50 },
  triceps: { view: 'back', parts: ['trunk', 'arms'], at: [-28, 68], span: 58 },
  glutes: { view: 'back', parts: ['trunk', 'legs'], at: [0, 112], span: 58 },
  hamstrings: { view: 'back', parts: ['trunk', 'legs'], at: [0, 138], span: 62 },
  calves: { view: 'back', parts: ['legs', 'feet'], at: [0, 164], span: 56 },
};

/* ------------------------------------------------------------- the model */

/** The anatomy model is a light grey figure; the heat colours below are what lights up on it. */
const GREY = ANATOMY;

/* ---------------------------------------------------------------- heat */

/** Three steps of heat: amber, coral, deep red. They read on skin and on espresso alike. */
function heatStops(tone: ArtTone, step: 0 | 1 | 2): [string, string] {
  const x = ACCENTS[tone];
  if (step === 0) return [x.sparkleHoney, x.sparkleCoral];
  if (step === 1) return [x.bodyActiveTop, x.bodyActiveBottom];
  return [x.bodyActiveBottom, artPalettes[tone].figure.workDeep];
}
const stepOf = (level: number): 0 | 1 | 2 => (level >= 0.67 ? 2 : level >= 0.34 ? 1 : 0);

/* ---------------------------------------------------------------- tiers */

/** The metal each rank tier is painted in. Untrained stays the grey of the figure. */
export const TIER_METAL: Record<MuscleTier, MetalName | null> = { untrained: null, bronze: 'bronze', silver: 'silver', gold: 'gold', platinum: 'platinum', diamond: 'sapphire' };
type Tiers = Map<string, MuscleTier>;
const NO_TIERS: Tiers = new Map();

/* --------------------------------------------------------------- pieces */

/** The soft grey-brown lines and shadows need the tone's own palette. */
function useLook(tone?: ArtTone): { t: ArtTone; base: string } {
  const base = useArtId('bm');
  return { t: tone ?? scheme, base };
}

function Gradients({ t, base, levels, tiers, figures }: { t: ArtTone; base: string; levels: Map<string, number>; tiers: Tiers; figures: { cx: number; id: string }[] }) {
  const used = new Set([...levels.values()].map(stepOf));
  const usedTiers = [...new Set(tiers.values())].filter((x) => TIER_METAL[x]);
  return (
    <Defs>
      {figures.map((f) => (
        <LinearGradient key={f.id} id={f.id} gradientUnits="userSpaceOnUse" x1={f.cx - 30} y1={0} x2={f.cx + 36} y2={190}>
          <Stop offset="0" stopColor={GREY[t].skinTop} />
          <Stop offset="1" stopColor={GREY[t].skinBottom} />
        </LinearGradient>
      ))}
      <LinearGradient id={`${base}m`} {...LIGHT_DIR}>
        <Stop offset="0" stopColor={GREY[t].muscleTop} />
        <Stop offset="1" stopColor={GREY[t].muscleBottom} />
      </LinearGradient>
      {([0, 1, 2] as const)
        .filter((s) => used.has(s))
        .map((s) => (
          <LinearGradient key={s} id={`${base}h${s}`} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={heatStops(t, s)[0]} />
            <Stop offset="1" stopColor={heatStops(t, s)[1]} />
          </LinearGradient>
        ))}
      {usedTiers.map((x) => (
        <LinearGradient key={x} id={`${base}t${x}`} {...LIGHT_DIR}>
          <Stop offset="0" stopColor={METALS[TIER_METAL[x]!].hi} />
          <Stop offset="1" stopColor={METALS[TIER_METAL[x]!].mid} />
        </LinearGradient>
      ))}
    </Defs>
  );
}

interface FigureProps {
  cx: number;
  view: View2;
  t: ArtTone;
  base: string;
  skinId: string;
  levels: Map<string, number>;
  tiers: Tiers;
  /** Parts to draw, and which muscles. A thumb draws a few; the map draws everything. */
  parts: Part[];
  muscles: Muscle[];
  /** Outline width: the full figure is drawn small and wears a line, a thumb is zoomed in. */
  line: number;
  details: boolean;
}

function Figure({ cx, view, t, base, skinId, levels, tiers, parts, muscles, line, details }: FigureProps) {
  const a = artPalettes[t];
  const x = ACCENTS[t];
  const night = t === 'dark';
  const ink = [...PART_ORDER.filter((p) => parts.includes(p))];
  const silhouette = ink.map((p) => partPath(p, cx)).join(' ');
  const lines = LINES[view];
  return (
    <>
      {details ? <Ellipse cx={cx} cy={185} rx={27} ry={3.4} fill={a.shadow} opacity={a.shadowOpacity} /> : null}
      {night ? <Path d={silhouette} fill="none" stroke={a.rim} strokeOpacity={a.rimOpacity} strokeWidth={line} strokeLinejoin="round" transform="translate(1.1 1.5)" /> : null}
      <Path d={silhouette} fill="none" stroke={GREY[t].edge} strokeWidth={line + 1} strokeLinejoin="round" strokeLinecap="round" />
      {ink.map((p) => (
        <Path key={p} d={partPath(p, cx)} fill={`url(#${skinId})`} />
      ))}
      {parts.includes('head') ? <HeadDetail cx={cx} t={t} skinId={skinId} /> : null}
      {muscles.map((m) => {
        const level = levels.get(m) ?? 0;
        const shapes = SHAPES[view][m];
        if (!shapes) return null;
        const tier = tiers.get(m);
        if (tier && TIER_METAL[tier]) {
          return <Path key={m} d={shapes.map((d) => both(d, cx)).join(' ')} fill={`url(#${base}t${tier})`} stroke={METALS[TIER_METAL[tier]!].lo} strokeWidth={STROKE.hair} strokeLinejoin="round" />;
        }
        return (
          <Path
            key={m}
            d={shapes.map((d) => both(d, cx)).join(' ')}
            fill={level > 0 ? `url(#${base}h${stepOf(level)})` : `url(#${base}m)`}
            stroke={level > 0 ? x.bodyActiveEdge : GREY[t].line}
            strokeOpacity={level > 0 ? 1 : GREY[t].lineOpacity}
            strokeWidth={STROKE.hair}
            strokeLinejoin="round"
          />
        );
      })}
      {details ? (
        <>
          <Path d={`${place(lines.side, cx, 1)} ${place(lines.side, cx, -1)}`} fill="none" stroke={GREY[t].line} strokeOpacity={GREY[t].lineOpacity} strokeWidth={STROKE.hair} strokeLinecap="round" />
          <Path d={both(JOINTS[view], cx)} fill="none" stroke={GREY[t].line} strokeOpacity={GREY[t].lineOpacity} strokeWidth={STROKE.hair} strokeLinecap="round" />
          <Path d={place(SHADE, cx, -1)} fill="none" stroke={a.shadow} strokeOpacity={a.shadowOpacity * 0.8} strokeWidth={STROKE.bold} strokeLinecap="round" />
          <Path d={place(lines.centre, cx, 1)} fill="none" stroke={GREY[t].line} strokeOpacity={GREY[t].lineOpacity} strokeWidth={STROKE.hair} strokeLinecap="round" />
          <Path d={`M${cx - 20} 46 Q${cx - 24} 62 ${cx - 21} 82`} fill="none" stroke={a.highlight} strokeOpacity={a.highlightOpacity} strokeWidth={STROKE.bold} strokeLinecap="round" />
        </>
      ) : null}
    </>
  );
}

/** The head: a smooth mannequin head with ears (no face or hair), so the muscles are what the eye finds. */
function HeadDetail({ cx, t, skinId }: { cx: number; t: ArtTone; skinId: string }) {
  return <Path d={`${ell(cx - 9.6, 15, 2.1, 3)} ${ell(cx + 9.6, 15, 2.1, 3)}`} fill={`url(#${skinId})`} stroke={GREY[t].edge} strokeWidth={STROKE.hair} />;
}

/** How heavy to draw each figure's outline. */
const FULL_LINE = STROKE.line;
const THUMB_LINE = STROKE.hair;

/** The levels of each muscle: `primary` at full strength, `secondary` softer, or `heat` (0 to 1 per muscle). */
function levelsOf(primary: string[], secondary: string[], heat?: Partial<Record<Muscle, number>>) {
  const p = new Set(primary);
  const s = secondary.filter((m) => !p.has(m));
  const levels = new Map<string, number>();
  if (heat) {
    for (const [m, v] of Object.entries(heat)) if (v && v > 0) levels.set(m, Math.min(1, v));
  } else {
    for (const m of s) levels.set(m, 0.3);
    for (const m of p) levels.set(m, 1);
  }
  return { levels, s };
}

/**
 * Front and back. `primary` muscles at full strength and `secondary` softer, or pass `heat`
 * (0 to 1 per muscle) to shade by how much each was trained.
 */
export function BodyMap({
  primary = [],
  secondary = [],
  heat,
  tiers,
  height = 200,
  showLabels = true,
  style,
  accessibilityLabel,
  tone,
}: {
  primary?: string[];
  secondary?: string[];
  heat?: Partial<Record<Muscle, number>>;
  /** Rank tier per muscle: each muscle is painted in its tier's metal; untrained or missing stays grey. */
  tiers?: Partial<Record<Muscle, MuscleTier>>;
  height?: number;
  showLabels?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  tone?: ArtTone;
}) {
  const { t, base } = useLook(tone);
  const { levels, s } = levelsOf(primary, secondary, heat);
  const tierMap: Tiers = tiers ? new Map(Object.entries(tiers) as [string, MuscleTier][]) : NO_TIERS;
  const label =
    accessibilityLabel ?? (tiers ? `Muscle ranks: ${MUSCLES.map((m) => `${MUSCLE_LABEL[m]} ${tiers[m] ?? 'untrained'}`).join(', ')}` : heat ? `Muscles trained: ${[...levels.keys()].map((m) => MUSCLE_LABEL[m as Muscle] ?? m).join(', ') || 'none yet'}` : `Muscles worked: ${primary.join(', ')}${s.length ? `; also ${s.join(', ')}` : ''}`);
  // Labels are drawn in viewBox units: sized so they come out at 12px or more at this height.
  const labelSize = Math.min(24, Math.max(15, (12.5 * 205) / height));
  const faint = palettes[t].textFaint;
  const text = { fill: faint, fontSize: labelSize, fontFamily: fonts.semibold, fontWeight: '700', letterSpacing: 1.2, textAnchor: 'middle' } as const;
  const all = PART_ORDER;
  const every = Object.keys(MUSCLE_LABEL) as Muscle[];
  return (
    <View style={[{ height, aspectRatio: 220 / 205 }, style]} accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width="100%" height="100%" viewBox="0 0 220 205">
        <Gradients t={t} base={base} levels={levels} tiers={tierMap} figures={[{ cx: 55, id: `${base}sf` }, { cx: 165, id: `${base}sb` }]} />
        <Figure cx={55} view="front" t={t} base={base} skinId={`${base}sf`} levels={levels} tiers={tierMap} parts={all} muscles={every} line={FULL_LINE} details />
        <Figure cx={165} view="back" t={t} base={base} skinId={`${base}sb`} levels={levels} tiers={tierMap} parts={all} muscles={every} line={FULL_LINE} details />
        {showLabels ? (
          <>
            <SvgText x={55} y={202} {...text}>
              FRONT
            </SvgText>
            <SvgText x={165} y={202} {...text}>
              BACK
            </SvgText>
          </>
        ) : null}
      </Svg>
    </View>
  );
}

/** One muscle group on a body-part silhouette, in a round frame: lit when `active`. For filters and muscle lists. */
export function MuscleThumb({ muscle, size = 56, active = true, intensity = 1, style, tone }: { muscle: Muscle; size?: number; active?: boolean; intensity?: number; style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const { t, base } = useLook(tone);
  const th = THUMB[muscle];
  const [px, py] = th.at;
  const vb = `${f1(px - th.span / 2)} ${f1(py - th.span / 2)} ${th.span} ${th.span}`;
  const levels = new Map<string, number>(active ? [[muscle, intensity]] : []);
  const pal = palettes[t];
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: pal.cardRaised }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox={vb}>
        <Gradients t={t} base={base} levels={levels} tiers={NO_TIERS} figures={[{ cx: 0, id: `${base}s` }]} />
        {active ? <Circle cx={px} cy={py} r={th.span * 0.46} fill={pal.primarySoft} /> : null}
        <Figure cx={0} view={th.view} t={t} base={base} skinId={`${base}s`} levels={levels} tiers={NO_TIERS} parts={th.parts} muscles={[muscle]} line={THUMB_LINE} details={false} />
      </Svg>
    </View>
  );
}
