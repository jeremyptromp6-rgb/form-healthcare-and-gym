import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, View } from 'react-native';
import { Buddy } from '@/components/art/Buddy';
import { AppText, Button, type IconName } from '@/components/ui';
import { useReducedMotion } from '@/lib/a11y';
import { useCelebrations, useMarkCelebrationsSeen } from '@/lib/queries';
import type { Celebration } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import { ACHIEVEMENT_ICON, STAGE_INFO } from './RecognitionViews';

interface CelebrationCopy {
  overline: string;
  title: string;
  value?: string;
  body: string;
  icon: IconName;
  tint: string;
  /** Read aloud for screen readers. */
  label: string;
}

const STREAK_COPY: Record<'workout' | 'weekly' | 'nutrition' | 'quest', { title: (n: number) => string; body: string; icon: IconName }> = {
  // Rest is part of every streak: nothing here should push someone to skip recovery.
  workout: { title: (n) => `${n}-day training streak`, body: 'Rest days included — recovery is part of the streak.', icon: 'flame' },
  weekly: { title: (n) => `${n} weeks on plan`, body: 'Week after week, exactly as planned.', icon: 'calendar' },
  nutrition: { title: (n) => `${n} days on target`, body: 'Fuelled well, day after day.', icon: 'leaf' },
  quest: { title: (n) => `${n}-day quest streak`, body: 'Small wins, every day.', icon: 'flag' },
};

/** Human copy for a celebration. Everything shown comes from the server's event. */
export function celebrationCopy(c: Celebration): CelebrationCopy {
  switch (c.kind) {
    case 'achievement': {
      const p = c.payload;
      return {
        overline: 'Achievement unlocked',
        title: p.title,
        value: p.xpReward > 0 ? `+${p.xpReward} XP` : undefined,
        body: p.description,
        icon: ACHIEVEMENT_ICON[p.achievementId] ?? 'star',
        tint: colors.accent,
        label: `Achievement unlocked: ${p.title}. ${p.description}${p.xpReward > 0 ? ` Plus ${p.xpReward} XP.` : ''}`,
      };
    }
    case 'personal_record': {
      const p = c.payload;
      const what = p.exerciseName ? `${p.exerciseName} · ${p.label}` : p.label;
      return {
        overline: 'New personal record',
        title: what,
        value: p.display,
        body: `Up from ${p.previousDisplay}. Verified by the camera, so it's earned.`,
        icon: 'trophy',
        tint: colors.accent,
        label: `New personal record: ${what}, ${p.display}, up from ${p.previousDisplay}.`,
      };
    }
    case 'streak': {
      const s = STREAK_COPY[c.payload.streak];
      return { overline: 'Streak milestone', title: s.title(c.payload.length), body: s.body, icon: s.icon, tint: colors.accent, label: `Streak milestone: ${s.title(c.payload.length)}. ${s.body}` };
    }
    case 'body_quest': {
      const info = STAGE_INFO[c.payload.stage];
      return { overline: 'Body Quest', title: `${info.label} reached`, body: info.blurb, icon: info.icon, tint: info.color, label: `Body Quest: ${info.label} reached. ${info.blurb}` };
    }
  }
}

/** One celebration: a medallion with a soft ring that blooms out (still, with reduced motion). */
export function CelebrationCard({ celebration, position, onDone }: { celebration: Celebration; position?: { index: number; total: number }; onDone: () => void }) {
  const copy = celebrationCopy(celebration);
  const reduce = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const [ring] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) {
      enter.setValue(1);
      ring.setValue(1);
      return;
    }
    enter.setValue(0);
    ring.setValue(0);
    Animated.parallel([
      Animated.spring(enter, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
      Animated.timing(ring, { toValue: 1, duration: 900, delay: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [celebration.id, enter, reduce, ring]);

  return (
    <Animated.View style={[styles.card, { opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
      <View style={styles.medalWrap}>
        {!reduce ? (
          <Animated.View
            style={[
              styles.ring,
              { borderColor: copy.tint, opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.9] }) }] },
            ]}
          />
        ) : null}
        <View style={[styles.medal, { borderColor: copy.tint, backgroundColor: `${copy.tint}22` }]}>
          <Ionicons name={copy.icon} size={34} color={copy.tint} />
        </View>
        {/* Pip, proud of you — the same companion that greets you on Home. */}
        <View style={styles.pip} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Buddy mood="proud" size={54} float={false} />
        </View>
      </View>
      <View accessible accessibilityLiveRegion="polite" accessibilityLabel={copy.label} style={{ alignItems: 'center', gap: space.xs }}>
        <AppText variant="overline" color={copy.tint}>
          {copy.overline}
        </AppText>
        <AppText variant="title" style={{ textAlign: 'center', fontSize: 24, lineHeight: 30 }}>
          {copy.title}
        </AppText>
        {copy.value ? (
          <AppText variant="display" style={{ fontSize: 34, lineHeight: 40 }}>
            {copy.value}
          </AppText>
        ) : null}
        <AppText variant="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          {copy.body}
        </AppText>
      </View>
      {position && position.total > 1 ? (
        <AppText variant="caption" color={colors.textFaint}>
          {position.index + 1} of {position.total}
        </AppText>
      ) : null}
      <Button label={position && position.index + 1 < position.total ? 'Next' : 'Nice'} onPress={onDone} style={{ alignSelf: 'stretch' }} />
    </Animated.View>
  );
}

/** The workout summary celebrates its own records, so they don't pop up again afterwards. */
export function useMarkWorkoutRecordsSeen(workoutId: string | null) {
  const feed = useCelebrations();
  const { mutate } = useMarkCelebrationsSeen();
  const key = workoutId
    ? (feed.data?.celebrations ?? [])
        .filter((c) => c.kind === 'personal_record' && c.payload.workoutId === workoutId)
        .map((c) => c.id)
        .join(',')
    : '';
  useEffect(() => {
    if (key) mutate(key.split(',').map(Number));
  }, [key, mutate]);
}

/**
 * Shows pending celebrations one at a time over the current screen, marking each seen as it is
 * dismissed. Personal records from a workout are celebrated on that workout's summary instead.
 */
export function CelebrationHost({ exclude }: { exclude?: (c: Celebration) => boolean }) {
  const feed = useCelebrations();
  const markSeen = useMarkCelebrationsSeen();
  // Hidden ids stay hidden; the run counter ("2 of 3") restarts once a run of celebrations is done.
  const [hidden, setHidden] = useState<number[]>([]);
  const [shownInRun, setShownInRun] = useState(0);
  const pending = (feed.data?.celebrations ?? []).filter((c) => !hidden.includes(c.id) && !(exclude?.(c) ?? false));
  const current = pending[0];
  if (!current) return null;
  const done = () => {
    setHidden((h) => [...h, current.id]);
    setShownInRun((n) => (pending.length > 1 ? n + 1 : 0));
    markSeen.mutate([current.id]);
  };
  return (
    <Modal transparent animationType="fade" visible onRequestClose={done}>
      <View style={styles.scrim}>
        <CelebrationCard celebration={current} position={{ index: shownInRun, total: shownInRun + pending.length }} onDone={done} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(58,42,31,0.42)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.card, borderRadius: radius.xl, padding: space.xl, gap: space.lg, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  medalWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2, pointerEvents: 'none' },
  medal: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pip: { position: 'absolute', right: -34, bottom: -10 },
});
