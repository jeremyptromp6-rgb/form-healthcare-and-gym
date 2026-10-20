import { LinearGradient } from 'expo-linear-gradient';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, ImageBackground, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useActiveLoop } from '@/lib/useActiveLoop';
import { palettes, radius, space } from '@/theme/tokens';
import { useStaticArt } from './staticArt';

/** A photo is always dark under its scrim, so words on it use the dark mood's type colours in either mood. */
export const heroInk = { text: palettes.dark.text, muted: palettes.dark.textMuted, primary: palettes.dark.primary, warning: palettes.dark.warning } as const;

const SCRIM_BASE = palettes.dark.bg;
/** Light at the top so the photo reads, then a bottom-heavy fade so the words always do. */
const SCRIM = [`${SCRIM_BASE}33`, `${SCRIM_BASE}80`, `${SCRIM_BASE}E6`, SCRIM_BASE] as const;
const SCRIM_AT = [0, 0.35, 0.72, 1] as const;

/**
 * A full-bleed photo header: the photo fills the area, a dark scrim fades up from the bottom, and the
 * children sit on it. The photo is decoration (hidden from screen readers); the words carry the meaning.
 * It drifts very slowly (a Ken Burns push) unless motion is reduced, the app is in the background, or it is
 * drawn inside a preview. `bleed` runs it to the screen edges inside a padded Screen; `padTop` adds the
 * status-bar inset for hosts that do not already (a modal).
 */
export function PhotoHero({
  source,
  children,
  minHeight = 320,
  bleed = true,
  padTop,
  style,
}: {
  source: ImageSourcePropType;
  children?: ReactNode;
  minHeight?: number;
  bleed?: boolean;
  padTop?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useContext(SafeAreaInsetsContext);
  const run = useActiveLoop(!useStaticArt());
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!run) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 16000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, run]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  return (
    <View style={[styles.frame, bleed && styles.bleed, { minHeight }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <ImageBackground source={source} resizeMode="cover" style={StyleSheet.absoluteFill} accessible={false} />
      </Animated.View>
      <LinearGradient colors={SCRIM} locations={SCRIM_AT} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]} />
      <View style={[styles.body, { minHeight, paddingTop: space.xl + (padTop ? (insets?.top ?? 0) : 0) }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: SCRIM_BASE, borderRadius: radius.xl },
  // Runs out to the screen edges, cancelling the Screen's own padding: only the bottom corners stay round.
  bleed: { marginHorizontal: -space.lg, marginTop: -space.md, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  body: { justifyContent: 'flex-end', paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.md },
});
