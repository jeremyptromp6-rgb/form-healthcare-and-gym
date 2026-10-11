import { memo, useEffect, useState, type ReactNode } from 'react';
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useReducedMotion } from '@/lib/a11y';
import { ACCENTS, art, artPalettes, LIGHT_DIR, METALS, STROKE, type ArtPalette, type ArtTone, type Metal } from '@/theme/artPalette';
import { palettes, scheme } from '@/theme/tokens';

/**
 * Exercise illustrations: original vector art drawn from a small figure rig, so every movement in
 * the catalogue has an accurate picture. The figure is a friendly, stylised person (a tapered
 * torso in a tank top and shorts, soft limbs, hands, shoes, a head with hair and an ear) lit from the
 * top-left, with the working muscles in terracotta, the start position as a faint silhouette and the
 * equipment drawn in METALS. Side view, facing right. Style rules: docs/art-style.md.
 * Budget: 50 SVG elements for the figure with its ghost and gear, 25 as a thumb, 12 for the placeholder.
 */

type P = readonly [number, number];
export interface Pose {
  head: P;
  neck: P;
  hip: P;
  knee: P;
  foot: P;
  elbow: P;
  hand: P;
  /** A second leg when it differs from the first (a lunge's back leg). */
  knee2?: P;
  foot2?: P;
}
type Segment = 'torso' | 'thigh' | 'shin' | 'upperArm' | 'forearm';
type Equipment = 'plate' | 'dumbbell' | 'kettlebell' | 'bench' | 'band' | 'cable' | 'pulldown' | 'bar' | 'seat' | 'floor';

interface ExerciseDrawing {
  start: Pose;
  end: Pose;
  work: Segment[];
  equipment: Equipment[];
}

const STAND = {
  head: [101, 31],
  neck: [100, 44],
  hip: [99, 76],
  knee: [99, 102],
  foot: [99, 128],
} as const;
const SQUAT_LEGS = {
  foot: [100, 128],
  knee: [117, 101],
  hip: [84, 102],
  neck: [106, 68],
  head: [112, 57],
} as const;

