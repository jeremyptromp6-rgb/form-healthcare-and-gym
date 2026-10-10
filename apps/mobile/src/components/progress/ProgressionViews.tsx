import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { AppText, Badge, BreathingGlow, Card, ExerciseList, GradientCard, IconButton, InlineMessage, ProgressBar, Row } from '@/components/ui';
import { useReducedMotion } from '@/lib/a11y';
import type { Progress, XpLedgerEntry } from '@/lib/types';
import { RankEmblem, rankColor } from '@/components/art/RankEmblem';
import { ProgressArt } from '@/components/art/SceneArt';
import { colors, gradients, radius, space } from '@/theme/tokens';

export { RankEmblem };

const fmt = (n: number) => Math.round(n).toLocaleString();

/** "LEVEL 13 — 2,450 / 3,000 XP" (or the max-level line). */
export function levelLine(p: Pick<Progress, 'level' | 'xpIntoLevel' | 'xpForNextLevel'>): string {
  return p.xpForNextLevel === 0 ? `LEVEL ${p.level} — max level` : `LEVEL ${p.level} — ${fmt(p.xpIntoLevel)} / ${fmt(p.xpForNextLevel)} XP`;
}

export function streakCaption(p: Progress): string {
  const s = p.streak;
  if (s.current === 0) return 'Log a workout to start a streak';
  if (s.activeToday) return 'Trained today · rest days protect your streak';
  if (s.restDaysRemaining === 0) return 'Train today to keep your streak';
  return `${s.restDaysRemaining} rest day${s.restDaysRemaining === 1 ? '' : 's'} left before it resets`;
}

/** The level hero: emblem, rank, LEVEL n — into / span XP, and the bar to the next level. */
export function LevelHero({ progress: p }: { progress: Progress }) {
  const next = p.rankLadder.find((r) => r.minLevel > p.level);
  return (
    <GradientCard colorsOverride={gradients.heroMedia} style={{ gap: space.lg, paddingVertical: space.xl }}>
      <ProgressArt style={{ position: 'absolute', top: 0, right: 0, width: 170, height: 120, opacity: 0.6 }} />
      <Row gap={space.lg}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <BreathingGlow size={118} color={rankColor(p.rank)} style={{ position: 'absolute' }} />
          <RankEmblem rank={p.rank} size={84} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="overline" color={rankColor(p.rank)}>
            {p.rank}
          </AppText>
          <AppText variant="display" header style={{ fontSize: 40, lineHeight: 46 }}>
            Level {p.level}
          </AppText>
        </View>
      </Row>
      <View style={{ gap: space.sm }}>
        <AppText variant="label" accessibilityLabel={levelLine(p).replace('—', ',')} style={{ fontVariant: ['tabular-nums'] }}>
          {levelLine(p)}
        </AppText>
        <ProgressBar value={p.fractionToNext} height={10} label={`Progress to level ${p.level + 1}`} />
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="caption" color={colors.textMuted}>
            {next ? `${next.name} at level ${next.minLevel}` : 'Top rank reached'}
          </AppText>
          <AppText variant="caption" color={colors.textFaint}>
            {fmt(p.lifetimeXp)} XP all time
          </AppText>
        </Row>
      </View>
      {p.provisionalXp > 0 ? (
        <AppText variant="caption" color={colors.textFaint}>
          Includes {p.provisionalXp} XP from today’s food, confirmed when the day ends.
        </AppText>
      ) : null}
    </GradientCard>
  );
}

