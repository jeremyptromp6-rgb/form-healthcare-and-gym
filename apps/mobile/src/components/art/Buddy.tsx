import { useEffect, useState } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useActiveLoop } from '@/lib/useActiveLoop';
import { ACCENTS, art, artPalettes, LIGHT_DIR, METALS, STROKE, useArtId, type ArtAccents, type ArtPalette, type ArtTone } from '@/theme/artPalette';
import { colors, palettes, scheme } from '@/theme/tokens';

/**
 * Pip, FORM's little companion: a warm, round character with a leaf sprout who greets you, cheers
 * you on, rests with you and is proud of you. Purely decorative — screens say everything in words.
 * Style rules: docs/art-style.md. Budget: 60 SVG elements per mood.
 */

export type BuddyMood = 'happy' | 'cheer' | 'sleepy' | 'proud' | 'worried' | 'thinking' | 'celebrate' | 'rest' | 'workout';

export const BUDDY_MOODS: readonly BuddyMood[] = ['happy', 'cheer', 'sleepy', 'proud', 'worried', 'thinking', 'celebrate', 'rest', 'workout'];

type Tokens = typeof palettes.light;
interface Kit {
  a: ArtPalette;
  x: ArtAccents;
  t: Tokens;
}

const BODY = 'M60 22 C89 22 103 43 103 68 C103 94 85 107 60 107 C35 107 17 94 17 68 C17 43 31 22 60 22 Z';
const R = (n: number) => Math.round(n * 10) / 10;

