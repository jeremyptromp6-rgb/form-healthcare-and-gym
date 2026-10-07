import { useLocalSearchParams } from 'expo-router';
import { WorkoutSummaryView } from '@/components/train/WorkoutSummaryView';
import { ErrorState, Screen, StateView } from '@/components/ui';
import { useWorkoutDetail } from '@/lib/queries';

/** A past workout: every set with target, recorded and verified reps, load and ROM. */
export default function WorkoutHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useWorkoutDetail(id);
  return (
    <Screen title="Workout" subtitle="History">
      {q.data ? <WorkoutSummaryView summary={q.data} title="Workout" /> : null}
      {q.isPending ? <StateView kind="loading" /> : null}
      {q.isError && !q.data ? (q.error.kind === 'not_found' ? <StateView kind="empty" title="Workout not found" /> : <ErrorState error={q.error} onRetry={q.refetch} />) : null}
    </Screen>
  );
}
