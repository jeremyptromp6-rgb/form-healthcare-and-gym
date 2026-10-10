import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, ProgressBar } from '@/components/ui';
import { formatClock } from '@/lib/workoutSession';
import { a11y, colors, MAX_CONTENT_WIDTH, radius, shadow, space } from '@/theme/tokens';

/**
 * The rest countdown as a floating pill. The parent positions it; this only draws the surface.
 * The clock is not a live region (a per-second announcement would talk over the user); screen
 * readers get the remaining time when they focus it.
 */
export function RestTimerPill({
  remainingSeconds,
  totalSeconds,
  onAdd,
  onSkip,
}: {
  remainingSeconds: number;
  totalSeconds?: number | null;
  onAdd: (deltaSeconds: number) => void;
  onSkip: () => void;
}) {
  const remaining = Math.max(0, Math.ceil(remainingSeconds));
  const progress = totalSeconds && totalSeconds > 0 ? remaining / totalSeconds : null;
  return (
    <View style={styles.pill}>
      <View style={styles.top}>
        <AppText variant="label" color={colors.textMuted}>
          Rest
        </AppText>
        <AppText variant="heading" accessibilityLabel={`${remaining} seconds of rest left`} style={{ fontVariant: ['tabular-nums'] }}>
          {formatClock(remaining)}
        </AppText>
      </View>
      {progress !== null ? <ProgressBar value={progress} color={colors.accent} height={6} /> : null}
      <View style={styles.actions}>
        <Action label="+15 s" onPress={() => onAdd(15)} />
        <Action label="+30 s" onPress={() => onAdd(30)} />
        <Action label="Skip rest" onPress={onSkip} primary />
      </View>
    </View>
  );
}

function Action({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.action, primary && styles.actionPrimary]}>
      <AppText variant="bodyStrong" color={primary ? colors.primary : colors.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.cardRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.lifted,
  },
  top: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: {
    flexGrow: 1,
    minWidth: 88,
    minHeight: a11y.minTouch,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
