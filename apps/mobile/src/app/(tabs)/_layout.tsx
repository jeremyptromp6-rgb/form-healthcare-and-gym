import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CelebrationHost } from '@/components/recognition/Celebrations';
import { stateIcon, type IconName } from '@/components/ui';
import { InTabsContext, TAB_BAR, tabBarBottomPadding } from '@/components/ui/tabBar';
import { breakpoints, colors, edgeLight, elevation, fonts } from '@/theme/tokens';

// One name per tab: the icon rule (outline at rest, filled when active) comes from `stateIcon`.
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'train', title: 'Train', icon: 'barbell' },
  { name: 'eat', title: 'Eat', icon: 'restaurant' },
  { name: 'progress', title: 'Progress', icon: 'stats-chart' },
  { name: 'profile', title: 'Profile', icon: 'person-circle' },
];

// The active colour has to read at 12px: the teal passes 4.5:1 on the bar in both moods.
const ACTIVE = colors.primary;

/**
 * Bottom tabs on phones; a side rail on wide screens (tablets, desktop web). The phone bar is
 * docked and solid: screens end above it, so it never covers a button or the last list item, and
 * it sits clear of the system navigation bar (gesture or buttons).
 */
export default function TabLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.wide;
  const insets = useSafeAreaInsets();
  const bottom = tabBarBottomPadding(insets.bottom);
  return (
    <InTabsContext.Provider value>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarPosition: wide ? 'left' : 'bottom',
          tabBarVariant: wide ? 'material' : 'uikit',
          tabBarLabelPosition: wide ? 'beside-icon' : 'below-icon',
          tabBarActiveTintColor: ACTIVE,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: wide
            ? { backgroundColor: colors.card, borderRightColor: colors.border, borderRightWidth: 1, minWidth: 220, paddingTop: 16 }
            : {
                backgroundColor: colors.surface,
                // A hairline in light mode; in dark mode the lit top edge instead (light falls from above).
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
                ...edgeLight,
                height: TAB_BAR.height + bottom,
                paddingTop: 6,
                paddingBottom: bottom,
                paddingHorizontal: 6,
                // Rests on the page: the card shadow thrown upward.
                ...elevation.card,
                shadowOffset: { width: 0, height: -3 },
              },
          tabBarItemStyle: wide ? undefined : { marginHorizontal: 2 },
          tabBarLabelStyle: { fontSize: wide ? 15 : 12, lineHeight: wide ? 20 : 16, fontFamily: fonts.semibold, letterSpacing: wide ? -0.1 : -0.15 },
          sceneStyle: { backgroundColor: colors.bg },
        }}>
        {TABS.map((t) => (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarAccessibilityLabel: t.title,
              tabBarIcon: ({ color, size, focused }) =>
                wide ? (
                  <Ionicons name={stateIcon(t.icon, focused)} size={size} color={color} />
                ) : (
                  // The active tab: a soft teal pill behind a filled icon.
                  <View style={[styles.pill, focused && styles.pillActive]}>
                    <Ionicons name={stateIcon(t.icon, focused)} size={Math.min(size, 24)} color={color} />
                  </View>
                ),
            }}
          />
        ))}
      </Tabs>
      {/* Achievements, streak milestones and Body Quest stages, celebrated once, wherever the user is. */}
      <CelebrationHost />
    </InTabsContext.Provider>
  );
}

const styles = StyleSheet.create({
  pill: { width: 56, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  pillActive: { backgroundColor: colors.primarySoft, borderColor: `${colors.primary}33` },
});
