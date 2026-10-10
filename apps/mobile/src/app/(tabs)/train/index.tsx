import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ExerciseArt, ExerciseThumb } from '@/components/art/ExerciseArt';
import { AppText, Badge, IconTabs, StatStrip, WeekDays, Button, Card, Divider, ErrorState, HeroMedia, InlineMessage, ListRow, Row, Screen, StateView } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { trainingWeek } from '@/lib/week';
import { ExerciseLibrary } from '@/components/train/ExerciseLibrary';
import { useFeature } from '@/lib/features';
import { livePoseSupport } from '@/lib/pose/support';
import { useActiveSession, useExercises, useRefetchOnFocus, useStartSession, useTodayWorkout, useWorkouts } from '@/lib/queries';
import type { PlannedExercise, Progression } from '@/lib/types';
import { formatRest, sessionTotals } from '@/lib/workoutSession';
import { imagery } from '@/theme/imagery';
import { colors, radius, space } from '@/theme/tokens';

const PROGRESSION_BADGE: Partial<Record<Progression, { label: string; tone: 'primary' | 'warning' | 'neutral' }>> = {
  increase_load: { label: 'Add weight', tone: 'primary' },
  increase_reps: { label: 'Add reps', tone: 'primary' },
  deload: { label: 'Lighter today', tone: 'warning' },
  hold_for_rom: { label: 'Full range first', tone: 'warning' },
  hold_for_form: { label: 'Form first', tone: 'warning' },
};

