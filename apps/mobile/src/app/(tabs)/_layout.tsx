import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CelebrationHost } from '@/components/recognition/Celebrations';
import type { IconName } from '@/components/ui';
import { InTabsContext, TAB_BAR, tabBarBottomPadding } from '@/components/ui/tabBar';
import { breakpoints, colors, fonts } from '@/theme/tokens';

const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', iconActive: 'home' },
  { name: 'train', title: 'Train', icon: 'barbell-outline', iconActive: 'barbell' },
  { name: 'eat', title: 'Eat', icon: 'restaurant-outline', iconActive: 'restaurant' },
  { name: 'progress', title: 'Progress', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { name: 'profile', title: 'Profile', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

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
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textFaint,
          tabBarStyle: wide
            ? { backgroundColor: colors.card, borderRightColor: colors.border, borderRightWidth: 1, minWidth: 220, paddingTop: 16 }
            : {
                backgroundColor: colors.surface,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
                height: TAB_BAR.height + bottom,
                paddingTop: 6,
                paddingBottom: bottom,
                paddingHorizontal: 6,
                elevation: 0,
                shadowOpacity: 0,
              },
          // The active tab: a soft coral pill behind its icon and label.
          tabBarItemStyle: wide ? undefined : { borderRadius: 18, marginHorizontal: 2, marginBottom: 2, overflow: 'hidden' },
          tabBarActiveBackgroundColor: wide ? undefined : colors.primarySoft,
          tabBarLabelStyle: { fontSize: wide ? 15 : 11, fontFamily: fonts.semibold, letterSpacing: -0.1 },
          sceneStyle: { backgroundColor: colors.bg },
        }}>
        {TABS.map((t) => (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarAccessibilityLabel: t.title,
              tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? t.iconActive : t.icon} size={size} color={color} />,
            }}
          />
        ))}
      </Tabs>
      {/* Achievements, streak milestones and Body Quest stages, celebrated once, wherever the user is. */}
      <CelebrationHost />
    </InTabsContext.Provider>
  );
}
