import { YourRankView, type StandingState } from '@/components/progress/YourRankView';
import { router, type Href } from 'expo-router';
import { ErrorState, Screen, StateView } from '@/components/ui';
import { localDateKey } from '@/lib/dates';
import { useProgress, useRefetchOnFocus, useStanding, useXpHistory } from '@/lib/queries';

/** Your Rank: FORM's rank badge, an anonymous "Top X%" among FORM users, and your XP over time. */
export default function RankScreen() {
  const today = localDateKey();
  const progress = useProgress(today);
  const standing = useStanding();
  const history = useXpHistory();
  const refetch = () => Promise.all([progress.refetch(), standing.refetch(), history.refetch()]);
  useRefetchOnFocus(refetch);

  // An older server has no such route (404): say so kindly instead of showing an error.
  const standingState: StandingState = standing.data
    ? { kind: 'ok', standing: standing.data }
    : standing.error?.kind === 'not_found'
      ? { kind: 'unsupported' }
      : standing.isError
        ? { kind: 'error', onRetry: () => void standing.refetch() }
        : { kind: 'loading' };

  return (
    <Screen title="Your rank" subtitle="Where you stand" refreshing={progress.isRefetching} onRefresh={refetch}>
      {progress.isPending ? <StateView kind="loading" /> : null}
      {progress.isError && !progress.data ? <ErrorState error={progress.error} onRetry={progress.refetch} /> : null}
      {progress.data ? (
        <YourRankView
          progress={progress.data}
          standing={standingState}
          events={history.data?.events ?? []}
          eventsState={history.data ? 'ok' : history.isError ? 'error' : 'loading'}
          today={today}
          onOpenLeaderboard={() => router.push('/progress/leaderboard' as Href)}
        />
      ) : null}
    </Screen>
  );
}
