import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { scheme } from '@/theme/tokens';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from 'react-native-svg';

/**
 * Rank emblems — a metal shield per rank, each a step up from the last:
 * Rookie (oak) → Starter (bronze) → Athlete (silver) → Iron (blued steel) → Elite (gold) →
 * Master (platinum, laurels) → Champion (sapphire, gold laurels).
 */

export type RankName = 'Rookie' | 'Starter' | 'Athlete' | 'Iron' | 'Elite' | 'Master' | 'Champion';

interface Tier {
  /** Metal gradient, light to dark. */
  metal: [string, string, string];
  rim: string;
  ink: string;
  symbol: 'chevron1' | 'chevron2' | 'chevron3' | 'dumbbell' | 'star' | 'laurelStar' | 'crown';
  laurel?: string;
}

const TIERS: Record<RankName, Tier> = {
  Rookie: { metal: ['#C9925E', '#8A5A33', '#5A3A20'], rim: '#D9A877', ink: '#FFF3E6', symbol: 'chevron1' },
  Starter: { metal: ['#F0B27A', '#B86B35', '#6E3A16'], rim: '#F6C79A', ink: '#FFF4EA', symbol: 'chevron2' },
  Athlete: { metal: ['#FFFFFF', '#C3CAD3', '#7E8894'], rim: '#F2F5F8', ink: '#2A323C', symbol: 'chevron3' },
  Iron: { metal: ['#8EA4C2', '#4B5F7D', '#222D3F'], rim: '#A9C1E3', ink: '#F2F6FC', symbol: 'dumbbell' },
  Elite: { metal: ['#FFE89A', '#F2B829', '#9A6A08'], rim: '#FFF1BF', ink: '#4A3404', symbol: 'star' },
  Master: { metal: ['#F4FBFF', '#A8D8EC', '#5B8FA8'], rim: '#E6F7FF', ink: '#163646', symbol: 'laurelStar', laurel: '#BFE7F7' },
  Champion: { metal: ['#7DB4FF', '#2B6CF0', '#152E78'], rim: '#FFD66B', ink: '#FFFFFF', symbol: 'crown', laurel: '#FFC83D' },
};

/** Each rank's colour for text that names it — the metal, deepened for cream or brightened for the evening palette (≥ 4.5:1). */
const RANK_TEXT: Record<'light' | 'dark', Record<RankName, string>> = {
  light: { Rookie: '#87552F', Starter: '#94501F', Athlete: '#5A6572', Iron: '#3F5170', Elite: '#80580A', Master: '#386A82', Champion: '#2650AE' },
  dark: { Rookie: '#E3AE80', Starter: '#F2B784', Athlete: '#D9DFE6', Iron: '#AFC5E5', Elite: '#F5CF63', Master: '#ADDBEE', Champion: '#93BEFF' },
};

export const rankColorFor = (rank: string, mood: 'light' | 'dark') => RANK_TEXT[mood][rank as RankName] ?? RANK_TEXT[mood].Rookie;

/** The rank's signature colour, for text that names the rank. */
export const rankColor = (rank: string) => rankColorFor(rank, scheme);

/** A rank not reached yet: unpolished clay, light or dark to sit quietly on the page. */
const LOCKED =
  scheme === 'dark'
    ? { metal: ['#4A3B31', '#3D3028', '#30251F'], edge: '#5E4C3F', ink: '#8C7562', shine: 0.06 }
    : { metal: ['#F3EADF', '#E6D8C6', '#D6C4AD'], edge: '#CDBBA4', ink: '#B29C85', shine: 0.25 };

export const RANK_ORDER: RankName[] = ['Rookie', 'Starter', 'Athlete', 'Iron', 'Elite', 'Master', 'Champion'];

const SHIELD = 'M50 4 L91 17 L91 50 C91 76 74 94 50 104 C26 94 9 76 9 50 L9 17 Z';
const INNER = 'M50 12 L83 22.5 L83 50 C83 71 69 86 50 95 C31 86 17 71 17 50 L17 22.5 Z';
/** The top-left bevel catching the light. */
const SHINE = 'M50 4 L91 17 L91 30 C70 26 40 38 9 52 L9 17 Z';

