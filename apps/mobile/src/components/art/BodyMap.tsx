import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { colors, fonts, scheme } from '@/theme/tokens';

/**
 * An anatomical muscle map, front and back: a shaded figure whose worked muscles light up — the
 * main movers bright, the helpers softer, or a heat scale (e.g. sets per muscle). Matches the
 * catalogue's muscle groups exactly. `MuscleThumb` zooms in on one group, for filters and lists.
 */

export type Muscle = 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'chest' | 'back' | 'lats' | 'shoulders' | 'biceps' | 'triceps' | 'core';
export const MUSCLES: Muscle[] = ['chest', 'back', 'lats', 'shoulders', 'biceps', 'triceps', 'core', 'glutes', 'quads', 'hamstrings', 'calves'];
export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: 'Chest',
  back: 'Back',
  lats: 'Lats',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  core: 'Core',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
};

const dark = scheme === 'dark';
const SKIN_TOP = dark ? '#5A483D' : '#F3E6D6';
const SKIN_BOTTOM = dark ? '#3E3129' : '#E3D1BC';
const MUSCLE_TOP = dark ? '#6B574A' : '#E9D7C2';
const MUSCLE_BOTTOM = dark ? '#4E3F35' : '#D7C1A8';
const OUTLINE = dark ? 'rgba(0,0,0,0.35)' : 'rgba(90,62,43,0.22)';
const ACTIVE_TOP = '#FF8C6B';
const ACTIVE_BOTTOM = '#CF3F2A';

type View2 = 'front' | 'back';

/** Left-half muscle paths for a figure centred on x=0 (mirrored for the right). */
const SHAPES: Record<View2, Partial<Record<Muscle, string[]>>> = {
  front: {
    shoulders: ['M-23 39 Q-35 41 -34 56 Q-27 53 -21 46 Z'],
    chest: ['M-1 42 Q-12 39 -22 45 Q-24 56 -15 60 Q-6 62 -1 58 Z'],
    biceps: ['M-33 59 Q-36 69 -32 79 Q-27 75 -26 61 Z'],
    core: ['M-8 64 h6.5 v8.5 h-6.5 Z', 'M-8 74.5 h6.5 v8.5 h-6.5 Z', 'M-8 85 h6.5 v9.5 h-6.5 Z', 'M-16 62 Q-20 77 -16 93 L-10 95 L-10 63 Z'],
    quads: ['M-17 117 Q-21 133 -16 151 Q-10 155 -5 151 Q-3 133 -4 119 Z'],
    calves: ['M-15 158 Q-17 167 -13 177 Q-10 173 -9 160 Z'],
  },
  back: {
    back: ['M0 28 Q-10 32 -22 40 Q-12 47 0 63 Z', 'M-6 79 h5 v19 h-5 Z'],
    shoulders: ['M-23 39 Q-35 41 -34 56 Q-27 53 -21 46 Z'],
    lats: ['M-21 49 Q-25 63 -17 82 L-3 90 L-3 67 Z'],
    triceps: ['M-33 59 Q-37 70 -32 80 Q-27 73 -27 61 Z'],
    glutes: ['M-1 101 Q-16 99 -18 111 Q-14 123 -1 119 Z'],
    hamstrings: ['M-17 123 Q-20 137 -15 151 Q-10 154 -6 151 Q-4 137 -4 123 Z'],
    calves: ['M-15 155 Q-19 165 -14 177 Q-9 175 -8 157 Z'],
  },
};

/** The figure outline, left half (x ≤ 0), drawn once per side. */
const BODY_PARTS = [
  'M-6 26 Q-14 34 -24 38 L0 38 Z', // trapezius slope
  'M-24 38 Q-29 52 -24 68 Q-20 88 -17 102 L0 102 L0 38 Z', // torso
  'M-24 39 Q-36 43 -35 59 L-32 81 Q-27 83 -25 80 L-22 56 Z', // upper arm
  'M-34 80 Q-38 93 -37 105 L-33 107 Q-29 95 -27 82 Z', // forearm
  'M-17 100 Q-21 109 -18 117 L0 117 L0 100 Z', // hips
  'M-18 113 Q-23 133 -16 153 L-5 153 Q-2 133 -2 115 Z', // thigh
  'M-16 152 Q-18 169 -13 185 L-6 185 Q-5 168 -6 152 Z', // shin
];

