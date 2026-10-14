import { useEffect, useState } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useActiveLoop } from '@/lib/useActiveLoop';
import { ACCENTS, art, artPalettes, LIGHT_DIR, METALS, STROKE, useArtId, type ArtTone, type MetalName } from '@/theme/artPalette';
import { colors, palettes, scheme } from '@/theme/tokens';

/**
 * Streak art: the flame behind the streak number, and the season chests.
 *
 * The flame is three nested tongues (coral, honey, cream) on a soft ground shadow; when the streak
 * is not alive it is a cold clay ember instead, and still. It flickers only while a decorative loop
 * is allowed (motion not reduced, app in the foreground). The chests are a closed clay box with a
 * padlock until their season milestone is reached, then an open metal chest with a glow. Colours
 * come from the palettes; style rules: docs/art-style.md. Budget: 30 SVG elements each.
 */

const kitFor = (tone?: ArtTone) => (tone ? { a: artPalettes[tone], x: ACCENTS[tone], t: palettes[tone] } : { a: art, x: ACCENTS[scheme], t: colors });

const FLAME_OUTER = 'M60 8 C66 26 90 40 90 70 C90 92 76 108 60 108 C44 108 30 92 30 70 C30 54 38 46 44 36 C46 44 50 48 54 48 C52 34 54 20 60 8 Z';
const FLAME_MID = 'M60 42 C64 54 78 62 78 78 C78 92 70 102 60 102 C50 102 42 92 42 78 C42 68 48 62 52 54 C54 58 56 60 58 60 C57 52 58 46 60 42 Z';
const FLAME_CORE = 'M60 70 C63 77 69 82 69 90 C69 97 65 102 60 102 C55 102 51 97 51 90 C51 82 57 77 60 70 Z';

/** The streak flame. `lit` is false when there is no live streak. */
export function FlameArt({ lit = true, size = 120, flicker = true, style, tone }: { lit?: boolean; size?: number; flicker?: boolean; style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const { a, x, t } = kitFor(tone);
  const id = useArtId('flame');
  const run = useActiveLoop(flicker && lit);
  const [sway] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!run) {
      sway.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [run, sway]);

  // The flame grows from its base: a slight stretch and sway, never a move.
  const scaleY = sway.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const scaleX = sway.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });
  const clay = a.locked;
  return (
    <Animated.View style={[{ width: size, height: size, transform: [{ scaleY }, { scaleX }] }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 120 120">
        <Defs>
          <LinearGradient id={`${id}o`} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={lit ? x.sparkleCoral : clay.metal[0]} />
            <Stop offset="1" stopColor={lit ? t.accent : clay.metal[2]} />
          </LinearGradient>
        </Defs>
        <Ellipse cx={60} cy={112} rx={26} ry={4} fill={a.shadow} opacity={a.shadowOpacity} />
        <Path d={FLAME_OUTER} fill={`url(#${id}o)`} stroke={lit ? t.accent : clay.edge} strokeWidth={STROKE.line} strokeLinejoin="round" />
        <Path d={FLAME_MID} fill={lit ? x.sparkleHoney : clay.metal[1]} opacity={lit ? 1 : 0.6} />
        <Path d={FLAME_CORE} fill={lit ? x.sparkleCream : clay.metal[0]} opacity={lit ? 1 : 0.6} />
        <Path d="M40 62 C38 70 40 78 44 84" fill="none" stroke={a.highlight} strokeWidth={STROKE.line} strokeLinecap="round" opacity={a.highlightOpacity + 0.15} />
        {lit ? (
          <>
            <Circle cx={92} cy={34} r={2.5} fill={x.sparkleHoney} />
            <Circle cx={28} cy={44} r={2} fill={x.sparkleCoral} />
            <Circle cx={84} cy={16} r={1.5} fill={x.sparkleCream} />
          </>
        ) : null}
      </Svg>
    </Animated.View>
  );
}

/** The four chests: a metal each, from a bronze spark to a sapphire inferno. */
export const CHEST_TIERS: readonly MetalName[] = ['bronze', 'silver', 'gold', 'sapphire'];

/** A season chest. `tier` is 0 to 3; `open` once its milestone is reached. */
export function ChestArt({ tier, open, size = 72, style, tone }: { tier: number; open: boolean; size?: number; style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const { a, x } = kitFor(tone);
  const id = useArtId('chest');
  const m = METALS[CHEST_TIERS[Math.min(Math.max(tier, 0), CHEST_TIERS.length - 1)]!];
  const clay = a.locked;
  const body = open ? m : null;
  const mid = body ? body.mid : clay.metal[1];
  const edge = body ? body.lo : clay.edge;
  return (
    <View style={[{ width: size, height: size }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={`${id}b`} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={body ? body.hi : clay.metal[0]} />
            <Stop offset="0.55" stopColor={mid} />
            <Stop offset="1" stopColor={body ? body.lo : clay.metal[2]} />
          </LinearGradient>
        </Defs>
        <Ellipse cx={50} cy={93} rx={32} ry={3.5} fill={a.shadow} opacity={a.shadowOpacity} />
        {open ? (
          <>
            <Circle cx={50} cy={40} r={22} fill={x.sparkleCream} opacity={0.5} />
            <Path d="M50 14 L53 24 L63 27 L53 30 L50 40 L47 30 L37 27 L47 24 Z" fill={x.sparkleHoney} />
            <Circle cx={22} cy={30} r={2.5} fill={x.sparkleCoral} />
            <Circle cx={80} cy={26} r={2} fill={x.sparkleCream} />
          </>
        ) : null}
        <Rect x={16} y={52} width={68} height={37} rx={6} fill={`url(#${id}b)`} stroke={edge} strokeWidth={STROKE.line} />
        <Path d="M43 53 H57 V89 H43 Z" fill={body ? body.rim : clay.ink} opacity={body ? 0.55 : 0.25} />
        {open ? (
          <>
            <Path d="M16 52 H84 V58 H16 Z" fill={m.lo} />
            <Path d="M16 52 C14 36 24 28 34 24 L40 36 C32 38 26 42 24 52 Z" fill={`url(#${id}b)`} stroke={edge} strokeWidth={STROKE.line} strokeLinejoin="round" />
          </>
        ) : (
          <Path d="M16 52 C16 34 30 26 50 26 C70 26 84 34 84 52 Z" fill={`url(#${id}b)`} stroke={edge} strokeWidth={STROKE.line} strokeLinejoin="round" />
        )}
        <Circle cx={50} cy={62} r={7} fill={body ? m.hi : clay.ink} stroke={edge} strokeWidth={STROKE.line} opacity={body ? 1 : 0.5} />
        <Path d="M50 59 V65" stroke={edge} strokeWidth={STROKE.bold} strokeLinecap="round" />
        <Path d="M22 56 H30" stroke={a.highlight} strokeWidth={STROKE.line} strokeLinecap="round" opacity={a.highlightOpacity + 0.2} />
      </Svg>
    </View>
  );
}