const DRAWINGS: Record<string, ExerciseDrawing> = {
  bodyweight_squat: {
    start: { ...STAND, elbow: [113, 48], hand: [128, 48] },
    end: { ...SQUAT_LEGS, elbow: [120, 72], hand: [136, 72] },
    work: ['thigh', 'shin'],
    equipment: ['floor'],
  },
  goblet_squat: {
    start: { ...STAND, elbow: [108, 62], hand: [112, 52] },
    end: { ...SQUAT_LEGS, elbow: [114, 84], hand: [118, 74] },
    work: ['thigh', 'shin'],
    equipment: ['floor', 'kettlebell'],
  },
  squat: {
    start: { ...STAND, elbow: [89, 58], hand: [96, 46] },
    end: { ...SQUAT_LEGS, elbow: [95, 82], hand: [102, 70] },
    work: ['thigh', 'shin'],
    equipment: ['floor', 'plate'],
  },
  push_up: {
    start: {
      foot: [36, 126],
      knee: [62, 118],
      hip: [90, 110],
      neck: [138, 96],
      head: [151, 90],
      elbow: [138, 111],
      hand: [138, 127],
    },
    end: {
      foot: [36, 126],
      knee: [62, 121],
      hip: [90, 117],
      neck: [138, 111],
      head: [151, 107],
      elbow: [121, 113],
      hand: [138, 127],
    },
    work: ['upperArm', 'forearm', 'torso'],
    equipment: ['floor'],
  },
  bicep_curl: {
    start: { ...STAND, elbow: [101, 62], hand: [102, 82] },
    end: { ...STAND, elbow: [101, 62], hand: [113, 48] },
    work: ['upperArm', 'forearm'],
    equipment: ['floor', 'dumbbell'],
  },
  lunge: {
    start: {
      ...STAND,
      elbow: [100, 62],
      hand: [100, 80],
      knee2: [99, 102],
      foot2: [99, 128],
    },
    end: {
      head: [102, 57],
      neck: [101, 70],
      hip: [100, 102],
      knee: [126, 102],
      foot: [126, 128],
      elbow: [101, 86],
      hand: [101, 104],
      knee2: [84, 125],
      foot2: [62, 121],
    },
    work: ['thigh', 'shin'],
    equipment: ['floor'],
  },
  glute_bridge: {
    start: {
      head: [38, 117],
      neck: [52, 121],
      hip: [98, 122],
      knee: [126, 100],
      foot: [146, 127],
      elbow: [72, 125],
      hand: [92, 126],
    },
    end: {
      head: [38, 117],
      neck: [52, 120],
      hip: [100, 96],
      knee: [130, 91],
      foot: [146, 127],
      elbow: [72, 125],
      hand: [92, 126],
    },
    work: ['thigh', 'torso'],
    equipment: ['floor'],
  },
  deadlift: {
    start: {
      foot: [100, 128],
      knee: [110, 106],
      hip: [78, 90],
      neck: [114, 70],
      head: [125, 63],
      elbow: [112, 92],
      hand: [110, 114],
    },
    end: { ...STAND, elbow: [101, 62], hand: [102, 84] },
    work: ['thigh', 'torso'],
    equipment: ['floor', 'plate'],
  },
  bench_press: {
    // Pressing: the bold pose is the lockout, the faint one the bar at the chest.
    start: {
      head: [44, 96],
      neck: [57, 100],
      hip: [110, 103],
      knee: [134, 96],
      foot: [142, 128],
      elbow: [78, 96],
      hand: [64, 86],
    },
    end: {
      head: [44, 96],
      neck: [57, 100],
      hip: [110, 103],
      knee: [134, 96],
      foot: [142, 128],
      elbow: [62, 80],
      hand: [62, 60],
    },
    work: ['upperArm', 'forearm', 'torso'],
    equipment: ['floor', 'bench', 'plate'],
  },
  overhead_press: {
    start: { ...STAND, elbow: [112, 57], hand: [110, 43] },
    end: { ...STAND, elbow: [106, 32], hand: [104, 17] },
    work: ['upperArm', 'forearm'],
    equipment: ['floor', 'plate'],
  },
  row: {
    start: {
      foot: [100, 128],
      knee: [108, 105],
      hip: [82, 84],
      neck: [120, 68],
      head: [131, 62],
      elbow: [122, 86],
      hand: [122, 104],
    },
    end: {
      foot: [100, 128],
      knee: [108, 105],
      hip: [82, 84],
      neck: [120, 68],
      head: [131, 62],
      elbow: [100, 74],
      hand: [114, 90],
    },
    work: ['upperArm', 'forearm'],
    equipment: ['floor', 'plate'],
  },
  band_row: {
    start: {
      foot: [98, 128],
      knee: [100, 102],
      hip: [96, 76],
      neck: [98, 44],
      head: [100, 31],
      elbow: [116, 52],
      hand: [134, 54],
    },
    end: {
      foot: [98, 128],
      knee: [100, 102],
      hip: [96, 76],
      neck: [98, 44],
      head: [100, 31],
      elbow: [84, 60],
      hand: [104, 56],
    },
    work: ['upperArm', 'forearm'],
    equipment: ['floor', 'band'],
  },
  cable_row: {
    start: {
      hip: [84, 110],
      knee: [110, 98],
      foot: [132, 112],
      neck: [86, 76],
      head: [88, 63],
      elbow: [108, 88],
      hand: [128, 92],
    },
    end: {
      hip: [84, 110],
      knee: [110, 98],
      foot: [132, 112],
      neck: [86, 76],
      head: [88, 63],
      elbow: [68, 90],
      hand: [90, 90],
    },
    work: ['upperArm', 'forearm'],
    equipment: ['floor', 'seat', 'cable'],
  },
  lat_pulldown: {
    start: {
      hip: [90, 104],
      knee: [116, 100],
      foot: [120, 128],
      neck: [94, 70],
      head: [96, 57],
      elbow: [104, 40],
      hand: [112, 16],
    },
    end: {
      hip: [90, 104],
      knee: [116, 100],
      foot: [120, 128],
      neck: [94, 70],
      head: [96, 57],
      elbow: [86, 82],
      hand: [106, 64],
    },
    work: ['upperArm', 'forearm'],
    equipment: ['floor', 'seat', 'pulldown'],
  },
  pull_up: {
    start: {
      hand: [114, 18],
      elbow: [110, 36],
      neck: [105, 54],
      head: [119, 45],
      hip: [102, 90],
      knee: [106, 112],
      foot: [94, 124],
    },
    end: {
      hand: [114, 18],
      elbow: [100, 32],
      neck: [104, 30],
      head: [106, 15],
      hip: [102, 64],
      knee: [106, 86],
      foot: [94, 98],
    },
    work: ['upperArm', 'forearm', 'torso'],
    equipment: ['bar'],
  },
};

