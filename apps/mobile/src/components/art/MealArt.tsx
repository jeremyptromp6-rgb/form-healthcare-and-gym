import { useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Meal illustrations, top-down with soft shading: an oat bowl, a leafy salad, a salmon dinner and a
 * fruit snack. Illustrations of a kind of meal — never presented as the user's own food.
 */

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** A ceramic plate or bowl: soft shadow, a shaded rim and a gently lit centre. */
function Plate({ id, bowl }: { id: string; bowl?: boolean }) {
  return (
    <G>
      <Ellipse cx={60} cy={49} rx={38} ry={37} fill="#7A4A26" opacity={0.14} />
      <Circle cx={60} cy={45} r={37} fill={`url(#${id}rim)`} />
      <Circle cx={60} cy={45} r={bowl ? 29 : 30} fill={bowl ? '#EADCC4' : `url(#${id}plate)`} />
      {bowl ? <Circle cx={60} cy={45} r={29} fill="none" stroke="#D3C0A0" strokeWidth={2} /> : null}
    </G>
  );
}

function Leaf({ x, y, r, s = 1, color }: { x: number; y: number; r: number; s?: number; color: string }) {
  return (
    <G transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <Path d="M0 -11 C8 -8 9 6 0 11 C-9 6 -8 -8 0 -11 Z" fill={color} />
      <Path d="M0 -9 L0 9" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1} />
    </G>
  );
}

function Breakfast({ id }: { id: string }) {
  return (
    <G>
      <Plate id={id} bowl />
      {/* oats */}
      <Circle cx={60} cy={45} r={26} fill={`url(#${id}oats)`} />
      {[
        [50, 36],
        [64, 32],
        [72, 46],
        [46, 52],
        [58, 58],
        [68, 56],
      ].map(([x, y], i) => (
        <Ellipse key={i} cx={x} cy={y} rx={2.6} ry={1.4} fill="#D7BE8E" opacity={0.8} transform={`rotate(${i * 30} ${x} ${y})`} />
      ))}
      {/* banana slices */}
      {[
        [48, 42],
        [55, 47],
      ].map(([x, y], i) => (
        <G key={i}>
          <Circle cx={x} cy={y} r={5.5} fill="#FBE7A1" stroke="#EBCB6A" strokeWidth={1} />
          <Circle cx={x} cy={y} r={1.6} fill="#E3C46A" opacity={0.6} />
        </G>
      ))}
      {/* berries */}
      {[
        [66, 38, '#4F57B8'],
        [71, 42, '#5B63C9'],
        [63, 44, '#4F57B8'],
        [70, 52, '#C2405E'],
        [62, 54, '#D24A68'],
      ].map(([x, y, c], i) => (
        <G key={i}>
          <Circle cx={x as number} cy={y as number} r={3.4} fill={c as string} />
          <Circle cx={(x as number) - 1} cy={(y as number) - 1.2} r={1} fill="#FFFFFF" opacity={0.55} />
        </G>
      ))}
      {/* honey */}
      <Path d="M42 50 q8 -10 16 -2 q6 6 14 -4" stroke="#E8A93A" strokeWidth={2.2} fill="none" strokeLinecap="round" opacity={0.85} />
      {/* spoon */}
      <G transform="rotate(28 98 34)">
        <Rect x={95} y={14} width={6} height={40} rx={3} fill="#C9B6A0" />
        <Ellipse cx={98} cy={14} rx={6} ry={8} fill="#D6C4AF" />
      </G>
    </G>
  );
}

function Lunch({ id }: { id: string }) {
  return (
    <G>
      <Plate id={id} />
      <Leaf x={48} y={34} r={-30} s={1.3} color="#4E9A62" />
      <Leaf x={70} y={32} r={40} s={1.2} color="#6DB57F" />
      <Leaf x={76} y={52} r={100} s={1.25} color="#4E9A62" />
      <Leaf x={44} y={56} r={-110} s={1.2} color="#6DB57F" />
      <Leaf x={60} y={44} r={10} s={1.1} color="#86C590" />
      {/* cucumber */}
      {[
        [53, 48],
        [66, 54],
      ].map(([x, y], i) => (
        <G key={i}>
          <Circle cx={x} cy={y} r={5.5} fill="#5E9E52" />
          <Circle cx={x} cy={y} r={4.3} fill="#D9EDB8" />
          <Circle cx={x} cy={y} r={1.4} fill="#A8C98A" />
        </G>
      ))}
      {/* tomatoes */}
      {[
        [62, 36],
        [42, 44],
        [72, 42],
      ].map(([x, y], i) => (
        <G key={i}>
          <Circle cx={x} cy={y} r={5.2} fill={`url(#${id}tomato)`} />
          <Circle cx={x - 1.6} cy={y - 1.8} r={1.4} fill="#FFFFFF" opacity={0.6} />
          <Path d={`M${x - 1.5} ${y - 4.5} l1.5 1.5 l1.5 -1.5`} stroke="#3F7D3A" strokeWidth={1} fill="none" />
        </G>
      ))}
      {/* feta */}
      <Rect x={54} y={56} width={6} height={6} rx={1.5} fill="#FBF6EC" transform="rotate(12 57 59)" />
      <Rect x={47} y={38} width={5} height={5} rx={1.5} fill="#FBF6EC" transform="rotate(-10 49 40)" />
    </G>
  );
}

