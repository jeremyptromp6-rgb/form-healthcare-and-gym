import { MuscleRanksView } from '@/components/progress/MuscleRanksView';
import { ErrorState, Screen, StateView } from '@/components/ui';
import { useMuscleRanks, useRefetchOnFocus } from '@/lib/queries';

/** Muscle ranks: which muscles are strong and which to improve, from the last 28 days of verified sets. */
export default function MuscleRanksScreen() {
  const q = useMuscleRanks();
  useRefetchOnFocus(q.refetch);
  // An older server has no such route (404): say so kindly instead of showing an error.
  const unsupported = q.error?.kind === 'not_found';
  return (
    <Screen title="Muscle ranks" subtitle="Which muscles to improve" refreshing={q.isRefetching} onRefresh={q.refetch}>
      {q.isPending ? <StateView kind="loading" /> : null}
      {unsupported ? <StateView kind="empty" title="Muscle ranks are not ready yet" message="FORM is updating. Check back soon and your muscle ranks will be here." actionLabel="Try again" onAction={q.refetch} /> : null}
      {q.isError && !q.data && !unsupported ? <ErrorState error={q.error} onRetry={q.refetch} /> : null}
      {q.data ? <MuscleRanksView data={q.data} /> : null}
    </Screen>
  );
}
