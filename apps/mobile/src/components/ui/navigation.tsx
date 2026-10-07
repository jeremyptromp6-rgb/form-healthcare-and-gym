import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable } from 'react-native';
import { colors, fonts } from '@/theme/tokens';

/**
 * The Back button for every stack: a 44 × 44 target on every platform (the default header button
 * is 30 × 30 on web, where hitSlop doesn't apply) and a spoken name that says where it goes.
 */
function BackButton({ label }: { label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? `Back to ${label}` : 'Back'}
      onPress={() => router.back()}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -6 }}>
      <Ionicons name="chevron-back" size={24} color={colors.text} />
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