const HEAD_R = 10.5;
const TORSO_W = [9, 8.2, 9.6] as const;
const LEG_W = [7.6, 5.9, 3.8] as const;
const ARM_W = [4.9, 3.9, 3] as const;
/** How far the far-side leg peeks out from behind the near one when the pose gives no second leg. */
const FAR_LEG_DX = 5;

/** The colours the art uses, so a legend elsewhere can match the picture instead of hard-coding a hex. */
export const EXERCISE_ART_COLORS = { work: art.figure.work, ghost: art.figure.ghost, body: art.figure.skin } as const;

const lerpPoint = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Linear interpolation of every joint the two poses share (including a lunge's knee2/foot2). */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Record<string, P> = {};
  for (const key of Object.keys(a) as (keyof Pose)[]) {
    const from = a[key];
    const to = b[key];
    if (from && to) out[key] = lerpPoint(from, to, t);
  }
  return out as unknown as Pose;
}

/** The eased pose at `t` (0 = start, 1 = end) for an exercise; null for an unknown id. */
export function poseAt(exerciseId: string, t: number): Pose | null {
  const d = DRAWINGS[exerciseId];
  if (!d) return null;
  const c = Math.min(1, Math.max(0, t));
  return lerpPose(d.start, d.end, 0.5 - 0.5 * Math.cos(Math.PI * c));
}

const DEFAULT_LOOP_MS = 2400;
const FRAME_MS = 1000 / 24;
/** Where the cosine wave counts as at rest: about 15% of the loop is spent holding each extreme. */
const REST = 0.055;

/** Loop phase (0..1) to progress between start (0) and end (1): a cosine ease with a short hold at each end. */
function loopProgress(phase: number): number {
  const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  return Math.min(1, Math.max(0, (wave - REST) / (1 - 2 * REST)));
}

// ---- geometry -------------------------------------------------------------------------------------

type V = P;
const R1 = (n: number) => Math.round(n * 10) / 10;
const fp = (x: number, y: number) => `${R1(x)} ${R1(y)}`;
const unit = (x: number, y: number): V => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};
const mix = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const nudge = (p: V, dx: number, dy: number): V => [p[0] + dx, p[1] + dy];
/** The direction light arrives from (top-left), as a unit vector. */
const LIT = unit(-0.58, -0.81);

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

/**
 * A soft tapered limb along the points, with a half-width at each, as one closed shape (so it can wear
 * the outline). With `shade` it is only the strip along the side away from the light, covering that
 * fraction of the width.
 */
function tube(pts: readonly V[], hw: readonly number[], shade = 0): string {
  const n = pts.length;
  const nor: V[] = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    const [tx, ty] = unit(b[0] - a[0], b[1] - a[1]);
    return [-ty, tx];
  });
  let away = 0;
  if (shade) {
    const m = nor[n >> 1]!;
    away = m[0] * LIT[0] + m[1] * LIT[1] > 0 ? -1 : 1;
  }
  const centre = pts.map((p, i) => (shade ? nudge(p, nor[i]![0] * away * shade * hw[i]!, nor[i]![1] * away * shade * hw[i]!) : p));
  const w = hw.map((h) => (shade ? h * (1 - shade) : h));
  const left = centre.map((p, i) => nudge(p, nor[i]![0] * w[i]!, nor[i]![1] * w[i]!));
  const right = centre.map((p, i) => nudge(p, -nor[i]![0] * w[i]!, -nor[i]![1] * w[i]!)).reverse();
  const l0 = left[0]!;
  const r0 = right[0]!;
  return `M${fp(l0[0], l0[1])}${curve(left)}A${R1(w[n - 1]!)} ${R1(w[n - 1]!)} 0 0 0 ${fp(r0[0], r0[1])}${curve(right)}A${R1(w[0]!)} ${R1(w[0]!)} 0 0 0 ${fp(l0[0], l0[1])}Z`;
}

/** The shoulder: just below the base of the neck, along the torso. */
function shoulder(p: Pose): V {
  const [ux, uy] = unit(p.hip[0] - p.neck[0], p.hip[1] - p.neck[1]);
  return [p.neck[0] + ux * 6.5, p.neck[1] + uy * 6.5];
}

