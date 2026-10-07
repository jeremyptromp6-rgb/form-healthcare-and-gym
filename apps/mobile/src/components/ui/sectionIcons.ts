import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The little icon bubble beside each section title, by title — so every section in the app gets a
 * friendly marker without each screen having to pick one. Unlisted titles simply show no bubble.
 */
export const SECTION_ICONS: Record<string, { icon: IconName; tint: string }> = {
  "Today's fuel": { icon: 'restaurant', tint: colors.carbs },
  "Today's goals": { icon: 'star', tint: colors.accent },
  'Your level': { icon: 'trophy', tint: colors.accent },
  Milestones: { icon: 'ribbon', tint: colors.purple },
  Coach: { icon: 'chatbubbles', tint: colors.water },
  'Exercise library': { icon: 'barbell', tint: colors.primary },
  History: { icon: 'time', tint: colors.textMuted },
  'Recent workouts': { icon: 'calendar', tint: colors.primary },
  'Personal records': { icon: 'trophy', tint: colors.accent },
  Weight: { icon: 'scale', tint: colors.water },
  'Your plan': { icon: 'map', tint: colors.success },
  Streaks: { icon: 'flame', tint: colors.accent },
  'XP by source': { icon: 'pie-chart', tint: colors.purple },
  'XP history': { icon: 'list', tint: colors.textMuted },
  Ranks: { icon: 'shield', tint: colors.primary },
  'How to': { icon: 'book', tint: colors.success },
  'Your history': { icon: 'time', tint: colors.textMuted },
  'Form history': { icon: 'body', tint: colors.primary },
  Recent: { icon: 'time', tint: colors.textMuted },
  'My foods': { icon: 'heart', tint: colors.protein },
  'Your stats': { icon: 'stats-chart', tint: colors.primary },
  'Next stage': { icon: 'flag', tint: colors.success },
  Insights: { icon: 'bulb', tint: colors.accent },
  Notifications: { icon: 'notifications', tint: colors.accent },
  'Account & data': { icon: 'person', tint: colors.primary },
  Appearance: { icon: 'color-palette', tint: colors.accent },
  Achievements: { icon: 'ribbon', tint: colors.accent },
  'Muscles worked': { icon: 'body', tint: colors.protein },
  'Last session': { icon: 'body', tint: colors.protein },
  Equipment: { icon: 'barbell', tint: colors.primary },
  'Your training': { icon: 'stats-chart', tint: colors.primary },
  Sets: { icon: 'list', tint: colors.primary },
  Records: { icon: 'trophy', tint: colors.accent },
  'Units & dates': { icon: 'options', tint: colors.textMuted },
  Camera: { icon: 'camera', tint: colors.water },
  'Food scanner': { icon: 'scan', tint: colors.success },
  Privacy: { icon: 'lock-closed', tint: colors.textMuted },
  'By day': { icon: 'calendar', tint: colors.water },
  'By week': { icon: 'calendar', tint: colors.water },
  'By month': { icon: 'calendar', tint: colors.water },
};