function Dinner({ id }: { id: string }) {
  return (
    <G>
      <Plate id={id} />
      {/* rice */}
      <Ellipse cx={72} cy={54} rx={14} ry={10.5} fill="#F3EFE6" />
      {[
        [66, 51],
        [72, 49],
        [78, 53],
        [70, 57],
        [76, 58],
        [64, 56],
      ].map(([x, y], i) => (
        <Ellipse key={i} cx={x} cy={y} rx={1.8} ry={0.9} fill="#E0D8C8" transform={`rotate(${i * 40} ${x} ${y})`} />
      ))}
      {/* salmon */}
      <Path d="M36 30 Q52 22 70 28 Q74 36 68 42 Q52 46 38 42 Q32 36 36 30 Z" fill={`url(#${id}salmon)`} />
      {[44, 52, 60].map((x) => (
        <Path key={x} d={`M${x} 27 Q${x + 2} 35 ${x} 43`} stroke="#C25A3A" strokeWidth={2} strokeLinecap="round" fill="none" opacity={0.65} />
      ))}
      <Path d="M40 31 Q54 26 66 30" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      {/* broccoli */}
      {[
        [44, 56],
        [52, 60],
        [47, 50],
      ].map(([x, y], i) => (
        <G key={i}>
          <Rect x={x - 1.4} y={y} width={2.8} height={6} rx={1.2} fill="#8FBF6E" />
          <Circle cx={x - 3} cy={y} r={3.4} fill="#3F8A4C" />
          <Circle cx={x + 3} cy={y} r={3.4} fill="#3F8A4C" />
          <Circle cx={x} cy={y - 3} r={3.8} fill="#4E9A58" />
        </G>
      ))}
      {/* lemon */}
      <Path d="M82 30 a10 10 0 0 1 4 16 z" fill="#F5D45A" stroke="#E7B93A" strokeWidth={1.2} />
      <Path d="M83 33 l2 9" stroke="#FFF3B8" strokeWidth={1} />
    </G>
  );
}

function Snack({ id }: { id: string }) {
  return (
    <G>
      <Ellipse cx={60} cy={76} rx={44} ry={6} fill="#7A4A26" opacity={0.12} />
      {/* apple */}
      <Path d="M30 40 C30 26 44 24 48 30 C52 24 66 26 66 40 C66 56 56 70 48 66 C40 70 30 56 30 40 Z" fill={`url(#${id}apple)`} />
      <Ellipse cx={39} cy={38} rx={4} ry={7} fill="#FFFFFF" opacity={0.3} transform="rotate(-20 39 38)" />
      <Path d="M48 30 q1 -7 5 -10" stroke="#6B4A2E" strokeWidth={2.6} fill="none" strokeLinecap="round" />
      <Path d="M52 24 q9 -7 16 -1 q-9 5 -16 1z" fill="#6DB57F" />
      {/* banana */}
      <Path d="M70 22 C90 30 98 52 86 70 C84 62 78 42 66 30 Z" fill={`url(#${id}banana)`} />
      <Path d="M70 24 C86 32 92 50 86 66" stroke="#E2B23E" strokeWidth={1.2} fill="none" opacity={0.7} />
      <Path d="M66 30 l-3 -6" stroke="#6B4A2E" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={86} cy={70} r={1.8} fill="#6B4A2E" />
      {/* almonds */}
      {[
        [26, 70, -20],
        [36, 74, 25],
        [100, 66, 60],
      ].map(([x, y, r], i) => (
        <Ellipse key={i} cx={x} cy={y} rx={5} ry={3} fill="#B9814E" stroke="#94613A" strokeWidth={0.8} transform={`rotate(${r} ${x} ${y})`} />
      ))}
    </G>
  );
}

const ART: Record<MealKind, (p: { id: string }) => React.ReactElement> = { breakfast: Breakfast, lunch: Lunch, dinner: Dinner, snack: Snack };

export function MealArt({ kind, size = 56, style }: { kind: MealKind; size?: number; style?: StyleProp<ViewStyle> }) {
  const Art = ART[kind];
  const id = `meal${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={[{ width: size * (120 / 90), height: size }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 120 90">
        <Defs>
          <LinearGradient id={`${id}rim`} x1="0" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#E7DACA" />
          </LinearGradient>
          <RadialGradient id={`${id}plate`} cx="45%" cy="40%" r="60%">
            <Stop offset="0" stopColor="#FFFFFF" />
            <Stop offset="1" stopColor="#F1E8DC" />
          </RadialGradient>
          <RadialGradient id={`${id}oats`} cx="45%" cy="40%" r="60%">
            <Stop offset="0" stopColor="#F6E6C2" />
            <Stop offset="1" stopColor="#E6CE9F" />
          </RadialGradient>
          <RadialGradient id={`${id}tomato`} cx="35%" cy="35%" r="70%">
            <Stop offset="0" stopColor="#FF7A66" />
            <Stop offset="1" stopColor="#D0402F" />
          </RadialGradient>
          <LinearGradient id={`${id}salmon`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#F7A47A" />
            <Stop offset="1" stopColor="#E47750" />
          </LinearGradient>
          <RadialGradient id={`${id}apple`} cx="35%" cy="35%" r="75%">
            <Stop offset="0" stopColor="#F2675C" />
            <Stop offset="1" stopColor="#B8322B" />
          </RadialGradient>
          <LinearGradient id={`${id}banana`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FBE07A" />
            <Stop offset="1" stopColor="#EDBD3C" />
          </LinearGradient>
        </Defs>
        <Art id={id} />
      </Svg>
    </View>
  );
}
