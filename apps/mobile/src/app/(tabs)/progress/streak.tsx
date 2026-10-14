import { StreakSeasonView } from '@/components/streak/StreakViews';
import { AppText, ErrorState, Screen, StateView } from '@/components/ui';
import { useRefetchOnFocus, useStreaks, useWorkouts } from '@/lib/queries';
import { colors } from '@/theme/tokens';

export default function StreakScreen() {
  const streaks = useStreaks();
  const workouts = useWorkouts();
  const refetch = () => Promise.all([streaks.refetch(), workouts.refetch()]);
  useRefetchOnFocus(refetch);
  return (
    <Screen title="Streak & Season" subtitle="Rest is part of training" refreshing={streaks.isRefetching || workouts.isRefetching} onRefresh={refetch}>
      {streaks.isPending ? <StateView kind="loading" /> : null}
      {streaks.isError && !streaks.data ? <ErrorState error={streaks.error} onRetry={streaks.refetch} /> : null}
      {streaks.data ? (
        <>
          <StreakSeasonView streaks={streaks.data.streaks} today={streaks.data.today} workouts={workouts.data?.workouts ?? []} />
          {workouts.isError && !workouts.data ? <ErrorState error={workouts.error} onRetry={workouts.refetch} compact /> : null}
          <AppText variant="caption" color={colors.textFaint}>
            Days count from your recent workouts. Sessions with serious pain never count, and the rest days in your plan keep a streak alive.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}
