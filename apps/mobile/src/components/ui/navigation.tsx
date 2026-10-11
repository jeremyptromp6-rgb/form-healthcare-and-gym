import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { colors, edgeLight, elevation, fonts } from '@/theme/tokens';
import { ICON_BUBBLE } from './controls';

/**
 * The Back button for every stack: a 44 × 44 target on every platform (the default header button
 * is 30 × 30 on web, where hitSlop doesn't apply) and a spoken name that says where it goes.
 * A small raised disc inside the target: it dips to the raised tone and shrinks a touch when pressed,
 * like every other control.
 */
function BackButton({ label }: { label?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? `Back to ${label}` : 'Back'}
      onPress={() => router.back()}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -6 }}>
      {({ pressed }) => (
        <View
          style={[
            {
              width: ICON_BUBBLE.md - 4,
              height: ICON_BUBBLE.md - 4,
              borderRadius: ICON_BUBBLE.md / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? colors.cardRaised : colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              transform: [{ scale: pressed && !reduceMotion ? 0.94 : 1 }],
            },
            pressed ? elevation.flat : elevation.card,
            edgeLight,
          ]}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </View>
      )}
    </Pressable>
  );
}

/** Header options shared by the tab stacks (Train, Eat, Progress, Profile). */
export const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 17 },
  // Every stack page opens with its own large title, so the bar shows only the way back.
  headerTitle: () => null,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
  headerLeft: ({ canGoBack, label }: { canGoBack?: boolean; label?: string }) => (canGoBack ? <BackButton label={label} /> : null),
} as const;