/** A running shoe at the ankle: flat on the floor when the shin is upright, otherwise turned with the shin. */
function shoeD(foot: V, knee: V): string {
  const dx = foot[0] - knee[0];
  const dy = foot[1] - knee[1];
  const steep = Math.abs(dy) / (Math.abs(dx) + Math.abs(dy) || 1);
  const planted = Math.min(1, Math.max(0, (steep - 0.4) / 0.15)) * Math.min(1, Math.max(0, (foot[1] - 118) / 8));
  const [px, py] = unit(dy, -dx); // perpendicular to the shin, pointing forward
  const [tx, ty] = unit(px + (1 - px) * planted, py - py * planted);
  const sx = -ty;
  const sy = tx;
  const at = (x: number, y: number) => fp(foot[0] + tx * x + sx * y, foot[1] + ty * x + sy * y);
  return `M${at(-5.5, -5)}L${at(-5.5, 0.5)}Q${at(-5.5, 2)} ${at(-3.5, 2)}L${at(8.5, 2)}Q${at(12.2, 2)} ${at(12.2, -0.9)}Q${at(12.2, -2.8)} ${at(8.5, -3.4)}Q${at(4.5, -3.8)} ${at(2.5, -5)}Z`;
}

/** The head's local frame: turned with the neck (damped), so a push-up looks down and a bridge looks up. */
function headFrame(p: Pose) {
  const [ux, uy] = unit(p.head[0] - p.neck[0], p.head[1] - p.neck[1]);
  let a = Math.atan2(uy, ux) + Math.PI / 2;
  if (a > Math.PI) a -= 2 * Math.PI;
  a *= 0.75;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (x: number, y: number): V => [p.head[0] + x * c - y * s, p.head[1] + x * s + y * c];
}

// ---- kit ------------------------------------------------------------------------------------------

interface Kit {
  a: ArtPalette;
  /** Warm outline of the figure. */
  edge: string;
  /** Band colour. */
  primary: string;
  uid: string;
  /** Thumbnail: flat fills, no shade strips, no small details. */
  lite: boolean;
  /** Outline width: the standard line, or bold on a thumb so it survives the scale. */
  line: number;
}

function makeKit(tone: ArtTone | undefined, uid: string, lite: boolean): Kit {
  const t = tone ?? scheme;
  return { a: artPalettes[t], edge: ACCENTS[t].figureEdge, primary: palettes[t].primary, uid, lite, line: lite ? STROKE.bold : STROKE.line };
}

type MetalKey = 'iron' | 'rubber' | 'chrome';
const METAL_ID: Record<MetalKey, string> = { iron: 'i', rubber: 'r', chrome: 'c' };
/** A metal's fill: its gradient, or its body colour on a thumb. */
const metalFill = (kit: Kit, m: MetalKey) => (kit.lite ? METALS[m].mid : `url(#${kit.uid}${METAL_ID[m]})`);

function Grad({ id, m }: { id: string; m: Metal }) {
  return (
    <LinearGradient id={id} {...LIGHT_DIR}>
      <Stop offset="0" stopColor={m.hi} />
      <Stop offset="0.5" stopColor={m.mid} />
      <Stop offset="1" stopColor={m.lo} />
    </LinearGradient>
  );
}

// ---- equipment ------------------------------------------------------------------------------------

/** Gear that stands still behind the figure: drawn once, in the static layer. */
const STATIC_GEAR: readonly Equipment[] = ['bench', 'seat', 'bar', 'band', 'cable'];
const GEAR_METALS: Record<Equipment, MetalKey[]> = {
  plate: ['rubber', 'chrome'],
  dumbbell: ['chrome', 'iron'],
  kettlebell: ['iron'],
  bench: ['rubber', 'iron'],
  band: ['iron', 'chrome'],
  cable: ['iron', 'chrome'],
  pulldown: ['chrome'],
  bar: ['iron', 'chrome'],
  seat: ['rubber', 'iron'],
  floor: [],
};

function metalEdge(m: MetalKey, kit: Kit) {
  return { stroke: METALS[m].lo, strokeWidth: kit.lite ? STROKE.line : STROKE.hair, strokeLinejoin: 'round' } as const;
}

