import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, scheme } from '@/theme/tokens';

/**
 * Cosy scene art for heroes and sign-in: a warm sun, soft rolling hills, a little sparkle — the
 * feeling of a good morning, drawn behind the words. Never a photo of a person.
 */

/** In the evening palette the scenes turn to night: a moon, stars and darker hills. */
const night = scheme === 'dark';
const SUN = night ? '#F6E3C2' : '#F5A65B';
const SUN_GLOW = night ? '#F2A541' : '#FFD7A8';
const GLOW_OPACITY = night ? 0.32 : 0.9;
const HILL_SAND = night ? '#4A372B' : '#F0CDA8';
const HILL_SAGE = night ? '#3A4733' : '#C9DCBE';
const HILL_SAGE_DEEP = night ? '#2F3B2A' : '#A9C79C';
const SPARKLE = night ? '#FFE7B8' : SUN;

function Glow({ id, cx, cy, r, color = SUN_GLOW, opacity = GLOW_OPACITY }: { id: string; cx: number; cy: number; r: number; color?: string; opacity?: number }) {
  return (
    <>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </>
  );
}

/** A four-point sparkle. */
function Sparkle({ x, y, r, color = SPARKLE }: { x: number; y: number; r: number; color?: string }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={color} />;
}

/** A soft cloud from overlapping circles. */
function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  // At night the clouds give way to a little cluster of stars.
  if (night) {
    return (
      <G>
        <Sparkle x={x} y={y - 4 * s} r={5 * s} />
        <Circle cx={x - 16 * s} cy={y + 4 * s} r={1.6} fill={SPARKLE} opacity={0.8} />
        <Circle cx={x + 14 * s} cy={y + 8 * s} r={1.3} fill={SPARKLE} opacity={0.7} />
      </G>
    );
  }
  return (
    <G opacity={0.9}>
      <Ellipse cx={x} cy={y} rx={22 * s} ry={10 * s} fill="#FFFFFF" />
      <Circle cx={x - 8 * s} cy={y - 6 * s} r={9 * s} fill="#FFFFFF" />
      <Circle cx={x + 6 * s} cy={y - 9 * s} r={11 * s} fill="#FFFFFF" />
    </G>
  );
}

/** Soft craters, so the evening sun reads as a moon. */
function MoonFace({ cx, cy }: { cx: number; cy: number }) {
  return (
    <G fill="#D9C3A0" opacity={0.55}>
      <Circle cx={cx + 10} cy={cy + 8} r={6} />
      <Circle cx={cx - 8} cy={cy + 14} r={3.5} />
      <Circle cx={cx + 14} cy={cy - 10} r={3} />
    </G>
  );
}

/** Home: the sun coming up over the hills — today is a fresh start. */
export function RingsArt({ style }: { style?: StyleProp<ViewStyle> }) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={style} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 300 300" preserveAspectRatio="xMaxYMin slice">
        <Glow id={id} cx={268} cy={30} r={90} />
        <Circle cx={268} cy={30} r={22} fill={SUN} />
        <Circle cx={262} cy={24} r={8} fill="#FFFFFF" opacity={0.25} />
        {night ? <MoonFace cx={262} cy={26} /> : null}
        <Cloud x={160} y={58} s={0.9} />
        <Cloud x={276} y={128} s={0.7} />
        <Sparkle x={140} y={112} r={7} />
        <Sparkle x={280} y={40} r={5} color="#E9896A" />
        <Path d="M-40 196 Q60 150 150 176 T320 140 V300 H-40 Z" fill={HILL_SAND} opacity={0.75} />
        <Path d="M-40 226 Q100 184 220 210 T330 190 V300 H-40 Z" fill={HILL_SAGE} opacity={0.9} />
      </Svg>
    </View>
  );
}

/** Progress: warm bars climbing a hill, a little flag at the top. */
export function ProgressArt({ style }: { style?: StyleProp<ViewStyle> }) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={style} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 300 200" preserveAspectRatio="xMaxYMid slice">
        <Glow id={id} cx={250} cy={70} r={90} />
        {[0, 1, 2, 3, 4].map((i) => (
          <Rect key={i} x={166 + i * 24} y={150 - (i + 1) * 20} width={16} height={(i + 1) * 20 + 14} rx={8} fill={i === 4 ? colors.primary : SUN} opacity={0.35 + i * 0.13} />
        ))}
        <Path d="M282 40 V22 l14 6 -14 6" stroke={colors.primary} strokeWidth={3} fill={colors.primary} strokeLinejoin="round" />
        <Sparkle x={168} y={60} r={6} />
      </Svg>
    </View>
  );
}

