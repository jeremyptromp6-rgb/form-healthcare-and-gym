import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';
import { art, artPalettes, LIGHT_DIR, METALS, METAL_SYMBOL, STROKE, useArtId, type ArtTone, type MetalName } from '@/theme/artPalette';

/**
 * Podium medals for the leaderboard's top three: a round medal on a V ribbon inside a laurel wreath.
 * 1st is gold, 2nd silver, 3rd bronze; the ribbon is a different metal for each so the three read apart
 * without colour. The place number sits on the face as text laid over the SVG (crisp at any size,
 * fixed size so it never outgrows the face). Style rules: docs/art-style.md. Budget: 12 SVG elements.
 */

export type Podium = 1 | 2 | 3;

const LOOKS: Record<Podium, { metal: 'gold' | 'silver' | 'bronze'; ribbon: MetalName; name: string }> = {
  1: { metal: 'gold', ribbon: 'sapphire', name: 'First place' },
  2: { metal: 'silver', ribbon: 'steel', name: 'Second place' },
  3: { metal: 'bronze', ribbon: 'oak', name: 'Third place' },
};

const W = 80;
const H = 100;
const CX = 40;
const CY = 62;
const R = 24;

const f1 = (n: number) => Math.round(n * 10) / 10;

/** A lens-shaped leaf centred on (cx, cy), pointing along `ang`. */
function leaf(cx: number, cy: number, ang: number, len: number, wid: number): string {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const [nx, ny] = [-dy * wid, dx * wid];
  const a = `${f1(cx - (dx * len) / 2)} ${f1(cy - (dy * len) / 2)}`;
  const b = `${f1(cx + (dx * len) / 2)} ${f1(cy + (dy * len) / 2)}`;
  return `M${a} Q${f1(cx + nx)} ${f1(cy + ny)} ${b} Q${f1(cx - nx)} ${f1(cy - ny)} ${a} Z`;
}

/** Leaves along an arc around the medal; `side` -1 is the left branch, 1 the right (mirrored). */
function wreath(side: -1 | 1): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const deg = 118 + i * 17; // from the lower side, up the flank
    const t = (deg * Math.PI) / 180;
    const x = CX + side * -Math.cos(t) * (R + 8);
    const y = CY + Math.sin(t) * (R + 8) - 6;
    const ang = side === -1 ? t + Math.PI / 2 - 0.5 : Math.PI - t - Math.PI / 2 + 0.5;
    out.push(leaf(x, y, ang, 11, 4.6));
  }
  return out.join(' ');
}

const LEFT = wreath(-1);
const RIGHT = wreath(1);
const RIBBON_L = `M${CX - 17} 6 L${CX - 3} 6 L${CX + 8} ${CY - 18} L${CX - 4} ${CY - 18} Z`;
const RIBBON_R = `M${CX + 17} 6 L${CX + 3} 6 L${CX - 8} ${CY - 18} L${CX + 4} ${CY - 18} Z`;

export function PodiumMedal({ place, size = 72, style, tone }: { place: Podium; size?: number; style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const id = useArtId('pm');
  const a = tone ? artPalettes[tone] : art;
  const look = LOOKS[place];
  const m = METALS[look.metal];
  const rib = METALS[look.ribbon];
  const ink = METAL_SYMBOL[look.metal].ink;
  const h = (size * H) / W;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={look.name} style={[{ width: size, height: h }, style]}>
      <Svg width={size} height={h} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id={`${id}m`} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={m.hi} />
            <Stop offset="0.5" stopColor={m.mid} />
            <Stop offset="1" stopColor={m.lo} />
          </LinearGradient>
          <LinearGradient id={`${id}r`} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={rib.hi} />
            <Stop offset="1" stopColor={rib.lo} />
          </LinearGradient>
        </Defs>
        <Path d={RIBBON_L} fill={`url(#${id}r)`} stroke={rib.lo} strokeWidth={STROKE.hair} strokeLinejoin="round" />
        <Path d={RIBBON_R} fill={`url(#${id}r)`} stroke={rib.lo} strokeWidth={STROKE.hair} strokeLinejoin="round" />
        <Path d={LEFT} fill={METALS.gold.mid} stroke={METALS.gold.lo} strokeWidth={STROKE.hair} strokeLinejoin="round" opacity={0.9} />
        <Path d={RIGHT} fill={METALS.gold.mid} stroke={METALS.gold.lo} strokeWidth={STROKE.hair} strokeLinejoin="round" opacity={0.9} />
        <Circle cx={CX + 1.5} cy={CY + 2} r={R} fill={a.shadow} opacity={a.shadowOpacity} />
        <Circle cx={CX} cy={CY} r={R} fill={`url(#${id}m)`} stroke={m.lo} strokeWidth={STROKE.line} />
        <Circle cx={CX} cy={CY} r={R - 6} fill={m.mid} stroke={m.rim} strokeWidth={STROKE.hair} opacity={0.85} />
        <Ellipse cx={CX - 9} cy={CY - 11} rx={8} ry={4} fill={a.highlight} opacity={a.highlightOpacity} transform={`rotate(-30 ${CX - 9} ${CY - 11})`} />
      </Svg>
      <View importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (CY / H) * h - size * 0.17, alignItems: 'center' }}>
        <Text allowFontScaling={false} style={{ color: ink, fontSize: Math.round(size * 0.34), lineHeight: Math.round(size * 0.34), fontWeight: '800', fontVariant: ['tabular-nums'] }}>
          {place}
        </Text>
      </View>
    </View>
  );
}