function Chevrons({ n, ink }: { n: number; ink: string }) {
  return (
    <G>
      {Array.from({ length: n }, (_, i) => (
        <Path key={i} d={`M33 ${68 - i * 13} L50 ${57 - i * 13} L67 ${68 - i * 13}`} stroke={ink} strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
    </G>
  );
}

const STAR = (cx: number, cy: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

function RankSymbol({ t }: { t: Tier }) {
  switch (t.symbol) {
    case 'chevron1':
      return <Chevrons n={1} ink={t.ink} />;
    case 'chevron2':
      return <Chevrons n={2} ink={t.ink} />;
    case 'chevron3':
      return <Chevrons n={3} ink={t.ink} />;
    case 'dumbbell':
      return (
        <G>
          <Rect x={31} y={49} width={38} height={7} rx={3.5} fill={t.ink} />
          <Rect x={24} y={39} width={10} height={27} rx={3} fill={t.ink} />
          <Rect x={66} y={39} width={10} height={27} rx={3} fill={t.ink} />
        </G>
      );
    case 'star':
      return <Polygon points={STAR(50, 52, 23)} fill={t.ink} />;
    case 'laurelStar':
      return (
        <G>
          <Polygon points={STAR(50, 48, 17)} fill={t.ink} />
          <Path d="M34 70 Q50 80 66 70" stroke={t.ink} strokeWidth={4} fill="none" strokeLinecap="round" />
        </G>
      );
    case 'crown':
      return (
        <G>
          <Path d="M29 66 L33 37 L43 51 L50 32 L57 51 L67 37 L71 66 Z" fill={t.ink} />
          <Rect x={29} y={68} width={42} height={6} rx={3} fill={t.ink} />
          <Circle cx={50} cy={29} r={3.5} fill={t.ink} />
          <Circle cx={33} cy={34} r={3} fill={t.ink} />
          <Circle cx={67} cy={34} r={3} fill={t.ink} />
        </G>
      );
  }
}

/** Two laurel branches curving up the sides of the shield. */
function Laurel({ color }: { color: string }) {
  const leaves = Array.from({ length: 6 }, (_, i) => {
    const deg = 105 + i * 17;
    const a = (deg * Math.PI) / 180;
    return { x: 50 + 47 * Math.cos(a), y: 60 + 47 * Math.sin(a), r: (deg + 90) % 360 };
  });
  return (
    <G>
      {leaves.map((l, i) => (
        <G key={i}>
          <Ellipse cx={l.x} cy={l.y} rx={7.5} ry={3.4} fill={color} transform={`rotate(${l.r} ${l.x} ${l.y})`} />
          <Ellipse cx={100 - l.x} cy={l.y} rx={7.5} ry={3.4} fill={color} transform={`rotate(${180 - l.r} ${100 - l.x} ${l.y})`} />
        </G>
      ))}
    </G>
  );
}

export function RankEmblem({ rank, size = 56, locked, style }: { rank: string; size?: number; locked?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = TIERS[(rank as RankName) in TIERS ? (rank as RankName) : 'Rookie'];
  const id = `rank${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const metal = locked ? LOCKED.metal : t.metal;
  const laurel = !locked && t.laurel;
  return (
    <View style={[{ width: size, height: size * 1.08 }, style]} accessible accessibilityRole="image" accessibilityLabel={`${rank} rank${locked ? ', not reached yet' : ''}`}>
      <Svg width="100%" height="100%" viewBox="0 0 100 108">
        <Defs>
          <LinearGradient id={`${id}m`} x1="0.15" y1="0" x2="0.85" y2="1">
            <Stop offset="0" stopColor={metal[0]} />
            <Stop offset="0.5" stopColor={metal[1]} />
            <Stop offset="1" stopColor={metal[2]} />
          </LinearGradient>
          <LinearGradient id={`${id}i`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity={0.05} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0.3} />
          </LinearGradient>
        </Defs>
        {laurel ? <Laurel color={laurel} /> : null}
        <G transform={laurel ? 'translate(13 9) scale(0.74)' : undefined}>
          <Path d={SHIELD} fill={`url(#${id}m)`} stroke={locked ? LOCKED.edge : t.rim} strokeWidth={3} strokeLinejoin="round" />
          <Path d={INNER} fill={`url(#${id}i)`} stroke={locked ? LOCKED.edge : t.rim} strokeOpacity={0.55} strokeWidth={1.5} strokeLinejoin="round" />
          <Path d={SHINE} fill="#FFFFFF" opacity={locked ? LOCKED.shine : 0.18} />
          <RankSymbol t={locked ? { ...t, ink: LOCKED.ink } : t} />
        </G>
      </Svg>
    </View>
  );
}
