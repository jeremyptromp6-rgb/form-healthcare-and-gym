import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Badge, IconTabs, StatStrip, WeekDays, Card, Divider, ErrorState, ListRow, Row, Screen, StateView } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { trainingWeek } from '@/lib/week';
import { ExerciseLibrary } from '@/components/train/ExerciseLibrary';
import { CameraCoachingRow, TodayView } from '@/components/train/TodayView';
import { useFeature } from '@/lib/features';
import { livePoseSupport } from '@/lib/pose/support';
import { useActiveSession, useExercises, useRefetchOnFocus, useStartSession, useTodayWorkout, useWorkouts } from '@/lib/queries';
import { sessionTotals } from '@/lib/workoutSession';
import { colors, space } from '@/theme/tokens';

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

  const cameraMessage = verifying
    ? 'Counts every full-range rep and checks your form on this device. Nothing is recorded.'
    : poseSupport.available
      ? "Camera coaching isn't available right now. You can still log every set yourself."
      : poseSupport.message;

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

      {/* Without a plan (loading or error) TodayView isn't shown, so the camera row stands alone. */}
      {tab === 'today' && !plan ? <CameraCoachingRow camera={{ verifying, message: cameraMessage }} /> : null}

      {tab === 'today' && plan ? (
        <TodayView
          plan={plan}
          completedToday={Boolean(today.data?.completedToday)}
          canStart={!openSession}
          starting={start.isPending}
          startError={startError}
          onStart={begin}
          onOpenExercise={(id) => router.push(`/train/exercise/${id}` as Href)}
          camera={{ verifying, message: cameraMessage }}
        />
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

const setsLogged = (n: number) => `${n} ${n === 1 ? 'set' : 'sets'} logged`;