/** A gentle celebration for a recent level-up (within a day). Skipped with reduced motion. */
export function LevelUpBanner({ progress: p, now = new Date(), onDismiss }: { progress: Progress; now?: Date; onDismiss?: () => void }) {
  const reduce = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(reduce ? 1 : 0));
  const recent = p.recentLevelUp && now.getTime() - new Date(p.recentLevelUp.at).getTime() < 24 * 3600_000 && p.recentLevelUp.level === p.level;
  useEffect(() => {
    if (!recent) return;
    if (reduce) return anim.setValue(1);
    Animated.spring(anim, { toValue: 1, friction: 6, useNativeDriver: true }).start();
  }, [anim, recent, reduce]);
  if (!recent || !p.recentLevelUp) return null;
  return (
    <Animated.View style={{ opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
      <Card variant="raised" style={styles.levelUp}>
        <Row gap={space.md}>
          <RankEmblem rank={p.recentLevelUp.rank} size={52} />
          <View style={{ flex: 1 }} accessible accessibilityLiveRegion="polite">
            <AppText variant="overline" color={colors.accent}>
              Level up
            </AppText>
            <AppText variant="heading">
              Level {p.recentLevelUp.level} · {p.recentLevelUp.rank}
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              Earned through real training. Keep it going.
            </AppText>
          </View>
          {onDismiss ? <IconButton icon="close" label="Dismiss" onPress={onDismiss} /> : null}
        </Row>
      </Card>
    </Animated.View>
  );
}

/** The full rank ladder as a timeline: reached ranks lit, the current one called out, the rest ahead. */
export function RankLadder({ progress: p }: { progress: Progress }) {
  return (
    <View>
      {p.rankLadder.map((r, i) => {
        const reached = p.level >= r.minLevel;
        const current = p.rank === r.name;
        const last = i === p.rankLadder.length - 1;
        const nextReached = !last && p.level >= p.rankLadder[i + 1]!.minLevel;
        return (
          <View key={r.name} style={styles.step} accessible accessibilityLabel={`${r.name}, from level ${r.minLevel}${current ? ', your rank' : reached ? ', reached' : ''}`}>
            <View style={styles.rail} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <View style={[styles.railLine, { opacity: i === 0 ? 0 : 1, backgroundColor: reached ? colors.primary : colors.border }]} />
              <View style={[styles.node, current ? styles.nodeCurrent : reached ? styles.nodeReached : null]} />
              <View style={[styles.railLine, { opacity: last ? 0 : 1, backgroundColor: nextReached ? colors.primary : colors.border }]} />
            </View>
            <View style={[styles.stepCard, current && styles.stepCardCurrent]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <RankEmblem rank={r.name} size={38} locked={!reached} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" color={reached ? colors.text : colors.textFaint}>
                  {r.name}
                </AppText>
                <AppText variant="caption" color={current ? colors.primary : colors.textFaint}>
                  Level {r.minLevel}
                </AppText>
              </View>
              {current ? <Badge label="You are here" tone="primary" /> : reached ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : <Ionicons name="lock-closed" size={14} color={colors.textFaint} />}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** How to keep progress: when to train next, what missed days cost, and that planned rest is safe. */
export function ConsistencyCard({ progress: p }: { progress: Progress }) {
  const c = p.consistency;
  // With no active XP there is nothing to lose, so there is no countdown to show.
  const days = p.totalXp > 0 ? c.trainWithinDays : null;
  const urgent = days !== null && days <= 2;
  return (
    <Card style={{ gap: space.sm }}>
      <Row gap={space.sm}>
        <Ionicons name={c.recovering ? 'medkit-outline' : urgent ? 'alert-circle' : 'shield-checkmark-outline'} size={20} color={c.recovering ? colors.textMuted : urgent ? colors.warning : colors.primary} />
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {c.recovering
            ? 'Recovering — take the time you need'
            : days === null
              ? p.lastReset
                ? 'Your next workout starts the climb again'
                : 'Your first workout starts your progress'
              : days === 1
                ? `Train today to keep Level ${p.level}`
                : `Train within ${days} days to keep Level ${p.level}`}
        </AppText>
      </Row>
      <View style={{ gap: space.xs }}>
        <AppText variant="label" color={colors.text}>
          {`Your plan: ${c.trainingDaysPerWeek} ${c.trainingDaysPerWeek === 1 ? 'day' : 'days'} a week. Rest days in your plan never cost anything; a missed training day costs ${c.decayPerMissedDay} XP.`}
        </AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {`After more than ${c.resetAfterDays} days without training, your level starts again from 1 — your workouts, records and history always stay.`}
        </AppText>
      </View>
      {c.missedThisWeek > 0 ? (
        <AppText variant="caption" color={colors.warning}>
          {c.missedThisWeek} missed {c.missedThisWeek === 1 ? 'day' : 'days'} this week.
        </AppText>
      ) : null}
    </Card>
  );
}

/** Shown for two weeks after a reset: what happened, and that nothing was lost. */
export function ResetNotice({ progress: p, today }: { progress: Progress; today: string }) {
  const r = p.lastReset;
  if (!r) return null;
  const daysAgo = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${r.date}T12:00:00`).getTime()) / 86_400_000);
  if (daysAgo > 14) return null;
  return (
    <InlineMessage tone="info" icon="refresh">
      {`Fresh start: your level reset on ${new Date(`${r.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} after ${r.gapDays} days without training (you were Level ${r.previousLevel} · ${r.previousRank}). Your workouts, records and full XP history are all kept.`}
    </InlineMessage>
  );
}

/** Where XP came from (and went): the ledger, newest first. */
export function XpHistory({ events }: { events: XpLedgerEntry[] }) {
  if (events.length === 0) {
    return (
      <AppText variant="caption" color={colors.textMuted}>
        Your XP history appears here — every workout, quest and nutrition day, and anything that changed it.
      </AppText>
    );
  }
  return (
    <ExerciseList>
      {events.map((e) => {
        const positive = e.xp > 0;
        const neutral = e.xp === 0;
        return (
          <View key={e.id} style={[styles.row, { minHeight: 52, paddingVertical: space.sm }]} accessible accessibilityLabel={`${e.label}, ${e.xp >= 0 ? 'plus' : 'minus'} ${Math.abs(e.xp)} XP${e.localDate ? `, ${e.localDate}` : ''}`}>
            <View style={{ flex: 1 }}>
              <AppText variant="body">{e.label}</AppText>
              <AppText variant="caption" color={colors.textFaint}>
                {e.localDate ? new Date(`${e.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : new Date(e.at).toLocaleDateString()}
              </AppText>
            </View>
            <AppText variant="bodyStrong" color={neutral ? colors.textFaint : positive ? colors.primary : colors.warning} style={{ fontVariant: ['tabular-nums'] }}>
              {neutral ? '—' : `${positive ? '+' : '−'}${Math.abs(e.xp)} XP`}
            </AppText>
          </View>
        );
      })}
    </ExerciseList>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'stretch', gap: space.md },
  rail: { width: 14, alignItems: 'center' },
  railLine: { flex: 1, width: 2 },
  node: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.bg },
  nodeReached: { borderColor: colors.primary, backgroundColor: colors.primary },
  nodeCurrent: { width: 14, height: 14, borderRadius: 7, borderColor: colors.primary, backgroundColor: colors.bg, borderWidth: 4 },
  stepCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.sm, marginVertical: 3, borderRadius: radius.md },
  stepCardCurrent: { backgroundColor: colors.primarySoft },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  levelUp: { borderWidth: 1, borderColor: colors.accentSoft, borderRadius: radius.xl },
});
