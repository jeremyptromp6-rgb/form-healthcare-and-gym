import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { a11y, colors, space } from '@/theme/tokens';
import type { IconName } from './controls';
import { AppText } from './text';

/**
 * One tappable row: optional icon, a title, a quiet subtitle, something on the right, a chevron.
 * The same row everywhere — settings, exercise library, history, meals.
 */
export function ListRow({
  title,
  subtitle,
  icon,
  leading,
  iconTint = colors.textMuted,
  right,
  onPress,
  accessibilityLabel,
  chevron = true,
}: {
  title: string;
  subtitle?: string | null;
  icon?: IconName;
  /** A picture before the text (e.g. an exercise thumbnail); takes the place of `icon`. */
  leading?: ReactNode;
  iconTint?: string;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  chevron?: boolean;
}) {
  const body = (
    <>
      {leading}
      {!leading && icon ? (
        <View style={[styles.icon, { backgroundColor: iconTint === colors.textMuted ? colors.cardRaised : `${iconTint}1F` }]}>
          <Ionicons name={icon} size={18} color={iconTint} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numberOfLines={2}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" color={colors.textMuted} numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
      {onPress && chevron ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: a11y.minTouch + 8, paddingVertical: space.sm },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
