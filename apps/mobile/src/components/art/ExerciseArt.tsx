import { useEffect, useState } from 'react';
import { AppState, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Rect } from 'react-native-svg';
import { useReducedMotion } from '@/lib/a11y';
import { colors } from '@/theme/tokens';

/**
 * Exercise illustrations — original vector art drawn from a small figure rig, so every movement in
 * the catalogue has an accurate picture: the start position faint, the working position bold, the
 * muscles doing the work in terracotta, and the equipment it uses. Side view, facing right. Limbs are
 * shaded tubes with a crisp dark edge so they stay sharp at thumbnail size.
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
      elbow: [112, 90],
      hand: [110, 110],
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
      hand: [104, 18],
      elbow: [104, 36],
      neck: [104, 54],
      head: [110, 44],
      hip: [102, 90],
      knee: [106, 112],
      foot: [94, 124],
    },
    end: {
      hand: [104, 18],
      elbow: [90, 32],
      neck: [104, 30],
      head: [108, 17],
      hip: [102, 64],
      knee: [106, 86],
      foot: [94, 98],
    },
    work: ['upperArm', 'forearm', 'torso'],
    equipment: ['bar'],
  },
};

const WIDTH: Record<Segment, number> = {
  torso: 15,
  thigh: 12,
  shin: 10,
  upperArm: 9,
  forearm: 8,
};
const BODY = '#F6DCC6';
const FAR = '#D9B79B';
const GHOST = '#B8957A';
const WORK = '#E06A44';
const EDGE = '#5A3E2B';
const EQUIP = '#8C705C';
const EQUIP_EDGE = '#5E4838';

/** The colours the art uses, so a legend elsewhere can match the picture instead of hard-coding a hex. */
export const EXERCISE_ART_COLORS = { work: WORK, ghost: GHOST, body: BODY } as const;

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

function Limb({ a, b, seg, work, color, flat }: { a: P; b: P; seg: Segment; work: Segment[]; color?: string; flat?: boolean }) {
  const w = WIDTH[seg];
  const c = color ?? (work.includes(seg) ? WORK : BODY);
  if (flat) return <Line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={w} strokeLinecap="round" />;
  // Edge, fill, then a narrow highlight down the middle: reads as a rounded limb, not a flat stroke.
  return (
    <G>
      <Line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={EDGE} strokeWidth={w + 2.5} strokeLinecap="round" />
      <Line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={c} strokeWidth={w} strokeLinecap="round" />
      <Line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#FFFFFF" strokeOpacity={0.28} strokeWidth={w * 0.3} strokeLinecap="round" />
    </G>
  );
}

function Figure({ pose, work, ghost }: { pose: Pose; work: Segment[]; ghost?: boolean }) {
  const o = ghost ? 0.3 : 1;
  const tint = ghost ? GHOST : undefined;
  return (
    <G opacity={o}>
      {pose.knee2 && pose.foot2 ? (
        <>
          <Limb a={pose.hip} b={pose.knee2} seg="thigh" work={[]} color={ghost ? GHOST : FAR} flat={ghost} />
          <Limb a={pose.knee2} b={pose.foot2} seg="shin" work={[]} color={ghost ? GHOST : FAR} flat={ghost} />
        </>
      ) : null}
      <Limb a={pose.hip} b={pose.neck} seg="torso" work={work} color={tint} flat={ghost} />
      <Limb a={pose.hip} b={pose.knee} seg="thigh" work={work} color={tint} flat={ghost} />
      <Limb a={pose.knee} b={pose.foot} seg="shin" work={work} color={tint} flat={ghost} />
      <Limb a={pose.neck} b={pose.elbow} seg="upperArm" work={work} color={tint} flat={ghost} />
      <Limb a={pose.elbow} b={pose.hand} seg="forearm" work={work} color={tint} flat={ghost} />
      {/* Feet: a short foot forward wherever a foot is planted on the floor. */}
      {[pose.foot, pose.knee2 && pose.foot2 ? pose.foot2 : null].map((ft, i) =>
        ft && ft[1] >= 124 ? <Line key={i} x1={ft[0] - 2} y1={ft[1]} x2={ft[0] + 9} y2={ft[1] + 1} stroke={i === 1 && !ghost ? FAR : (tint ?? EDGE)} strokeWidth={7} strokeLinecap="round" /> : null,
      )}
      <Circle cx={pose.head[0]} cy={pose.head[1]} r={10} fill={ghost ? GHOST : BODY} stroke={ghost ? undefined : EDGE} strokeWidth={ghost ? 0 : 1.5} />
    </G>
  );
}

