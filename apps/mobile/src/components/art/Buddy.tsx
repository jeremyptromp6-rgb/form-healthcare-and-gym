import { useEffect, useState } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { useReducedMotion } from '@/lib/a11y';

/**
 * Pip, FORM's little companion: a warm, round character with a leaf sprout who greets you, cheers
 * you on, rests with you and is proud of you. Purely decorative — screens say everything in words.
 */

export type BuddyMood = 'happy' | 'cheer' | 'sleepy' | 'proud';

const INK = '#3A2A1F';
const BELLY = '#FFE6CF';
const FOOT = '#D9663F';
const LEAF = '#7FB06E';
const LEAF_DEEP = '#5E9150';
const CHEEK = '#FF8A7A';
const ARM = '#F28F64';

function Arm({ d }: { d: string }) {
  return <Path d={d} stroke={ARM} strokeWidth={9} strokeLinecap="round" fill="none" />;
}

function Sparkle({ x, y, r, color = '#F5B25B' }: { x: number; y: number; r: number; color?: string }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={color} />;
}

function Face({ mood }: { mood: BuddyMood }) {
  const sleepy = mood === 'sleepy';
  return (
    <G>
      {sleepy ? (
        <>
          <Path d="M41 60 q6 5 12 0" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
          <Path d="M67 60 q6 5 12 0" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          <Ellipse cx={47} cy={57} rx={5.5} ry={7} fill={INK} />
          <Ellipse cx={73} cy={57} rx={5.5} ry={7} fill={INK} />
          <Circle cx={49} cy={54.5} r={2} fill="#FFFFFF" />
          <Circle cx={75} cy={54.5} r={2} fill="#FFFFFF" />
        </>
      )}
      <Ellipse cx={37} cy={69} rx={6.5} ry={3.8} fill={CHEEK} opacity={0.55} />
      <Ellipse cx={83} cy={69} rx={6.5} ry={3.8} fill={CHEEK} opacity={0.55} />
      {mood === 'cheer' ? (
        <Path d="M51 66 q9 13 18 0 z" fill="#8A3422" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      ) : sleepy ? (
        <Circle cx={60} cy={70} r={2.6} fill={INK} />
      ) : (
        <Path d="M53 67 q7 7 14 0" stroke={INK} strokeWidth={3} strokeLinecap="round" fill="none" />
      )}
    </G>
  );
}

function Pose({ mood }: { mood: BuddyMood }) {
  switch (mood) {
    case 'cheer':
      return (
        <G>
          <Arm d="M24 66 Q14 56 12 42" />
          <Arm d="M96 66 Q106 56 108 42" />
          <Sparkle x={14} y={26} r={6} />
          <Sparkle x={106} y={24} r={5} color="#E9896A" />
          <Sparkle x={98} y={10} r={3.5} />
        </G>
      );
    case 'sleepy':
      return (
        <G>
          <Arm d="M25 80 Q20 88 24 94" />
          <Arm d="M95 80 Q100 88 96 94" />
          <Path d="M88 26 h9 l-9 9 h9" stroke="#8A7BB8" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M101 12 h6 l-6 6 h6" stroke="#8A7BB8" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </G>
      );
    case 'proud':
      return (
        <G>
          <Arm d="M24 74 Q15 82 16 90" />
          <Arm d="M96 72 Q104 76 104 84" />
          <Path d="M98 70 l6 10 l6 -10" stroke="#C24E2A" strokeWidth={3} fill="none" strokeLinejoin="round" />
          <Circle cx={104} cy={88} r={9} fill="#F5B25B" stroke="#C9741A" strokeWidth={2} />
          <Sparkle x={104} y={88} r={4} color="#FFF3D6" />
        </G>
      );
    default:
      return (
        <G>
          <Arm d="M24 74 Q15 82 16 90" />
          <Arm d="M96 66 Q106 58 110 46" />
        </G>
      );
  }
}

export function Buddy({ mood = 'happy', size = 96, style, float = true }: { mood?: BuddyMood; size?: number; style?: StyleProp<ViewStyle>; float?: boolean }) {
  const reduce = useReducedMotion();
  const [bob] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!float || reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: mood === 'sleepy' ? 2200 : 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: mood === 'sleepy' ? 2200 : 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, float, mood, reduce]);
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, mood === 'cheer' ? -6 : -3] });
  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ translateY }] }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 120 120">
        <Defs>
          <LinearGradient id="pipBody" x1="0.2" y1="0" x2="0.8" y2="1">
            <Stop offset="0" stopColor="#FFC29B" />
            <Stop offset="1" stopColor="#EE8257" />
          </LinearGradient>
        </Defs>
        <Ellipse cx={60} cy={112} rx={30} ry={4} fill="#7A4A26" opacity={0.14} />
        <Ellipse cx={46} cy={106} rx={10} ry={5.5} fill={FOOT} />
        <Ellipse cx={74} cy={106} rx={10} ry={5.5} fill={FOOT} />
        <Pose mood={mood} />
        <Path d="M60 22 C89 22 103 43 103 68 C103 94 85 107 60 107 C35 107 17 94 17 68 C17 43 31 22 60 22 Z" fill="url(#pipBody)" />
        <Ellipse cx={60} cy={82} rx={25} ry={19} fill={BELLY} opacity={0.85} />
        <Ellipse cx={42} cy={36} rx={9} ry={5} fill="#FFFFFF" opacity={0.3} transform="rotate(-25 42 36)" />
        <Path d="M60 23 Q59 15 63 9" stroke={LEAF_DEEP} strokeWidth={3} strokeLinecap="round" fill="none" />
        <Path d="M62 11 q12 -11 23 -3 q-12 9 -23 3z" fill={LEAF} />
        <Path d="M61 13 q-11 -10 -21 -4 q10 9 21 4z" fill={LEAF_DEEP} />
        <Face mood={mood} />
      </Svg>
    </Animated.View>
  );
}
