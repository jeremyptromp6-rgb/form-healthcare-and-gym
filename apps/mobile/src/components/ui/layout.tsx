import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Children, useContext, useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, ImageBackground, Platform, RefreshControl, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '@/lib/a11y';
import { colors, gradients, MAX_CONTENT_WIDTH, radius, scheme, shadow, space } from '@/theme/tokens';
import { SECTION_ICONS } from './sectionIcons';
import { AppText } from './text';

/** Scroll offsets: where the big title starts to fade and the compact glass bar takes over. */
const FADE_START = 24;
const FADE_END = 84;

/**
 * A scrolling screen, lit like a scene: warm light falls across the top, the big title sits in it,
 * and as you scroll a frosted bar with the title slides in over the content. `hero` replaces the
 * plain header with something richer (e.g. Home's greeting).
 */
export function Screen({
  title,
  subtitle,
  right,
  hero,
  children,
  refreshing,
  onRefresh,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  hero?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  // Read directly so a screen rendered outside a provider (tests, previews) still works.
  const topInset = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const [scrollY] = useState(() => new Animated.Value(0));
  const titleFade = scrollY.interpolate({ inputRange: [FADE_START, FADE_END], outputRange: [1, 0], extrapolate: 'clamp' });
  const barIn = scrollY.interpolate({ inputRange: [FADE_START + 20, FADE_END], outputRange: [0, 1], extrapolate: 'clamp' });
  const glowShift = scrollY.interpolate({ inputRange: [0, 300], outputRange: [0, -120], extrapolate: 'clamp' });
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      {/* Ambient light: drifts up a little slower than the content, for depth. */}
      <Animated.View pointerEvents="none" style={[styles.ambient, { transform: [{ translateY: glowShift }] }]}>
        <LinearGradient colors={gradients.ambient} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web' })}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}>
        {hero ?? (
          <Animated.View style={[styles.header, { opacity: titleFade }]}>
            <View style={{ flex: 1, gap: 2 }}>
              {subtitle ? (
                <AppText variant="label" color={colors.textFaint}>
                  {subtitle}
                </AppText>
              ) : null}
              <AppText variant="title" header style={{ fontSize: 34, lineHeight: 40 }}>
                {title}
              </AppText>
            </View>
            {right}
          </Animated.View>
        )}
        {Children.toArray(children).map((child, i) => (
          <Appear key={i} index={i}>
            {child}
          </Appear>
        ))}
      </Animated.ScrollView>
      {/* The compact bar: frosted glass and the title, once the big one has scrolled away. */}
      <Animated.View pointerEvents="none" style={[styles.compactBar, { top: topInset, opacity: barIn }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <BlurView intensity={40} tint={scheme === 'dark' ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glass }]} />
        <AppText variant="bodyStrong" numberOfLines={1}>
          {title}
        </AppText>
      </Animated.View>
    </SafeAreaView>
  );
}

/** A cinematic entrance — rise, fade and a breath of scale — staggered down the screen. Instant with reduced motion. */
export function Appear({ index = 0, children }: { index?: number; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [v] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return v.setValue(1);
    Animated.timing(v, { toValue: 1, duration: 640, delay: Math.min(index, 8) * 70, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true }).start();
  }, [v, index, reduce]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
      }}>
      {children}
    </Animated.View>
  );
}

/** A soft light that slowly breathes behind a hero subject (Pip, a rank shield, today's exercise). Still with reduced motion. */
export function BreathingGlow({ size, color = colors.accent, style }: { size: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, reduce]);
  const ring = (k: number, o: number) => (
    <Animated.View
      key={k}
      style={{
        position: 'absolute',
        width: size * k,
        height: size * k,
        borderRadius: (size * k) / 2,
        backgroundColor: color,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [o * 0.7, o] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
      }}
    />
  );
  return (
    <View pointerEvents="none" style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {/* Many faint layers make a soft falloff instead of visible rings. */}
      {[1, 0.88, 0.76, 0.64, 0.52, 0.4].map((k, i) => ring(k, 0.045 + i * 0.012))}
    </View>
  );
}

