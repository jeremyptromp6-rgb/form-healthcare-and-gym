import type { MuscleTier } from '@form/domain';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { ANATOMY, LIGHT_DIR, METAL_SYMBOL, METALS, STROKE, useArtId, type ArtTone } from '@/theme/artPalette';
import { scheme } from '@/theme/tokens';
import { TIER_METAL } from './BodyMap';

/**
 * The badge for a muscle's rank tier: a small shield in the tier's metal (grey when untrained) with one,
 * two or three chevrons for the level inside it. Decorative: the row it sits in says the rank in words.
 * Style rules: docs/art-style.md. Budget: 20 SVG elements.
 */

const SHIELD = 'M20 2 L36 8 L36 22 C36 33 28 40 20 44 C12 40 4 33 4 22 L4 8 Z';
const INNER = 'M20 6.5 L32 11 L32 22 C32 30.5 26.5 36 20 39.5 C13.5 36 8 30.5 8 22 L8 11 Z';

/** The chevrons of a level, centred on the shield: 1 to 3 stacked. */
export function chevrons(level: number): string {
  const n = Math.max(0, Math.min(3, level));
  const top = 24 - (n * 6 - 1) / 2;
  return Array.from({ length: n }, (_, i) => `M13.5 ${top + i * 6} L20 ${top + i * 6 + 5} L26.5 ${top + i * 6}`).join(' ');
}

export function TierBadge({ tier, level, size = 36, style, tone }: { tier: MuscleTier; level: number; size?: number; style?: StyleProp<ViewStyle>; tone?: ArtTone }) {
  const id = useArtId('tb');
  const t = tone ?? scheme;
  const name = TIER_METAL[tier];
  const grey = ANATOMY[t];
  const metal = name ? METALS[name] : null;
  const ink = name ? (METAL_SYMBOL as Record<string, { ink: string }>)[name]?.ink ?? grey.edge : grey.edge;
  return (
    <View style={[{ width: size, height: size * 1.1 }, style]} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Svg width="100%" height="100%" viewBox="0 0 40 46">
        <Defs>
          <LinearGradient id={id} {...LIGHT_DIR}>
            <Stop offset="0" stopColor={metal ? metal.hi : grey.skinTop} />
            <Stop offset="0.55" stopColor={metal ? metal.mid : grey.skinBottom} />
            <Stop offset="1" stopColor={metal ? metal.lo : grey.muscleBottom} />
          </LinearGradient>
        </Defs>
        <Path d={SHIELD} fill={`url(#${id})`} stroke={metal ? metal.lo : grey.edge} strokeWidth={STROKE.line} strokeLinejoin="round" />
        <Path d={INNER} fill="none" stroke={metal ? metal.rim : grey.line} strokeOpacity={metal ? 0.9 : grey.lineOpacity} strokeWidth={STROKE.hair} strokeLinejoin="round" />
        {level > 0 ? (
          <Path d={chevrons(level)} fill="none" stroke={ink} strokeWidth={STROKE.bold - 0.4} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <Path d="M15 24 L25 24" fill="none" stroke={grey.line} strokeOpacity={0.6} strokeWidth={STROKE.line} strokeLinecap="round" />
        )}
      </Svg>
    </View>
  );
}