/** A trophy for a beaten record. */
export function TrophyArt({ size = 72 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 80 80">
        <Circle cx={40} cy={36} r={30} fill={SUN_GLOW} opacity={0.6} />
        <Path d="M24 14 h32 v14 a16 16 0 0 1 -32 0z" fill={SUN} />
        <Path d="M24 18 h-8 a8 8 0 0 0 10 12 M56 18 h8 a8 8 0 0 1 -10 12" stroke={SUN} strokeWidth={4} fill="none" />
        <Rect x={36} y={42} width={8} height={12} fill="#D98A3D" />
        <Rect x={26} y={54} width={28} height={8} rx={4} fill="#B86A2C" />
        <Path d="M34 22 l4 -4" stroke="#FFF3D6" strokeWidth={3} strokeLinecap="round" opacity={0.8} />
        <Sparkle x={66} y={14} r={5} color="#E9896A" />
      </Svg>
    </View>
  );
}

/** The FORM mark: a warm terracotta tile with a rising stroke — used at sign-in and as the app's signature. */
export function FormMark({ size = 48 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size }} accessible accessibilityRole="image" accessibilityLabel="FORM">
      <Svg width="100%" height="100%" viewBox="0 0 48 48">
        <Rect x={0} y={0} width={48} height={48} rx={15} fill={colors.primary} />
        <Path d="M14 34 V14 h18 M14 24 h12" stroke={colors.onPrimary} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Circle cx={34} cy={33} r={4} fill={SUN_GLOW} />
      </Svg>
    </View>
  );
}

/** Sign-in scene: sunrise over the hills, a kettlebell and an apple resting on the grass — train and eat, gently. */
export function WelcomeArt({ style }: { style?: StyleProp<ViewStyle> }) {
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={style} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 300 220" preserveAspectRatio="xMidYMid slice">
        <Glow id={id} cx={196} cy={78} r={110} />
        <Circle cx={196} cy={80} r={32} fill={SUN} />
        <Circle cx={186} cy={70} r={11} fill="#FFFFFF" opacity={0.25} />
        {night ? <MoonFace cx={196} cy={80} /> : null}
        <Cloud x={120} y={56} />
        <Cloud x={272} y={104} s={0.7} />
        <Sparkle x={256} y={40} r={6} color="#E9896A" />
        <Sparkle x={96} y={98} r={5} />
        <Path d="M-10 150 Q80 104 170 138 T320 126 V220 H-10 Z" fill={HILL_SAND} opacity={0.8} />
        <Path d="M-10 176 Q100 138 200 168 T320 160 V220 H-10 Z" fill={HILL_SAGE} />
        <Path d="M120 220 Q170 190 240 196 T320 186 V220 Z" fill={HILL_SAGE_DEEP} opacity={0.7} />
        {/* Kettlebell */}
        <G>
          <Path d="M196 150 a14 14 0 0 1 28 0" stroke={night ? '#7A5C47' : '#5E4838'} strokeWidth={6} fill="none" strokeLinecap="round" />
          <Circle cx={210} cy={166} r={18} fill={night ? '#8C6A52' : '#6B4E3B'} />
          <Ellipse cx={203} cy={159} rx={6} ry={4} fill="#FFFFFF" opacity={0.18} />
          <Ellipse cx={210} cy={184} rx={16} ry={3} fill="#5E4838" opacity={0.18} />
        </G>
        {/* Apple */}
        <G>
          <Circle cx={244} cy={176} r={10} fill="#D9574A" />
          <Circle cx={240} cy={172} r={3} fill="#FFFFFF" opacity={0.3} />
          <Path d="M244 166 q1 -4 4 -6" stroke="#6B4A2E" strokeWidth={2} fill="none" strokeLinecap="round" />
          <Path d="M247 163 q6 -4 10 0 q-6 3 -10 0z" fill="#7FAF6E" />
        </G>
      </Svg>
    </View>
  );
}