function Gear({ kind, pose }: { kind: Equipment; pose: Pose }) {
  const [hx, hy] = pose.hand;
  switch (kind) {
    case 'floor':
      return <Line x1={14} y1={130} x2={186} y2={130} stroke={colors.borderStrong} strokeWidth={2} strokeLinecap="round" />;
    case 'plate': {
      // A barbell seen end-on: the plate sits where the hands hold the bar (on the back for a back squat).
      const at = pose.hand;
      return (
        <G>
          <Circle cx={at[0]} cy={at[1]} r={15} fill={EQUIP} stroke={EQUIP_EDGE} strokeWidth={3} />
          <Circle cx={at[0]} cy={at[1]} r={3.5} fill={EQUIP_EDGE} />
        </G>
      );
    }
    case 'dumbbell':
      return (
        <G>
          <Rect x={hx - 8} y={hy - 4} width={16} height={8} rx={3} fill={EQUIP_EDGE} />
          <Rect x={hx - 11} y={hy - 6} width={5} height={12} rx={2} fill={EQUIP} />
          <Rect x={hx + 6} y={hy - 6} width={5} height={12} rx={2} fill={EQUIP} />
        </G>
      );
    case 'kettlebell':
      return (
        <G>
          <Circle cx={hx} cy={hy + 8} r={8} fill={EQUIP} stroke={EQUIP_EDGE} strokeWidth={2} />
          <Rect x={hx - 5} y={hy - 2} width={10} height={6} rx={3} fill="none" stroke={EQUIP_EDGE} strokeWidth={2.5} />
        </G>
      );
    case 'bench':
      return (
        <G>
          <Rect x={38} y={108} width={92} height={7} rx={3} fill={EQUIP} />
          <Rect x={46} y={115} width={5} height={14} fill={EQUIP} />
          <Rect x={118} y={115} width={5} height={14} fill={EQUIP} />
        </G>
      );
    case 'seat':
      return <Rect x={pose.hip[0] - 14} y={pose.hip[1] + 4} width={28} height={130 - pose.hip[1] - 4} rx={3} fill={EQUIP} />;
    case 'band':
      return (
        <G>
          <Rect x={176} y={40} width={6} height={90} rx={2} fill={EQUIP} />
          <Line x1={hx} y1={hy} x2={178} y2={56} stroke={colors.primary} strokeWidth={2.5} strokeDasharray="5 4" opacity={0.7} />
        </G>
      );
    case 'cable':
      return (
        <G>
          <Rect x={182} y={70} width={8} height={60} rx={2} fill={EQUIP} />
          <Circle cx={182} cy={92} r={5} fill={EQUIP_EDGE} />
          <Line x1={hx} y1={hy} x2={182} y2={92} stroke={EQUIP_EDGE} strokeWidth={2} />
          <Rect x={136} y={104} width={6} height={22} rx={2} fill={EQUIP} />
        </G>
      );
    case 'pulldown':
      return (
        <G>
          <Line x1={hx - 22} y1={hy} x2={hx + 18} y2={hy} stroke={EQUIP_EDGE} strokeWidth={4} strokeLinecap="round" />
          <Line x1={hx} y1={hy} x2={hx} y2={0} stroke={EQUIP_EDGE} strokeWidth={2} />
        </G>
      );
    case 'bar':
      return (
        <G>
          <Line x1={56} y1={18} x2={152} y2={18} stroke={EQUIP_EDGE} strokeWidth={5} strokeLinecap="round" />
          <Line x1={60} y1={18} x2={60} y2={130} stroke={EQUIP} strokeWidth={5} />
          <Line x1={148} y1={18} x2={148} y2={130} stroke={EQUIP} strokeWidth={5} />
        </G>
      );
  }
}

/** A movement picture for any exercise id (a neutral standing figure for an unknown id). */
export function ExerciseArt({
  exerciseId,
  name,
  size = 'card',
  decorative,
  style,
  animated = false,
  loopMs = DEFAULT_LOOP_MS,
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
}) {
  const reduceMotion = useReducedMotion();
  const play = animated && !reduceMotion;
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
  const d = DRAWINGS[exerciseId] ?? DRAWINGS.bodyweight_squat!;
  const live = play ? lerpPose(d.start, d.end, loopProgress(phase)) : d.end;
  const height = size === 'thumb' ? 56 : size === 'card' ? 140 : 200;
  const behind: Equipment[] = d.equipment.filter((e) => e === 'bench' || e === 'seat' || e === 'bar' || e === 'band' || e === 'cable');
  const inFront = d.equipment.filter((e) => !behind.includes(e) && e !== 'floor');
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
            accessibilityLabel: `${name ?? 'Exercise'} illustration`,
          })}>
      <Svg width="100%" height="100%" viewBox="0 0 200 140">
        <Ellipse cx={100} cy={131} rx={70} ry={4} fill="#7A4A26" opacity={0.12} />
        {d.equipment.includes('floor') ? <Gear kind="floor" pose={live} /> : null}
        {behind.map((k) => (
          <Gear key={k} kind={k} pose={live} />
        ))}
        <Figure pose={d.start} work={d.work} ghost />
        {d.equipment.includes('plate') && exerciseId === 'squat' ? <Gear kind="plate" pose={{ ...live, hand: live.neck }} /> : null}
        <Figure pose={live} work={d.work} />
        {inFront
          .filter((k) => !(k === 'plate' && exerciseId === 'squat'))
          .map((k) => (
            <Gear key={k} kind={k} pose={live} />
          ))}
      </Svg>
    </View>
  );
}

/** A small rounded tile with the exercise drawing, for list rows. */
export function ExerciseThumb({ exerciseId, size = 52 }: { exerciseId: string; size?: number }) {
  return (
    <View
      style={{
        width: size * 1.25,
        height: size,
        borderRadius: 12,
        backgroundColor: colors.cardRaised,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <ExerciseArt exerciseId={exerciseId} decorative style={{ height: size * 0.95 }} />
    </View>
  );
}

export const ILLUSTRATED_EXERCISES = Object.keys(DRAWINGS);