function Figure({ cx, view, heat, ids }: { cx: number; view: View2; heat: Map<string, number>; ids: { skin: string; muscle: string; active: string } }) {
  const half = (d: string, fill: string, k: string, extra?: { opacity?: number; stroke?: string }) => (
    <G key={k}>
      <Path d={d} fill={fill} opacity={extra?.opacity} stroke={extra?.stroke ?? OUTLINE} strokeWidth={0.6} transform={`translate(${cx} 0)`} />
      <Path d={d} fill={fill} opacity={extra?.opacity} stroke={extra?.stroke ?? OUTLINE} strokeWidth={0.6} transform={`translate(${cx} 0) scale(-1 1)`} />
    </G>
  );
  return (
    <G>
      <Ellipse cx={cx} cy={192} rx={26} ry={3.5} fill="#000000" opacity={dark ? 0.35 : 0.08} />
      {BODY_PARTS.map((d, i) => half(d, `url(#${ids.skin})`, `b${i}`))}
      <Ellipse cx={cx} cy={16} rx={10.5} ry={12.5} fill={`url(#${ids.skin})`} stroke={OUTLINE} strokeWidth={0.6} />
      <Ellipse cx={cx - 36} cy={109} rx={3.6} ry={4.6} fill={`url(#${ids.skin})`} />
      <Ellipse cx={cx + 36} cy={109} rx={3.6} ry={4.6} fill={`url(#${ids.skin})`} />
      <Ellipse cx={cx - 10} cy={187} rx={6} ry={3} fill={`url(#${ids.skin})`} />
      <Ellipse cx={cx + 10} cy={187} rx={6} ry={3} fill={`url(#${ids.skin})`} />
      {(Object.keys(SHAPES[view]) as Muscle[]).map((m) => {
        const h = heat.get(m) ?? 0;
        return SHAPES[view][m]!.map((d, i) => (
          <G key={`${m}${i}`}>
            {half(d, `url(#${ids.muscle})`, `${m}${i}base`)}
            {h > 0 ? half(d, `url(#${ids.active})`, `${m}${i}on`, { opacity: 0.35 + 0.65 * h, stroke: 'rgba(120,20,10,0.35)' }) : null}
          </G>
        ));
      })}
      {/* A soft highlight down the figure's lit side. */}
      <Path d={`M${cx - 20} 44 Q${cx - 24} 60 ${cx - 19} 80`} stroke="#FFFFFF" strokeOpacity={dark ? 0.08 : 0.4} strokeWidth={2} fill="none" strokeLinecap="round" />
    </G>
  );
}

function Gradients({ ids }: { ids: { skin: string; muscle: string; active: string } }) {
  return (
    <Defs>
      <LinearGradient id={ids.skin} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={SKIN_TOP} />
        <Stop offset="1" stopColor={SKIN_BOTTOM} />
      </LinearGradient>
      <LinearGradient id={ids.muscle} x1="0.2" y1="0" x2="0.8" y2="1">
        <Stop offset="0" stopColor={MUSCLE_TOP} />
        <Stop offset="1" stopColor={MUSCLE_BOTTOM} />
      </LinearGradient>
      <LinearGradient id={ids.active} x1="0.2" y1="0" x2="0.8" y2="1">
        <Stop offset="0" stopColor={ACTIVE_TOP} />
        <Stop offset="1" stopColor={ACTIVE_BOTTOM} />
      </LinearGradient>
    </Defs>
  );
}

