import { ProFeatureGate } from '@/components/pro/ProFeatureGate';
import { BodyQuestInsightsView } from '@/components/pro/ProFeatureViews';
import { BodyQuestView } from '@/components/recognition/BodyQuestView';
import { ErrorState, Screen, SectionHeader, StateView } from '@/components/ui';
import { useBodyQuest, useRefetchOnFocus } from '@/lib/queries';

export default function BodyQuestScreen() {
  const q = useBodyQuest();
  useRefetchOnFocus(q.refetch);
  return (
    <Screen title="Body Quest" subtitle="Your long game" refreshing={q.isRefetching} onRefresh={q.refetch}>
      {q.isPending ? <StateView kind="loading" /> : null}
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={q.refetch} /> : null}
      {q.data ? <BodyQuestView bodyQuest={q.data.bodyQuest} /> : null}
      {q.data ? (
        <>
          <SectionHeader title="Insights" />
          <ProFeatureGate feature="ADVANCED_BODY_QUEST" locked={q.data.insightsLocked}>
            {q.data.insights ? <BodyQuestInsightsView insights={q.data.insights} /> : null}
          </ProFeatureGate>
        </>
      ) : null}
    </Screen>
  );
}