export default function Train() {
  const today = useTodayWorkout();
  const active = useActiveSession();
  const library = useExercises();
  const history = useWorkouts();
  const camera = useFeature('camera_verification');
  const poseSupport = livePoseSupport();
  // Verification needs both: this device can track, and the server's verification engine is live.
  const verifying = poseSupport.available && camera.available;
  const start = useStartSession();
  const [startError, setStartError] = useState<string | null>(null);
  const [tab, setTab] = useState<'today' | 'library' | 'history'>('today');
  const refetch = () => Promise.all([today.refetch(), active.refetch(), history.refetch()]);
  useRefetchOnFocus(refetch);

  const begin = () => {
    setStartError(null);
    start.mutate(
      { clientSessionId: uuid(), source: 'plan' },
      {
        onSuccess: () => router.push('/workout' as Href),
        onError: (e) => {
          // Already have one open (e.g. started on another device): resume it instead.
          if (e.code === 'session_open') {
            active.refetch().then(() => router.push('/workout' as Href));
          } else setStartError(e.kind === 'network' ? "Couldn't start — check your connection." : e.message);
        },
      },
    );
  };

  const plan = today.data?.plan;
  const openSession = active.data;

  return (
    <Screen title="Train" subtitle="Today's workout" refreshing={today.isRefetching} onRefresh={refetch}>
      <IconTabs
        label="Train sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'today', label: 'Today', icon: 'flash-outline' },
          { value: 'library', label: 'Library', icon: 'barbell-outline' },
          { value: 'history', label: 'History', icon: 'time-outline' },
        ]}
      />

      {tab === 'today' && openSession ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Resume workout in progress" onPress={() => router.push('/workout' as Href)}>
          <Card variant="raised" style={{ gap: space.sm, borderColor: colors.primary, borderWidth: 1 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Badge
                label={openSession.leftOpen ? 'Left open' : openSession.status === 'paused' ? 'Paused' : 'In progress'}
                tone={openSession.leftOpen || openSession.status === 'paused' ? 'warning' : 'primary'}
                icon="time-outline"
              />
              <Ionicons name="chevron-forward" size={20} color={colors.text} />
            </Row>
            <AppText variant="heading">{openSession.leftOpen ? 'Finish or discard your last workout' : 'Resume your workout'}</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {openSession.leftOpen
                ? `${setsLogged(sessionTotals(openSession).sets)} · time away doesn't count`
                : `${setsLogged(sessionTotals(openSession).sets)} · everything is saved`}
            </AppText>
          </Card>
        </Pressable>
      ) : null}

      {tab === 'today' && today.isPending ? <StateView kind="loading" /> : null}
      {tab === 'today' && today.isError && !today.data ? <ErrorState error={today.error} onRetry={today.refetch} /> : null}

      {tab === 'today' && plan ? (
        <View style={{ gap: space.md }}>
          <HeroMedia image={imagery.train} minHeight={200}>
            {plan.exercises[0] ? (
              <View style={styles.spotlight} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <ExerciseArt exerciseId={plan.exercises[0].exerciseId} decorative style={{ height: 130 }} />
              </View>
            ) : null}
            <AppText variant="overline" color={colors.primary}>
              Today&apos;s workout
            </AppText>
            <AppText variant="title" header style={{ fontSize: 32, lineHeight: 38 }}>
              {plan.title}
            </AppText>
            <StatStrip
              items={[
                { label: 'Time', value: `~${plan.estimatedMinutes}`, unit: 'min' },
                { label: 'Exercises', value: String(plan.exercises.length) },
                { label: 'Sets', value: String(plan.exercises.reduce((n, e) => n + e.sets, 0)) },
              ]}
            />
            <AppText variant="caption" color={colors.textMuted}>
              {plan.generator.id === 'adaptive' ? 'Adapted to your reps, form, range of motion and consistency.' : 'Built from your goal, equipment and recent sessions.'}
            </AppText>
            {plan.generator.id === 'adaptive' ? <Badge label="Adaptive · Pro" tone="primary" icon="trending-up" /> : null}
            {!openSession && plan.exercises.length > 0 ? (
              <Button
                label={today.data?.completedToday ? 'Train again' : 'Start workout'}
                iconRight={today.data?.completedToday ? undefined : 'arrow-forward'}
                variant={today.data?.completedToday ? 'secondary' : 'primary'}
                onPress={begin}
                loading={start.isPending}
              />
            ) : null}
          </HeroMedia>
          {startError ? <InlineMessage tone="danger">{startError}</InlineMessage> : null}
          {today.data?.completedToday ? (
            <InlineMessage tone="success" icon="checkmark-circle">
              Done for today. Refuel and recover — you can still train again if you planned to.
            </InlineMessage>
          ) : null}
          {plan.notes.map((n) => (
            <InlineMessage key={n} tone="warning">
              {n}
            </InlineMessage>
          ))}
          {plan.exercises.length > 0 ? (
            <Card style={{ paddingVertical: space.xs, paddingHorizontal: space.md }}>
              {plan.exercises.map((e, i) => (
                <View key={e.exerciseId}>
                  {i > 0 ? <Divider /> : null}
                  <PlanRow e={e} n={i + 1} />
                </View>
              ))}
            </Card>
          ) : null}
          {plan.exercises.length === 0 ? (
            <InlineMessage tone="info">No exercises match your equipment yet. Update your training setup in Profile.</InlineMessage>
          ) : null}
        </View>
      ) : null}

      {tab === 'today' ? (
      <Card variant="raised" style={{ gap: space.sm }}>
        <Row gap={space.sm}>
          <View style={[styles.camIcon, { backgroundColor: verifying ? colors.water : colors.track }]}>
            <Ionicons name="videocam" size={16} color={verifying ? colors.onPrimary : colors.textMuted} />
          </View>
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            Coaching with your camera
          </AppText>
          <Badge label={verifying ? 'Ready' : 'Not available'} tone={verifying ? 'primary' : 'neutral'} />
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          {verifying
            ? 'For squats, push-ups, lunges and curls, FORM counts every full-range rep and tells you how your form looks. It all happens on this device — nothing is recorded.'
            : poseSupport.available
              ? "Camera coaching isn't available right now. You can still log every set yourself."
              : poseSupport.message}
        </AppText>
        <AppText variant="caption" color={colors.textFaint}>
          Reps the camera counts earn full XP. Reps you enter yourself earn a little less.
        </AppText>
      </Card>
      ) : null}

      {tab === 'library' ? (
        library.data ? (
          <ExerciseLibrary exercises={library.data.exercises} onOpen={(id) => router.push(`/train/exercise/${id}` as Href)} />
        ) : library.isError ? (
          <ErrorState error={library.error} onRetry={library.refetch} />
        ) : (
          <StateView kind="loading" />
        )
      ) : null}

      {tab === 'history' && history.data ? <HistorySummary workouts={history.data.workouts} /> : null}
      {tab === 'history' ? (
      <Card style={{ paddingVertical: space.xs }}>
        {!history.data ? (
          history.isError ? <ErrorState error={history.error} onRetry={history.refetch} compact /> : <StateView kind="loading" compact />
        ) : history.data.workouts.length === 0 ? (
          <StateView kind="empty" compact title="No workouts yet" message="Your finished workouts appear here." />
        ) : (
          history.data.workouts.map((w, i) => (
            <View key={w.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                title={new Date(`${w.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                subtitle={`${w.durationMinutes} min`}
                onPress={() => router.push(`/train/history/${w.id}` as Href)}
                right={
                  <AppText variant="bodyStrong" color={w.xp > 0 ? colors.primary : colors.textFaint}>
                    +{w.xp} XP
                  </AppText>
                }
              />
            </View>
          ))
        )}
      </Card>
      ) : null}
    </Screen>
  );
}

function PlanRow({ e, n }: { e: PlannedExercise; n: number }) {
  const badge = PROGRESSION_BADGE[e.progression];
  const reps = e.targetReps.min === e.targetReps.max ? `${e.targetReps.min}` : `${e.targetReps.min}–${e.targetReps.max}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.name}: ${e.sets} sets of ${reps} reps${e.targetLoadKg ? ` at ${e.targetLoadKg} kilograms` : ''}`}
      onPress={() => router.push(`/train/exercise/${e.exerciseId}` as Href)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2, minHeight: 64, borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 })}>
      <View>
        <ExerciseThumb exerciseId={e.exerciseId} />
        <View style={styles.stepNo}>
          <AppText variant="label" color={colors.onPrimary} style={{ fontSize: 11, lineHeight: 14 }}>
            {n}
          </AppText>
        </View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {e.name}
        </AppText>
        {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
      </Row>
      <Row gap={space.md} style={{ flexWrap: 'wrap' }}>
        <AppText variant="label" color={colors.text} style={{ fontVariant: ['tabular-nums'] }}>
          {e.sets} {e.sets === 1 ? 'set' : 'sets'} · {reps} reps{e.targetLoadKg ? ` · ${e.targetLoadKg} kg` : ''}
        </AppText>
        <Row gap={4}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <AppText variant="label" color={colors.textMuted}>
            {formatRest(e.restSeconds)} rest
          </AppText>
        </Row>
      </Row>
      {e.note ? (
        <AppText variant="caption" color={colors.textFaint}>
          {e.note}
        </AppText>
      ) : null}
      </View>
    </Pressable>
  );
}

/** This week at a glance: the days you trained, then totals across your recent workouts. */
function HistorySummary({ workouts }: { workouts: { localDate: string; durationMinutes: number; xp: number }[] }) {
  const week = trainingWeek(
    workouts.map((w) => w.localDate),
    localDateKey(),
  );
  const minutes = workouts.reduce((n, w) => n + w.durationMinutes, 0);
  const xp = workouts.reduce((n, w) => n + w.xp, 0);
  return (
    <Card style={{ gap: space.lg }}>
      <AppText variant="overline" color={colors.primary}>
        This week
      </AppText>
      <WeekDays trained={week.trained} todayIndex={week.todayIndex} />
      <StatStrip
        items={[
          { label: 'Workouts', value: String(workouts.length) },
          { label: 'Minutes', value: minutes.toLocaleString() },
          { label: 'XP', value: xp.toLocaleString(), tint: colors.accent },
        ]}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  spotlight: { alignSelf: 'center', alignItems: 'center', justifyContent: 'flex-end', width: 220, height: 136, marginBottom: -space.sm },
  stepNo: { position: 'absolute', top: -6, left: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },
  camIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});

const setsLogged = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'} logged`;
