import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CelebrationHost } from '@/components/recognition/Celebrations';
import type { IconName } from '@/components/ui';
import { breakpoints, colors, fonts, scheme, shadow } from '@/theme/tokens';

const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', iconActive: 'home' },
  { name: 'train', title: 'Train', icon: 'barbell-outline', iconActive: 'barbell' },
  { name: 'eat', title: 'Eat', icon: 'restaurant-outline', iconActive: 'restaurant' },
  { name: 'progress', title: 'Progress', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { name: 'profile', title: 'Profile', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

/** Bottom tabs on phones; a side rail on wide screens (tablets, desktop web). */
export default function TabLayout() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoints.wide;
  const insets = useSafeAreaInsets();
  return (
    <>
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
            : // Phones: a floating pill above the bottom edge, clear of the home indicator.
              {
                position: 'absolute',
                left: 16,
                right: 16,
                bottom: Math.max(insets.bottom, 12),
                height: 66,
                paddingTop: 8,
                paddingBottom: 8,
                paddingHorizontal: 6,
                borderRadius: 33,
                backgroundColor: 'transparent',
                borderTopWidth: 0,
                borderWidth: 1,
                borderColor: colors.border,
                ...shadow.lifted,
              },
          tabBarItemStyle: wide ? undefined : { borderRadius: 24, marginHorizontal: 1, paddingHorizontal: 0, overflow: 'hidden' },
          tabBarActiveBackgroundColor: wide ? undefined : colors.primarySoft,
          // Frosted glass: the page shows softly through the floating bar.
          tabBarBackground: wide
            ? undefined
            : () => (
                <>
                  <BlurView intensity={50} tint={scheme === 'dark' ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: 33 }]} />
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glass, borderRadius: 33 }]} />
                </>
              ),
          tabBarLabelStyle: { fontSize: wide ? 15 : 10.5, fontFamily: fonts.semibold, letterSpacing: -0.1 },
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
    </>
  );
}
