import { useState } from 'react';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import { Button, ErrorState, Screen, StateView } from '@/components/ui';
import { openPaywall, proFeatureOf } from '@/lib/pro';
import { useProgressAnalytics, useRefetchOnFocus } from '@/lib/queries';
import type { AnalyticsRange } from '@/lib/types';

/** Trends over 7, 30 or 90 days, from the user's own records. 90 days is FORM Pro (the server decides). */
export default function AnalyticsScreen() {
  const [range, setRange] = useState<AnalyticsRange>(30);
  const [exercise, setExercise] = useState<string | null>(null);
  const q = useProgressAnalytics(range, exercise);
  useRefetchOnFocus(q.refetch);
  const locked = proFeatureOf(q.error);
  return (
    <Screen title="Trends" subtitle="Your progress over time" refreshing={q.isRefetching && !q.isPlaceholderData} onRefresh={q.refetch}>
      {q.isPending ? <StateView kind="loading" /> : null}
      {locked ? (
        <>
          <ProUpsellFor feature={locked} />
          <Button label="Show the last 30 days" variant="ghost" onPress={() => setRange(30)} />
        </>
      ) : null}
      {q.isError && !q.data && !locked ? <ErrorState error={q.error} onRetry={q.refetch} /> : null}
      {q.data ? <AnalyticsView analytics={q.data.analytics} range={range} onRange={setRange} exercise={exercise} onExercise={setExercise} updating={q.isPlaceholderData} onPro={openPaywall} /> : null}
    </Screen>
  );
}
