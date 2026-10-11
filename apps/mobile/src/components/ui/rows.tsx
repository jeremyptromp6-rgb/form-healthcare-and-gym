import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { a11y, colors, radius, space } from '@/theme/tokens';
import { ICON_BUBBLE, stateIcon, type IconName } from './controls';
import { AppText } from './text';

/**
 * A round icon on a soft tint — the one icon treatment for rows and lists. `tint` is a #RRGGBB
 * token colour (the default, muted, sits on a neutral fill); `solid` fills with the tint instead.
 * Sizes come from `ICON_BUBBLE` (32, 40, 48). The icon follows the icon rule: outline at rest,
 * filled when `solid` (earned, done) or when `filled` says so. Decorative: hidden from screen readers.
 */
export function IconBubble({
  icon,
  tint = colors.textMuted,
  size = ICON_BUBBLE.md,
  solid,
  filled,
}: {
  icon: IconName;
  tint?: string;
  size?: number;
  solid?: boolean;
  /** Overrides the icon rule (default: filled exactly when `solid`). */
  filled?: boolean;
}) {
  const backgroundColor = solid ? tint : tint === colors.textMuted ? colors.cardRaised : `${tint}1F`;
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor, alignItems: 'center', justifyContent: 'center' }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      <Ionicons name={stateIcon(icon, filled ?? !!solid)} size={Math.round(size * 0.5)} color={solid ? colors.onPrimary : tint} />
    </View>
  );
}

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
      {!leading && icon ? <IconBubble icon={icon} tint={iconTint} /> : null}
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
      {onPress && chevron ? (
        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </View>
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.row, styles.rowPressable, pressed && { backgroundColor: colors.primarySoft }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: a11y.minTouch + 8, paddingVertical: space.sm },
  // The pressed wash is a rounded fill of the row itself: only its colour changes, so nothing moves and no margin goes negative.
  rowPressable: { borderRadius: radius.sm },
  chevron: { width: 20, alignItems: 'center', justifyContent: 'center' },
});