/**
 * A surface. `plain` drops the background for open layouts; `raised` lifts it a step. Use cards
 * for things that belong together — not for every piece of text.
 */
export function Card({ children, style, variant = 'default' }: { children: ReactNode; style?: StyleProp<ViewStyle>; variant?: 'default' | 'raised' | 'plain' }) {
  return <View style={[styles.card, variant === 'raised' && styles.raised, variant === 'plain' && styles.plain, style]}>{children}</View>;
}

/** A feature surface with a quiet lift — for the one thing on a screen that matters most. */
export function GradientCard({
  children,
  colorsOverride = gradients.hero,
  style,
}: {
  children: ReactNode;
  colorsOverride?: readonly [string, string, ...string[]];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient colors={colorsOverride} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, styles.gradientCard, style]}>
      {children}
    </LinearGradient>
  );
}

/**
 * Imagery with content on top. With a real photo (see `theme/imagery.ts`) the photo fills the
 * area under a scrim; without one, a calm gradient stands in — never a fake or generated photo.
 */
export function HeroMedia({
  image,
  art,
  children,
  minHeight = 220,
  style,
  accessibilityLabel,
}: {
  image?: ImageSourcePropType | null;
  /** Decorative illustration drawn behind the words (used when there is no photo). */
  art?: ReactNode;
  children: ReactNode;
  minHeight?: number;
  style?: StyleProp<ViewStyle>;
  /** Describes the photo, when there is one. */
  accessibilityLabel?: string;
}) {
  // The scrim keeps type readable over a photo; over the drawn scenes it would only hide them.
  const body = image ? (
    <LinearGradient colors={gradients.scrim} locations={[0, 0.45, 1]} style={[styles.heroBody, { minHeight }]}>
      {children}
    </LinearGradient>
  ) : (
    <View style={[styles.heroBody, { minHeight }]}>{children}</View>
  );
  if (image) {
    return (
      <ImageBackground source={image} resizeMode="cover" style={[styles.hero, style]} imageStyle={{ borderRadius: radius.xl }} accessible={false} accessibilityLabel={accessibilityLabel}>
        {body}
      </ImageBackground>
    );
  }
  return (
    <LinearGradient colors={gradients.heroMedia} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.hero, style]}>
      {art ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {art}
        </View>
      ) : null}
      {body}
    </LinearGradient>
  );
}

/** A section title in plain, sentence-case language ("Today's fuel"), with an optional action. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const mark = SECTION_ICONS[title];
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
        {mark ? (
          <View style={[styles.sectionIcon, { backgroundColor: `${mark.tint}1F` }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Ionicons name={mark.icon} size={15} color={mark.tint} />
          </View>
        ) : null}
        <AppText variant="heading" header style={{ fontSize: 20, lineHeight: 26, letterSpacing: -0.2 }}>
          {title}
        </AppText>
      </View>
      {action}
    </View>
  );
}

export function Row({ children, style, gap = space.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

/** A quiet hairline between rows. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.hairline }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  ambient: { position: 'absolute', top: 0, left: 0, right: 0, height: 460 },
  compactBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 52, alignItems: 'center', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  scroll: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 140, gap: space.lg, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: space.sm, paddingBottom: space.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border, borderTopColor: colors.edge, ...shadow.card },
  raised: { backgroundColor: colors.cardRaised, borderColor: colors.border },
  plain: { backgroundColor: 'transparent', borderWidth: 0, padding: 0, shadowOpacity: 0, elevation: 0 },
  gradientCard: { overflow: 'hidden', borderRadius: radius.xl },
  hero: { borderRadius: radius.xl, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...shadow.lifted },
  heroBody: { justifyContent: 'flex-end', padding: space.xl, gap: space.md },
  sectionIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.md, marginBottom: -space.xs },
});
