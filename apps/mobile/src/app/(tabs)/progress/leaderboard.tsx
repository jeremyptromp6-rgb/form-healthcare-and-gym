import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { LeaderboardView, type LeaderboardState } from '@/components/leaderboard/LeaderboardView';
import { Screen } from '@/components/ui';
import { useLeaderboard, useRefetchOnFocus } from '@/lib/queries';
import type { LeaderboardPeriod } from '@/lib/types';

/** Leaderboards: top 50 by XP earned today, this week or all time, plus your own place. Names are opt-in. */
export default function LeaderboardScreen() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const q = useLeaderboard(period);
  useRefetchOnFocus(q.refetch);

  // An older server has no such route (404): say so kindly instead of showing an error.
  const state: LeaderboardState = q.data
    ? { kind: 'ok', board: q.data }
    : q.error?.kind === 'not_found'
      ? { kind: 'unsupported' }
      : q.isError
        ? { kind: 'error', onRetry: () => void q.refetch() }
        : { kind: 'loading' };

  return (
    <Screen title="Leaderboards" subtitle="Who earned the most XP" refreshing={q.isRefetching} onRefresh={q.refetch}>
      <LeaderboardView period={period} onPeriodChange={setPeriod} state={state} onOpenSettings={() => router.push('/profile/settings' as Href)} />
    </Screen>
  );
}
