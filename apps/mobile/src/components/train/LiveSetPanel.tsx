import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Row } from '@/components/ui';
import { useReducedMotion } from '@/lib/a11y';
import { liveSetSeconds, LIVE_SET_MAX_REPS, type LiveSet } from '@/lib/liveSet';
import type { WorkoutSession } from '@/lib/types';
import { formatClock } from '@/lib/workoutSession';
import { colors, radius, space } from '@/theme/tokens';

/** A short tick for each counted rep; web and devices without a haptic engine stay silent. */
function tick() {
  if (Platform.OS === 'web') return;
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // no haptics available
  }
}

/**
 * A set in progress: a count-up timer, a big +1 rep target, a small undo and Done. The timer is derived from
 * timestamps (see liveSetSeconds), so a re-render, a background trip or a pause can never skew it; the parent's
 * once-a-second clock (`nowMs`) only repaints it. Done reports the seconds the set really ran, read at the tap.
 */
export function LiveSetPanel({
  live,
  session,
  nowMs,
  label,
  onAddRep,
  onUndoRep,
  onDone,
  onCancel,
  disabled,
}: {
  live: LiveSet;
  session: Pick<WorkoutSession, 'pausedMs' | 'pausedAt'>;
  /** The screen's clock, ms (ticks once a second). */
  nowMs: number;
  /** What is being counted, e.g. "Set 2" or "Warm-up set". */
  label: string;
  onAddRep: () => void;
  onUndoRep: () => void;
  onDone: (seconds: number) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const seconds = liveSetSeconds(live, session, nowMs);
  const [pulse] = useState(() => new Animated.Value(1));
  const add = () => {
    if (disabled || live.reps >= LIVE_SET_MAX_REPS) return;
    tick();
    if (!reduce) Animated.sequence([Animated.timing(pulse, { toValue: 0.96, duration: 60, useNativeDriver: true }), Animated.spring(pulse, { toValue: 1, useNativeDriver: true })]).start();
    onAddRep();
  };

  return (
    <View style={styles.wrap}>
      <AppText variant="overline" color={colors.primary}>
        {label} · live
      </AppText>
      <AppText variant="display" accessibilityLabel={`Set time ${formatClock(seconds)}`} style={styles.timer}>
        {formatClock(seconds)}
      </AppText>
      <Animated.View style={{ transform: [{ scale: pulse }], alignSelf: 'stretch' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="+1 rep"
          accessibilityHint={`${live.reps} ${live.reps === 1 ? 'rep' : 'reps'} counted. Tap after each rep`}
          disabled={disabled}
          onPress={add}
          style={({ pressed }) => [styles.tap, pressed && styles.tapPressed, disabled && styles.tapDisabled]}>
          <AppText variant="display" style={styles.count}>
            {live.reps}
          </AppText>
          <AppText variant="bodyStrong" color={colors.onPrimary}>
            {live.reps === 1 ? 'rep · tap for +1' : 'reps · tap for +1'}
          </AppText>
        </Pressable>
      </Animated.View>
      <Row gap={space.sm} style={{ alignSelf: 'stretch' }}>
        <Button label="−1 rep" variant="secondary" onPress={onUndoRep} disabled={disabled || live.reps === 0} style={{ flex: 1 }} />
        <Button label="Done" icon="checkmark" onPress={() => onDone(liveSetSeconds(live, session, Date.now()))} disabled={disabled || live.reps === 0} style={{ flex: 2 }} accessibilityHint="Saves the set with the reps you counted and starts your rest" />
      </Row>
      <Button label="Cancel set" variant="ghost" onPress={onCancel} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, alignItems: 'center' },
  timer: { fontSize: 56, lineHeight: 62, fontVariant: ['tabular-nums'] },
  // Far bigger than the 64pt minimum: tapped mid-set without looking.
  tap: { minHeight: 132, borderRadius: radius.xl, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: space.md },
  tapPressed: { backgroundColor: colors.primaryDeep },
  tapDisabled: { backgroundColor: colors.cardRaised },
  count: { fontSize: 64, lineHeight: 70, color: colors.onPrimary, fontVariant: ['tabular-nums'] },
});