function StaticGear({ kind, kit, hip }: { kind: Equipment; kit: Kit; hip: V }) {
  const iron = metalFill(kit, 'iron');
  const rubber = metalFill(kit, 'rubber');
  const chrome = metalFill(kit, 'chrome');
  switch (kind) {
    case 'bench':
      return (
        <>
          <Rect x={48} y={118} width={6} height={12} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={116} y={118} width={6} height={12} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={38} y={110} width={92} height={8} rx={4} fill={rubber} {...metalEdge('rubber', kit)} />
        </>
      );
    case 'seat':
      return (
        <>
          <Rect x={hip[0] - 3} y={hip[1] + 14} width={6} height={130 - hip[1] - 14} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={hip[0] - 16} y={hip[1] + 7.5} width={32} height={7} rx={3.5} fill={rubber} {...metalEdge('rubber', kit)} />
        </>
      );
    case 'bar':
      return (
        <>
          <Rect x={58} y={18} width={5} height={112} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={146} y={18} width={5} height={112} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={55} y={15.5} width={98} height={5} rx={2.5} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    case 'band':
      return (
        <>
          <Rect x={176} y={40} width={6} height={90} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          {kit.lite ? null : <Circle cx={179} cy={56} r={3.2} fill={chrome} {...metalEdge('chrome', kit)} />}
        </>
      );
    case 'cable':
      return (
        <>
          <Rect x={137} y={104} width={6} height={22} rx={2} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={180} y={62} width={12} height={68} rx={3} fill={iron} {...metalEdge('iron', kit)} />
          {kit.lite ? null : <Path d="M183.5 76H188.5M183.5 106H188.5M183.5 116H188.5" fill="none" stroke={METALS.iron.rim} strokeWidth={STROKE.hair} strokeLinecap="round" />}
          <Circle cx={182} cy={92} r={5} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    default:
      return null;
  }
}

/** Gear that moves with the hands: redrawn every frame. */
function LiveGear({ kind, kit, pose, at }: { kind: Equipment; kit: Kit; pose: Pose; at?: V }) {
  const [hx, hy] = at ?? pose.hand;
  const iron = metalFill(kit, 'iron');
  const rubber = metalFill(kit, 'rubber');
  const chrome = metalFill(kit, 'chrome');
  switch (kind) {
    case 'plate': {
      // A barbell seen end-on, resting on the floor if it is low enough to touch it.
      const cy = Math.min(hy, 114);
      return (
        <>
          <Circle cx={hx} cy={cy} r={14.5} fill={rubber} stroke={METALS.rubber.rim} strokeWidth={kit.line} />
          {kit.lite ? null : <Circle cx={hx} cy={cy} r={9.5} fill="none" stroke={METALS.rubber.rim} strokeWidth={STROKE.hair} />}
          <Circle cx={hx} cy={cy} r={3.8} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    }
    case 'dumbbell':
      return (
        <>
          <Rect x={hx - 9} y={hy - 2.2} width={18} height={4.4} rx={2.2} fill={chrome} {...metalEdge('chrome', kit)} />
          <Rect x={hx - 14.5} y={hy - 7} width={6.5} height={14} rx={2.5} fill={iron} {...metalEdge('iron', kit)} />
          <Rect x={hx + 8} y={hy - 7} width={6.5} height={14} rx={2.5} fill={iron} {...metalEdge('iron', kit)} />
        </>
      );
    case 'kettlebell':
      return (
        <>
          <Path d={`M${fp(hx - 5, hy + 4)}Q${fp(hx - 5, hy - 6)} ${fp(hx, hy - 6)}Q${fp(hx + 5, hy - 6)} ${fp(hx + 5, hy + 4)}`} fill="none" stroke={METALS.iron.lo} strokeWidth={STROKE.bold} strokeLinecap="round" />
          <Circle cx={hx} cy={hy + 10} r={9} fill={iron} {...metalEdge('iron', kit)} />
        </>
      );
    case 'band':
      return <Line x1={hx} y1={hy} x2={179} y2={56} stroke={kit.primary} strokeWidth={STROKE.bold} strokeLinecap="round" />;
    case 'cable':
      return (
        <>
          <Line x1={hx} y1={hy} x2={182} y2={92} stroke={METALS.chrome.lo} strokeWidth={STROKE.line} strokeLinecap="round" />
          <Rect x={hx - 2.2} y={hy - 5.5} width={4.4} height={11} rx={2.2} fill={iron} {...metalEdge('iron', kit)} />
        </>
      );
    case 'pulldown':
      return (
        <>
          <Line x1={hx} y1={hy} x2={hx} y2={0} stroke={METALS.chrome.lo} strokeWidth={STROKE.line} strokeLinecap="round" />
          <Rect x={hx - 22} y={hy - 2.2} width={40} height={4.4} rx={2.2} fill={chrome} {...metalEdge('chrome', kit)} />
        </>
      );
    default:
      return null;
  }
}

// ---- static layers (memoised, fed only primitives) --------------------------------------------------

/** Floor, contact shadow, gradients and the gear that stands still. Never redrawn by the animation. */
const Backdrop = memo(function Backdrop({ id, tone, uid, lite }: { id: string; tone: ArtTone | undefined; uid: string; lite: boolean }) {
  const d = DRAWINGS[id];
  if (!d) return null;
  const kit = makeKit(tone, uid, lite);
  const used = new Set<MetalKey>(d.equipment.flatMap((k) => GEAR_METALS[k]));
  return (
    <>
      {lite ? null : (
        <Defs>
          <LinearGradient id={`${uid}s`} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={kit.a.figure.skin} />
            <Stop offset="1" stopColor={kit.a.figure.skinShade} />
          </LinearGradient>
          {(['iron', 'rubber', 'chrome'] as const).map((m) => (used.has(m) ? <Grad key={m} id={`${uid}${METAL_ID[m]}`} m={METALS[m]} /> : null))}
        </Defs>
      )}
      <Ellipse cx={100} cy={131} rx={70} ry={4} fill={kit.a.shadow} opacity={kit.a.shadowOpacity} />
      <Line x1={14} y1={130} x2={186} y2={130} stroke={kit.a.floorLine} strokeWidth={STROKE.line} strokeLinecap="round" />
      {d.equipment
        .filter((k) => STATIC_GEAR.includes(k))
        .map((k) => (
          <StaticGear key={k} kind={k} kit={kit} hip={d.end.hip} />
        ))}
    </>
  );
});

/** The start position as one faint silhouette in a single colour: cheap, and never redrawn. */
const Ghost = memo(function Ghost({ id, tone }: { id: string; tone: ArtTone | undefined }) {
  const d = DRAWINGS[id];
  if (!d) return null;
  const t = tone ?? scheme;
  const p = d.start;
  const S = shoulder(p);
  const parts = [tube([p.hip, mix(p.hip, S, 0.5), S], TORSO_W), tube([p.hip, p.knee, p.foot], LEG_W), tube([S, p.elbow, p.hand], ARM_W)];
  if (p.knee2 && p.foot2) parts.push(tube([p.hip, p.knee2, p.foot2], LEG_W));
  const color = artPalettes[t].figure.ghost;
  return (
    <G opacity={t === 'dark' ? 0.4 : 0.32}>
      <Path d={parts.join('')} fill={color} />
      <Circle cx={p.head[0]} cy={p.head[1]} r={HEAD_R} fill={color} />
    </G>
  );
});

/** For an exercise with no picture yet: a neutral, dashed standing figure. */
const Placeholder = memo(function Placeholder({ tone, lite }: { tone: ArtTone | undefined; lite: boolean }) {
  const a = artPalettes[tone ?? scheme];
  const dash = { fill: a.figure.ghost, fillOpacity: 0.16, stroke: a.figure.ghost, strokeWidth: lite ? STROKE.bold : STROKE.line, strokeDasharray: lite ? '5 4' : '4 3', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <>
      <Ellipse cx={100} cy={131} rx={34} ry={3.4} fill={a.shadow} opacity={a.shadowOpacity} />
      {lite ? null : <Line x1={14} y1={130} x2={186} y2={130} stroke={a.floorLine} strokeWidth={STROKE.line} strokeLinecap="round" />}
      <Circle cx={100} cy={31} r={11.5} {...dash} />
      <Path
        d="M100 47C88 47 79 52 77 63L74 88Q73.5 93 78.5 93Q83.5 93 84 88L86 71L87.5 92L89 126Q89.2 129 92.5 129L98 129L100 97L102 129L107.5 129Q110.8 129 111 126L112.5 92L114 71L116 88Q116.5 93 121.5 93Q126.5 93 126 88L123 63C121 52 112 47 100 47Z"
        {...dash}
      />
    </>
  );
});

// ---- the live figure ----------------------------------------------------------------------------------

/**
 * The person. Back to front: the back-squat bar, the far leg and arm (skinShade), the near leg and shoe,
 * the torso with its tank top, shorts, any gear the hands hold, the near arm and hand, then the head.
 */
function Figure({ pose, work, kit, back, held }: { pose: Pose; work: readonly Segment[]; kit: Kit; back?: ReactNode; held?: ReactNode }) {
  const { a, edge, lite, line } = kit;
  const fg = a.figure;
  const S = shoulder(pose);
  const skin = lite ? fg.skin : `url(#${kit.uid}s)`;
  const torsoWork = work.includes('torso');
  const legWork = work.includes('shin');
  const thighOnly = work.includes('thigh') && !legWork;
  const armWork = work.includes('upperArm') || work.includes('forearm');
  const hasFarLeg = Boolean(pose.knee2 && pose.foot2);
  const farKnee: V = pose.knee2 ?? nudge(pose.knee, FAR_LEG_DX, 0);
  const farFoot: V = pose.foot2 ?? nudge(pose.foot, FAR_LEG_DX, 0);
  const farElbow = nudge(pose.elbow, -3, 1);
  const farHand = nudge(pose.hand, -2.5, 1);
  const legPts: V[] = [pose.hip, pose.knee, pose.foot];
  const armPts: V[] = [S, pose.elbow, pose.hand];
  const torsoPts: V[] = [pose.hip, mix(pose.hip, S, 0.5), S];
  const edged = { stroke: edge, strokeWidth: line, strokeLinejoin: 'round' } as const;

  const L = headFrame(pose);
  const hair = (() => {
    const p1 = L(8.9, -5.6);
    const p2 = L(-10.1, 2.7);
    const c1 = L(-6, -3.2);
    const m = L(0, -4.6);
    const c2 = L(5.5, -4.2);
    return `M${fp(p1[0], p1[1])}A${HEAD_R} ${HEAD_R} 0 0 0 ${fp(p2[0], p2[1])}Q${fp(c1[0], c1[1])} ${fp(m[0], m[1])}Q${fp(c2[0], c2[1])} ${fp(p1[0], p1[1])}Z`;
  })();
  const ear = L(-1.4, 1.9);
  const eye = L(5.4, -0.9);

  return (
    <>
      {back}
      {hasFarLeg || !lite ? (
        <>
          <Path d={tube([pose.hip, farKnee, farFoot], LEG_W)} fill={fg.skinShade} {...edged} />
          <Path d={shoeD(farFoot, farKnee)} fill={fg.shoe} {...edged} />
          <Path d={tube([pose.hip, mix(pose.hip, farKnee, 0.34)], [LEG_W[0] + 1.4, LEG_W[0] + 0.5])} fill={fg.shorts} {...edged} />
        </>
      ) : null}
      {lite ? null : <Path d={tube([S, farElbow, farHand], ARM_W)} fill={fg.skinShade} {...edged} />}
      {lite ? null : <Circle cx={farHand[0]} cy={farHand[1]} r={3.7} fill={fg.skinShade} {...edged} />}
      {lite ? null : <Path d={tube([pose.neck, pose.head], [3.4, 3.4])} fill={fg.skinShade} {...edged} />}
      <Path d={tube(legPts, LEG_W)} fill={legWork ? fg.work : fg.skin} {...edged} />
      {lite ? null : <Path d={tube(legPts, LEG_W, 0.6)} fill={legWork ? fg.workDeep : fg.skinShade} />}
      {thighOnly ? <Path d={tube([pose.hip, pose.knee], [LEG_W[0], LEG_W[1]])} fill={fg.work} {...edged} /> : null}
      <Path d={shoeD(pose.foot, pose.knee)} fill={fg.shoe} {...edged} />
      <Path d={tube(torsoPts, TORSO_W)} fill={torsoWork ? fg.work : fg.top} {...edged} />
      {lite ? null : <Path d={tube(torsoPts, TORSO_W, 0.6)} fill={torsoWork ? fg.workDeep : a.shadow} opacity={torsoWork ? undefined : 0.22} />}
      <Path d={tube([pose.hip, mix(pose.hip, pose.knee, 0.34)], [LEG_W[0] + 1.9, LEG_W[0] + 0.7])} fill={fg.shorts} {...edged} />
      {held}
      <Path d={tube(armPts, ARM_W)} fill={armWork ? fg.work : fg.skin} {...edged} />
      {lite ? null : <Path d={tube(armPts, ARM_W, 0.6)} fill={armWork ? fg.workDeep : fg.skinShade} />}
      <Circle cx={pose.head[0]} cy={pose.head[1]} r={HEAD_R} fill={skin} {...edged} />
      {lite ? null : <Circle cx={ear[0]} cy={ear[1]} r={2.3} fill={fg.skinShade} stroke={edge} strokeWidth={STROKE.hair} />}
      <Path d={hair} fill={fg.hair} {...edged} />
      {lite ? null : <Circle cx={eye[0]} cy={eye[1]} r={1.15} fill={a.featureInk} />}
      <Circle cx={pose.hand[0]} cy={pose.hand[1]} r={lite ? 4.4 : 3.9} fill={skin} {...edged} />
    </>
  );
}


/** A movement picture for any exercise id (a dashed placeholder figure for an id with no drawing yet). */
export function ExerciseArt({
  exerciseId,
  name,
  size = 'card',
  decorative,
  style,
  animated = false,
  loopMs = DEFAULT_LOOP_MS,
  tone,
}: {
  exerciseId: string;
  name?: string;
  size?: 'thumb' | 'card' | 'hero';
  /** Hide from screen readers when the surrounding row already names the exercise. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Play the movement start to finish on a loop (skipped under reduced motion). Leave off in lists. */
  animated?: boolean;
  /** Length of one full start-finish-start loop. */
  loopMs?: number;
  /** Draw in this tone instead of the app's scheme (the gallery shows both). */
  tone?: ArtTone;
}) {
  const d = DRAWINGS[exerciseId];
  // Every instance of a tone defines the same gradients, so one id per tone is enough (and keeps the tree identical between mounts).
  const uid = `ex${tone ?? scheme}`;
  const reduceMotion = useReducedMotion();
  // An id with no drawing is a still placeholder, so it never starts the frame loop.
  const play = animated && !reduceMotion && d !== undefined;
  const [phase, setPhase] = useState(0);
  // The frame loop runs only while the app is in the foreground, so a backgrounded app burns no CPU.
  useEffect(() => {
    if (!play) return;
    const period = Math.max(300, loopMs);
    let id: ReturnType<typeof setInterval> | undefined;
    let began = 0;
    let elapsed = 0; // carried across a pause so the figure resumes where it left off
    const start = () => {
      if (id !== undefined) return;
      began = Date.now() - elapsed;
      id = setInterval(() => setPhase(((Date.now() - began) / period) % 1), FRAME_MS);
    };
    const stop = () => {
      if (id === undefined) return;
      clearInterval(id);
      id = undefined;
      elapsed = Date.now() - began;
    };
    const state = AppState.currentState;
    if (state !== 'background' && state !== 'inactive') start();
    const sub = AppState.addEventListener('change', (next) => (next === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [play, loopMs]);

  const height = size === 'thumb' ? 56 : size === 'card' ? 140 : 200;
  const lite = size === 'thumb';
  const label = d ? `${name ?? 'Exercise'} illustration` : `${name ?? 'Exercise'} illustration coming soon`;
  const kit = makeKit(tone, uid, lite);
  let figure: ReactNode;
  if (d) {
    const live = play ? lerpPose(d.start, d.end, loopProgress(phase)) : d.end;
    const squatBar = exerciseId === 'squat';
    const held = d.equipment
      .filter((k) => !STATIC_GEAR.includes(k) && k !== 'floor' && !(k === 'plate' && squatBar))
      .map((k) => <LiveGear key={k} kind={k} kit={kit} pose={live} />);
    // Bands and cables run to the hand; the static part of the same gear sits behind in the backdrop.
    for (const k of d.equipment) if ((k === 'band' || k === 'cable') && STATIC_GEAR.includes(k)) held.push(<LiveGear key={`${k}-line`} kind={k} kit={kit} pose={live} />);
    const back = squatBar ? <LiveGear kind="plate" kit={kit} pose={live} at={[live.neck[0] - 2, live.neck[1] + 1]} /> : undefined;
    figure = (
      <>
        <Backdrop id={exerciseId} tone={tone} uid={uid} lite={lite} />
        {lite ? null : <Ghost id={exerciseId} tone={tone} />}
        <Figure pose={live} work={d.work} kit={kit} back={back} held={held} />
      </>
    );
  } else {
    figure = <Placeholder tone={tone} lite={lite} />;
  }
  return (
    <View
      style={[{ height, aspectRatio: 200 / 140 }, style]}
      {...(decorative
        ? {
            accessible: false,
            importantForAccessibility: 'no-hide-descendants' as const,
            'aria-hidden': true,
          }
        : {
            accessible: true,
            accessibilityRole: 'image' as const,
            accessibilityLabel: label,
          })}>
      <Svg width="100%" height="100%" viewBox="0 0 200 140">
        {figure}
      </Svg>
    </View>
  );
}

/** A small rounded tile with the exercise drawing, for list rows. */
export function ExerciseThumb({ exerciseId, size = 52, tone }: { exerciseId: string; size?: number; tone?: ArtTone }) {
  return (
    <View
      style={{
        width: size * 1.25,
        height: size,
        borderRadius: 12,
        backgroundColor: artPalettes[tone ?? scheme].surface,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <ExerciseArt exerciseId={exerciseId} size="thumb" decorative tone={tone} style={{ height: size * 0.95 }} />
    </View>
  );
}

export const ILLUSTRATED_EXERCISES = Object.keys(DRAWINGS);