function useIds() {
  const base = `bm${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return { skin: `${base}s`, muscle: `${base}m`, active: `${base}a` };
}

/**
 * Front and back. `primary` muscles at full strength and `secondary` softer — or pass `heat`
 * (0–1 per muscle) to shade by how much each was trained.
 */
export function BodyMap({
  primary = [],
  secondary = [],
  heat,
  height = 200,
  showLabels = true,
  style,
  accessibilityLabel,
}: {
  primary?: string[];
  secondary?: string[];
  heat?: Partial<Record<Muscle, number>>;
  height?: number;
  showLabels?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const ids = useIds();
  const p = new Set(primary);
  const s = secondary.filter((m) => !p.has(m));
  const levels = new Map<string, number>();
  if (heat) {
    for (const [m, v] of Object.entries(heat)) if (v && v > 0) levels.set(m, Math.min(1, v));
  } else {
    for (const m of s) levels.set(m, 0.3);
    for (const m of p) levels.set(m, 1);
  }
  const label =
    accessibilityLabel ?? (heat ? `Muscles trained: ${[...levels.keys()].map((m) => MUSCLE_LABEL[m as Muscle] ?? m).join(', ') || 'none yet'}` : `Muscles worked: ${primary.join(', ')}${s.length ? `; also ${s.join(', ')}` : ''}`);
  return (
    <View style={[{ height, aspectRatio: 220 / 205 }, style]} accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width="100%" height="100%" viewBox="0 0 220 205">
        <Gradients ids={ids} />
        <Figure cx={55} view="front" heat={levels} ids={ids} />
        <Figure cx={165} view="back" heat={levels} ids={ids} />
        {showLabels ? (
          <>
            <SvgText x={55} y={203} fill={colors.textFaint} fontSize={8.5} fontFamily={fonts.semibold} fontWeight="700" letterSpacing={1.2} textAnchor="middle">
              FRONT
            </SvgText>
            <SvgText x={165} y={203} fill={colors.textFaint} fontSize={8.5} fontFamily={fonts.semibold} fontWeight="700" letterSpacing={1.2} textAnchor="middle">
              BACK
            </SvgText>
          </>
        ) : null}
      </Svg>
    </View>
  );
}

/** Where to look for each muscle: which side of the body, and the crop (x, y, w, h) around it. */
const THUMB: Record<Muscle, { view: View2; box: [number, number, number, number] }> = {
  chest: { view: 'front', box: [-30, 26, 60, 46] },
  shoulders: { view: 'front', box: [-40, 24, 52, 46] },
  biceps: { view: 'front', box: [-44, 40, 46, 50] },
  core: { view: 'front', box: [-26, 52, 52, 52] },
  quads: { view: 'front', box: [-28, 106, 56, 56] },
  back: { view: 'back', box: [-32, 22, 64, 64] },
  lats: { view: 'back', box: [-32, 38, 64, 60] },
  triceps: { view: 'back', box: [-44, 40, 46, 50] },
  glutes: { view: 'back', box: [-26, 90, 52, 42] },
  hamstrings: { view: 'back', box: [-28, 110, 56, 52] },
  calves: { view: 'back', box: [-26, 144, 52, 46] },
};

/** One muscle group, close up in a round frame — lit when `active`. For filters and muscle lists. */
export function MuscleThumb({ muscle, size = 56, active = true, intensity = 1, style }: { muscle: Muscle; size?: number; active?: boolean; intensity?: number; style?: StyleProp<ViewStyle> }) {
  const ids = useIds();
  const t = THUMB[muscle];
  const [x, y, w, h] = t.box;
  const side = Math.max(w, h);
  const vb = `${x + w / 2 - side / 2} ${y + h / 2 - side / 2} ${side} ${side}`;
  const heat = new Map<string, number>(active ? [[muscle, intensity]] : []);
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: colors.cardRaised }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox={vb}>
        <Gradients ids={ids} />
        <Rect x={x - side} y={y - side} width={side * 3} height={side * 3} fill={colors.cardRaised} />
        <Circle cx={x + w / 2} cy={y + h / 2} r={side * 0.45} fill={active ? colors.primarySoft : 'transparent'} />
        <Figure cx={0} view={t.view} heat={heat} ids={ids} />
      </Svg>
    </View>
  );
}
