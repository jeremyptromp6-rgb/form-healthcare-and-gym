import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Buddy } from '@/components/art/Buddy';
import { CoachCard } from '@/components/coach/CoachViews';
import { AppText, Button, Card, Row, SectionAction } from '@/components/ui';
import { planMeta, planReason } from '@/lib/homeFormat';
import type { HomeInsight } from '@/lib/homeInsight';
import type { HomeViewModel, WorkoutPlan } from '@/lib/types';
import { colors, space } from '@/theme/tokens';
import type { HomeRoute } from './HomeView';

/** The two things Home leads with: what to do today, and at most one thing worth knowing. */

export interface OpenSession {
  status: 'active' | 'paused';
}

/**
 * "What should I do today?" One card, one action. With today's plan it names the workout, says how
 * long it takes and why it fits; without it, it falls back to the server's own suggestion.
 */
export function TodayCard({
  today,
  plan,
  goal,
  openSession,
  onNavigate,
}: {
  today: HomeViewModel['today'];
  plan?: WorkoutPlan | null;
  goal: HomeViewModel['greeting']['primaryGoal'];
  openSession?: OpenSession | null;
  onNavigate: (route: HomeRoute) => void;
}) {
  const s = today?.suggestion;
  const week = today ? { done: today.workoutsThisWeek, planned: today.plannedDaysPerWeek } : null;

  let overline = 'Today';
  let title: string;
  let meta: string | null = null;
  let reason: string;
  let action: { label: string; route: HomeRoute; primary: boolean } | null = null;
  let mood: 'proud' | 'rest' | null = null;

  if (openSession) {
    overline = 'In progress';
    title = plan?.title ?? 'Your workout';
    meta = plan ? planMeta(plan) : null;
    reason = openSession.status === 'paused' ? 'Your workout is paused. Pick up where you left off.' : 'You have a workout open. Pick up where you left off.';
    action = { label: 'Resume workout', route: 'workout', primary: true };
  } else if (!s || s.kind === 'train') {
    if (!s && !plan) return null;
    title = plan?.title ?? s?.title ?? 'Train today';
    meta = plan ? planMeta(plan) : null;
    reason = plan ? planReason(goal, week?.done ?? 0, week?.planned ?? null, plan) : (s?.reason ?? '');
    action = { label: 'Start workout', route: 'train', primary: true };
  } else if (s.kind === 'rest_suggested') {
    title = s.title;
    reason = s.reason;
    action = { label: 'Train anyway', route: 'train', primary: false };
    mood = 'rest';
  } else if (s.kind === 'recover') {
    overline = 'Recover';
    title = s.title;
    reason = 'Rest is the training today. Your body does the building while you recover.';
    mood = 'rest';
  } else {
    title = s.title;
    reason = s.reason;
    mood = 'proud';
  }

  return (
    <Card variant="raised" style={styles.today}>
      <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <AppText variant="overline" color={overline === 'Recover' ? colors.warning : colors.primary}>
            {overline}
          </AppText>
          <AppText variant="display" header>
            {title}
          </AppText>
          {meta ? (
            <AppText variant="bodyStrong" color={colors.textMuted}>
              {meta}
            </AppText>
          ) : null}
        </View>
        {mood ? <Buddy mood={mood} size={52} float={false} /> : null}
      </Row>
      <AppText variant="body" color={colors.textMuted}>
        {reason}
      </AppText>
      {week?.planned ? <WeekDots done={week.done} planned={week.planned} /> : null}
      {action ? <Button label={action.label} iconRight={action.primary ? 'arrow-forward' : undefined} variant={action.primary ? 'primary' : 'secondary'} onPress={() => onNavigate(action.route)} /> : null}
    </Card>
  );
}

/** One dot per planned session this week, filled as they're done. */
function WeekDots({ done, planned }: { done: number; planned: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessible accessibilityLabel={`${done} of ${planned} sessions this week`}>
      {Array.from({ length: Math.max(planned, done) }, (_, i) => (
        <View key={i} style={[styles.dot, i < done && { backgroundColor: colors.primary }]} />
      ))}
    </View>
  );
}

/** The single insight under the primary card. Renders nothing when there isn't one. */
export function InsightCard({
  insight,
  onNavigate,
  onOpenCoach,
  onOpenRoute,
}: {
  insight: HomeInsight | null;
  onNavigate: (route: HomeRoute) => void;
  onOpenCoach?: () => void;
  onOpenRoute?: (route: string) => void;
}) {
  if (!insight) return null;
  if (insight.kind === 'coach') {
    return (
      <View style={{ gap: space.sm }}>
        {/* The Today card above already starts the workout: the tip never repeats that button. */}
        <CoachCard response={{ ...insight.response, actions: insight.response.actions.filter((a) => a.id !== 'open_train') }} title="Today's tip" onAction={onOpenRoute} compact />
        {onOpenCoach ? <SectionAction label="Ask the coach" onPress={onOpenCoach} /> : null}
      </View>
    );
  }
  const warn = insight.kind === 'recovery' || insight.kind === 'form';
  const icon = insight.kind === 'recovery' ? 'bandage-outline' : insight.kind === 'form' ? 'shield-checkmark-outline' : 'bulb-outline';
  const label = insight.kind === 'recovery' ? 'Recovery' : insight.kind === 'form' ? 'Form first' : 'Worth knowing';
  return (
    <Card style={{ gap: space.sm }}>
      <Row gap={space.sm}>
        <Ionicons name={icon} size={16} color={warn ? colors.warning : colors.primary} />
        <AppText variant="label" color={colors.textMuted}>
          {label}
        </AppText>
      </Row>
      <AppText variant="body">{insight.text}</AppText>
      {insight.kind === 'data' ? <SectionAction label={insight.action.label} onPress={() => onNavigate(insight.action.route)} /> : null}
    </Card>
  );
}

/** The quiet toggle that holds the rest of the day's numbers. */
export function MoreToggle({ open, summary, onToggle }: { open: boolean; summary: string; onToggle: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="More from today"
      accessibilityHint={open ? 'Hides your food, water, goals and level' : 'Shows your food, water, goals and level'}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
      onPress={onToggle}
      style={({ pressed }) => [styles.more, { opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">More from today</AppText>
        {!open && summary ? (
          <AppText variant="caption" color={colors.textMuted} numberOfLines={2}>
            {summary}
          </AppText>
        ) : null}
      </View>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  today: { gap: space.md },
  dot: { width: 28, height: 6, borderRadius: 3, backgroundColor: colors.border },
  more: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
});