/** A tapered-free "sausage" arm from S through control C to E, as one closed shape so it can wear the outline. */
function limb(s: readonly [number, number], c: readonly [number, number], e: readonly [number, number], w = 7): string {
  const r = w / 2;
  const unit = (dx: number, dy: number): [number, number] => {
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const a = unit(c[0] - s[0], c[1] - s[1]);
  const b = unit(e[0] - c[0], e[1] - c[1]);
  const m = unit(a[0] + b[0], a[1] + b[1]);
  const k = r / Math.max(0.5, m[0] * a[0] + m[1] * a[1]);
  const sn = [-a[1] * r, a[0] * r];
  const en = [-b[1] * r, b[0] * r];
  const cn = [-m[1] * k, m[0] * k];
  const p = (x: number, y: number) => `${R(x)} ${R(y)}`;
  return [
    `M${p(s[0] + sn[0]!, s[1] + sn[1]!)}`,
    `Q${p(c[0] + cn[0]!, c[1] + cn[1]!)} ${p(e[0] + en[0]!, e[1] + en[1]!)}`,
    `A${r} ${r} 0 0 0 ${p(e[0] - en[0]!, e[1] - en[1]!)}`,
    `Q${p(c[0] - cn[0]!, c[1] - cn[1]!)} ${p(s[0] - sn[0]!, s[1] - sn[1]!)}`,
    `A${r} ${r} 0 0 0 ${p(s[0] + sn[0]!, s[1] + sn[1]!)}Z`,
  ].join(' ');
}

type Pt = readonly [number, number];
interface Arm {
  d: string;
  hand: Pt;
}
const arm = (s: Pt, c: Pt, e: Pt): Arm => ({ d: limb(s, c, e), hand: e });

/** Arms that sit behind the body (they leave from the sides) and arms drawn over it. */
const ARMS: Record<BuddyMood, { back: Arm[]; front: Arm[] }> = {
  happy: { back: [arm([26, 76], [14, 82], [15, 94]), arm([94, 68], [108, 62], [110, 44])], front: [] },
  cheer: { back: [arm([26, 66], [12, 58], [11, 40]), arm([94, 66], [108, 58], [109, 40])], front: [] },
  celebrate: { back: [arm([28, 60], [10, 52], [14, 28]), arm([92, 60], [110, 52], [106, 28])], front: [] },
  sleepy: { back: [arm([26, 78], [18, 88], [24, 98]), arm([94, 78], [102, 88], [96, 98])], front: [] },
  proud: { back: [arm([26, 76], [16, 84], [17, 95]), arm([94, 76], [104, 84], [103, 95])], front: [] },
  rest: { back: [arm([26, 78], [17, 88], [23, 98]), arm([94, 76], [103, 84], [98, 95])], front: [] },
  workout: { back: [arm([26, 72], [8, 80], [25, 91]), arm([94, 72], [108, 72], [105, 57])], front: [] },
  worried: { back: [], front: [arm([32, 84], [38, 98], [55, 91]), arm([88, 84], [82, 98], [65, 91])] },
  thinking: { back: [arm([26, 76], [16, 84], [17, 95])], front: [arm([96, 78], [97, 93], [71, 82])] },
};

function Mitt({ kit, at }: { kit: Kit; at: Pt }) {
  return <Circle cx={at[0]} cy={at[1]} r={5.3} fill={kit.a.peach.arm} stroke={kit.a.ink} strokeWidth={STROKE.line} />;
}

function Sparkle({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return <Path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={color} />;
}

/** A small diamond of confetti, centred on x,y. */
function Bit({ x, y, color }: { x: number; y: number; color: string }) {
  return <Path d={`M${x} ${y - 3.2} L${x + 3.2} ${y} L${x} ${y + 3.2} L${x - 3.2} ${y} Z`} fill={color} />;
}

const stroke = (color: string, width: number) => ({ stroke: color, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }) as const;

type Look = { eyes: 'open' | 'happy' | 'closed'; gaze?: Pt };
const LOOK: Record<BuddyMood, Look> = {
  happy: { eyes: 'open' },
  cheer: { eyes: 'open' },
  sleepy: { eyes: 'closed' },
  proud: { eyes: 'open' },
  worried: { eyes: 'open' },
  thinking: { eyes: 'open', gaze: [-2.5, -2] },
  celebrate: { eyes: 'happy' },
  rest: { eyes: 'closed' },
  workout: { eyes: 'open' },
};

function Eyes({ kit, mood, blink }: { kit: Kit; mood: BuddyMood; blink: boolean }) {
  const ink = kit.a.featureInk;
  const look = LOOK[mood];
  if (look.eyes === 'happy') {
    return (
      <>
        <Path d="M41 60 q6 -8 12 0" {...stroke(ink, STROKE.bold)} />
        <Path d="M67 60 q6 -8 12 0" {...stroke(ink, STROKE.bold)} />
      </>
    );
  }
  if (look.eyes === 'closed' || blink) {
    return (
      <>
        <Path d="M41 58 q6 6 12 0" {...stroke(ink, STROKE.bold)} />
        <Path d="M67 58 q6 6 12 0" {...stroke(ink, STROKE.bold)} />
      </>
    );
  }
  const [gx, gy] = look.gaze ?? [0, 0];
  const ry = mood === 'workout' ? 5.6 : 7;
  const cy = mood === 'workout' ? 59 : 57;
  const shine = kit.x.eyeShine;
  return (
    <>
      <Ellipse cx={47 + gx} cy={cy + gy} rx={5.5} ry={ry} fill={ink} />
      <Ellipse cx={73 + gx} cy={cy + gy} rx={5.5} ry={ry} fill={ink} />
      <Circle cx={49 + gx} cy={cy - 2.5 + gy} r={2} fill={shine} />
      <Circle cx={75 + gx} cy={cy - 2.5 + gy} r={2} fill={shine} />
      <Circle cx={45.4 + gx} cy={cy + 2.6 + gy} r={1} fill={shine} opacity={0.7} />
      <Circle cx={71.4 + gx} cy={cy + 2.6 + gy} r={1} fill={shine} opacity={0.7} />
    </>
  );
}

function Brows({ kit, mood }: { kit: Kit; mood: BuddyMood }) {
  const ink = kit.a.featureInk;
  switch (mood) {
    case 'worried':
      return (
        <>
          <Path d="M40 48 L53 43" {...stroke(ink, STROKE.bold)} />
          <Path d="M80 48 L67 43" {...stroke(ink, STROKE.bold)} />
        </>
      );
    case 'thinking':
      return (
        <>
          <Path d="M41 44 Q47 40 53 43" {...stroke(ink, STROKE.bold)} />
          <Path d="M67 47 L79 47" {...stroke(ink, STROKE.bold)} />
        </>
      );
    case 'workout':
      return (
        <>
          <Path d="M40 48 L53 52" {...stroke(ink, STROKE.bold)} />
          <Path d="M80 48 L67 52" {...stroke(ink, STROKE.bold)} />
        </>
      );
    case 'proud':
      return (
        <>
          <Path d="M41 47 q6 -3.5 12 0" {...stroke(ink, STROKE.bold)} />
          <Path d="M67 47 q6 -3.5 12 0" {...stroke(ink, STROKE.bold)} />
        </>
      );
    default:
      return null;
  }
}

function Mouth({ kit, mood }: { kit: Kit; mood: BuddyMood }) {
  const ink = kit.a.featureInk;
  const inside = kit.x.mouth;
  switch (mood) {
    case 'cheer':
      return (
        <>
          <Path d="M50 66 q10 15 20 0 z" fill={inside} stroke={ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          <Ellipse cx={60} cy={71.2} rx={5.5} ry={2.4} fill={kit.a.peach.cheek} />
        </>
      );
    case 'celebrate':
      return (
        <>
          <Path d="M48 65 q12 19 24 0 z" fill={inside} stroke={ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          <Ellipse cx={60} cy={71.6} rx={6.2} ry={2.7} fill={kit.a.peach.cheek} />
        </>
      );
    case 'sleepy':
      return <Ellipse cx={60} cy={71} rx={3} ry={3.6} fill={ink} />;
    case 'worried':
      return <Path d="M51 72 q2.5 -4 5 0 t5 0 t5 0" {...stroke(ink, STROKE.bold)} />;
    case 'thinking':
      return <Path d="M55 71 q5.5 -3 11 -1" {...stroke(ink, STROKE.bold)} />;
    case 'rest':
      return <Path d="M54 68 q6 5 12 0" {...stroke(ink, STROKE.bold)} />;
    case 'workout':
      return (
        <>
          <Rect x={51} y={66.5} width={18} height={6.5} rx={3} fill={kit.x.eyeShine} stroke={ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          <Path d="M60 67 V72.5" {...stroke(ink, STROKE.hair)} />
        </>
      );
    case 'proud':
      return <Path d="M51 67 q9 9 18 0" {...stroke(ink, STROKE.bold)} />;
    default:
      return <Path d="M53 67 q7 7 14 0" {...stroke(ink, STROKE.bold)} />;
  }
}

/** Props drawn before the hands (so a hand can hold them). */
function HeldProps({ kit, mood }: { kit: Kit; mood: BuddyMood }) {
  if (mood === 'workout') {
    const plate = METALS.iron;
    return (
      <>
        <Path d="M95 53 H113" {...stroke(METALS.rubber.mid, STROKE.bold)} />
        <Rect x={90.5} y={44} width={7} height={18} rx={2.5} fill={plate.mid} stroke={kit.a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
        <Rect x={110.5} y={44} width={7} height={18} rx={2.5} fill={plate.mid} stroke={kit.a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
      </>
    );
  }
  return null;
}

/** The soft towel wrap Pip wears to rest: a cap over the top of the body, the leaf poking out. */
function Towel({ kit }: { kit: Kit }) {
  return (
    <>
      <Path d="M22.6 44 C20 30 36 21.5 60 21.5 C84 21.5 100 30 97.4 44 Q60 36 22.6 44 Z" fill={kit.t.water} stroke={kit.a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
      <Path d="M27 34 Q60 25 93 34" {...stroke(kit.x.sparkleCream, STROKE.line)} />
    </>
  );
}

/** Everything that decorates the scene once Pip is drawn: sparkles, medal, confetti, thought marks. */
function Flourish({ kit, mood }: { kit: Kit; mood: BuddyMood }) {
  const { x, t, a } = kit;
  switch (mood) {
    case 'cheer':
      return (
        <>
          <Sparkle x={14} y={22} r={6} color={x.sparkleHoney} />
          <Sparkle x={106} y={20} r={5} color={x.sparkleCoral} />
          <Sparkle x={97} y={7} r={3.5} color={x.sparkleHoney} />
        </>
      );
    case 'celebrate':
      return (
        <>
          <Circle cx={24} cy={12} r={2.4} fill={x.sparkleCoral} />
          <Bit x={34} y={20} color={x.sparkleHoney} />
          <Circle cx={98} cy={9} r={2.2} fill={t.water} />
          <Bit x={113} y={11} color={x.sparkleCoral} />
          <Circle cx={5} cy={44} r={2.2} fill={t.primary} />
          <Bit x={115} y={46} color={a.leaf.light} />
        </>
      );
    case 'sleepy':
      return (
        <>
          <Path d="M88 26 h9 l-9 9 h9" {...stroke(x.sleepZ, STROKE.bold)} />
          <Path d="M101 12 h6 l-6 6 h6" {...stroke(x.sleepZ, STROKE.line)} />
        </>
      );
    case 'rest':
      return <Path d="M101 15 h7 l-7 8 h7" {...stroke(x.sleepZ, STROKE.line)} />;
    case 'proud':
      return (
        <>
          <Path d="M68 76 L76 91 L84 76" {...stroke(t.primary, STROKE.bold)} />
          <Circle cx={76} cy={95} r={8} fill={x.sparkleHoney} stroke={t.accent} strokeWidth={STROKE.line} />
          <Sparkle x={76} y={95} r={4} color={x.sparkleCream} />
        </>
      );
    case 'worried':
      return <Path d="M97 41 q-5 7 -5 10 a5 5 0 0 0 10 0 q0 -3 -5 -10 z" fill={t.water} stroke={a.ink} strokeWidth={STROKE.hair} strokeLinejoin="round" />;
    case 'thinking':
      return (
        <>
          <Path d="M4 28 q0 -9 8.5 -9 q8.5 0 8.5 7.5 q0 5 -6 7 q-3 1.5 -3 5" {...stroke(t.accent, STROKE.bold)} />
          <Circle cx={12} cy={45.5} r={2} fill={t.accent} />
        </>
      );
    default:
      return null;
  }
}

/** The sweatband of the workout mood, with its tails. */
function Headband({ kit }: { kit: Kit }) {
  return (
    <>
      <Path d="M23 41 q-6 2 -7 9" {...stroke(kit.t.primary, STROKE.bold)} />
      <Path d="M23 43 q-4 6 -2 13" {...stroke(kit.t.primary, STROKE.bold)} />
      <Path d="M27 36 Q60 26 93 36 L97.5 43 Q60 33 22.5 43 Z" fill={kit.t.primary} stroke={kit.a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
    </>
  );
}

export function Buddy({
  mood = 'happy',
  size = 96,
  style,
  float = true,
  tone,
}: {
  mood?: BuddyMood;
  size?: number;
  style?: StyleProp<ViewStyle>;
  float?: boolean;
  tone?: ArtTone;
}) {
  const run = useActiveLoop(float);
  const [bob] = useState(() => new Animated.Value(0));
  const [closed, setClosed] = useState(false);
  const bodyId = useArtId('pipBody');
  const kit: Kit = tone ? { a: artPalettes[tone], x: ACCENTS[tone], t: palettes[tone] } : { a: art, x: ACCENTS[scheme], t: colors };
  const { a } = kit;

  useEffect(() => {
    if (!run) {
      // Rest at the neutral pose, not mid-bob, whenever the loop stops.
      bob.setValue(0);
      return;
    }
    const slow = mood === 'sleepy' || mood === 'rest';
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: slow ? 2200 : 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: slow ? 2200 : 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, run, mood]);

  // The blink is the one setState animation: shut for 120 ms about every 4 s, only while motion is on and
  // only for open eyes (sleepy and rest are already closed, so they schedule nothing).
  const blinks = run && LOOK[mood].eyes === 'open';
  useEffect(() => {
    if (!blinks) return;
    let reopen: ReturnType<typeof setTimeout> | undefined;
    const every = setInterval(() => {
      setClosed(true);
      reopen = setTimeout(() => setClosed(false), 120);
    }, 4000);
    return () => {
      clearInterval(every);
      if (reopen) clearTimeout(reopen);
      setClosed(false);
    };
  }, [blinks]);

  const lift = mood === 'cheer' || mood === 'celebrate' ? -6 : -3;
  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, lift] });
  const scaleY = bob.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });
  const arms = ARMS[mood];
  const jump = mood === 'celebrate' ? -2 : 0;

  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ translateY }, { scaleY }] }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 120 120">
        <Defs>
          <LinearGradient id={bodyId} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={a.peach.top} />
            <Stop offset="1" stopColor={a.peach.bottom} />
          </LinearGradient>
        </Defs>
        <Ellipse cx={60} cy={114} rx={jump ? 24 : 30} ry={jump ? 3.2 : 4} fill={a.shadow} opacity={a.shadowOpacity} />
        <G transform={jump ? `translate(0 ${jump})` : undefined}>
          <Ellipse cx={46} cy={107} rx={11} ry={6} fill={a.peach.foot} stroke={a.ink} strokeWidth={STROKE.line} />
          <Ellipse cx={74} cy={107} rx={11} ry={6} fill={a.peach.foot} stroke={a.ink} strokeWidth={STROKE.line} />
          <Ellipse cx={41.5} cy={105.6} rx={4} ry={1.5} fill={a.highlight} opacity={a.highlightOpacity + 0.1} />
          <Ellipse cx={69.5} cy={105.6} rx={4} ry={1.5} fill={a.highlight} opacity={a.highlightOpacity + 0.1} />
          {arms.back.map((m, i) => (
            <Path key={`b${i}`} d={m.d} fill={a.peach.arm} stroke={a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          ))}
          <Path d={BODY} fill={`url(#${bodyId})`} stroke={a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          <Ellipse cx={60} cy={82} rx={25} ry={19} fill={a.peach.belly} opacity={0.85} />
          <Path d="M82 80 C80 91 70 99 56 100.5 C68 96.5 76 89 78 76 Z" fill={a.peach.foot} opacity={0.16} />
          <Ellipse cx={42} cy={36} rx={9} ry={5} fill={a.highlight} opacity={a.highlightOpacity} transform="rotate(-25 42 36)" />
          <Path d="M99.5 62 C100.5 89 83 103.5 60 103.5" {...stroke(a.rim, STROKE.line)} opacity={a.rimOpacity} />
          {mood === 'rest' ? <Towel kit={kit} /> : null}
          <Path d="M60 24 Q59 17 62 12" {...stroke(a.leaf.deep, STROKE.bold)} />
          <Path d="M62 13 C64 3 80 1 90 6 C88 16 72 20 62 13 Z" fill={a.leaf.light} stroke={a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          <Path d="M64.5 12.6 Q77 10 87.5 7" {...stroke(a.leaf.deep, STROKE.hair)} />
          <Path d="M60 14 C58 6 46 3 37 8 C39 17 52 19 60 14 Z" fill={a.leaf.deep} stroke={a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          {mood === 'workout' ? <Headband kit={kit} /> : null}
          <Ellipse cx={37} cy={69} rx={6.5} ry={3.8} fill={a.peach.cheek} opacity={0.55} />
          <Ellipse cx={83} cy={69} rx={6.5} ry={3.8} fill={a.peach.cheek} opacity={0.55} />
          <Eyes kit={kit} mood={mood} blink={closed && blinks} />
          <Brows kit={kit} mood={mood} />
          <Mouth kit={kit} mood={mood} />
          {arms.front.map((m, i) => (
            <Path key={`f${i}`} d={m.d} fill={a.peach.arm} stroke={a.ink} strokeWidth={STROKE.line} strokeLinejoin="round" />
          ))}
          <HeldProps kit={kit} mood={mood} />
          {[...arms.back, ...arms.front].map((m, i) => (
            <Mitt key={`m${i}`} kit={kit} at={m.hand} />
          ))}
        </G>
        <Flourish kit={kit} mood={mood} />
      </Svg>
    </Animated.View>
  );
}
