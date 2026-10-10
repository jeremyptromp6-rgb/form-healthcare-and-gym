import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { ErrorState, Screen, SectionHeader, StateView } from '@/components/ui';
import { ExerciseDetailView } from '@/components/train/ExerciseDetailView';
import { livePoseSupport } from '@/lib/pose/support';
import { FormIntelligenceView } from '@/components/pro/ProFeatureViews';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import { proFeatureOf, useFormIntelligence } from '@/lib/pro';
import { useExerciseDetail, useMe } from '@/lib/queries';

/** Exercise detail: how to do it (About), your history with it, and your progress. */
export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useExerciseDetail(id);
  const poseSupport = livePoseSupport();

  if (q.isError && !q.data) {
    return (
      <Screen title="Exercise">
        {q.error.kind === 'not_found' ? <StateView kind="empty" title="Exercise not found" /> : <ErrorState error={q.error} onRetry={q.refetch} />}
      </Screen>
    );
  }
  if (!q.data) return <Screen title="Exercise"><StateView kind="loading" /></Screen>;
  const e = q.data.exercise;

  return (
    <Screen title={e.name} subtitle={e.pattern.replace(/_/g, ' ')}>
      <Stack.Screen options={{ title: e.name }} />
      <ExerciseDetailView
        detail={q.data}
        poseAvailable={poseSupport.available}
        onPractise={(exerciseId) => router.push(`/camera?exerciseId=${exerciseId}` as Href)}
        formHistory={e.cameraVerifiable ? <FormHistory exerciseId={e.id} /> : undefined}
      />
    </Screen>
  );
}

/** FORM Pro: form and range-of-motion history. The server decides access; a 402 shows the upsell instead. */
function FormHistory({ exerciseId }: { exerciseId: string }) {
  const q = useFormIntelligence(exerciseId, 90, true);
  const me = useMe();
  const locked = proFeatureOf(q.error);
  return (
    <>
      <SectionHeader title="Form history" />
      {locked ? <ProUpsellFor feature={locked} /> : null}
      {q.isPending ? <StateView kind="loading" compact /> : null}
      {q.isError && !locked ? <ErrorState error={q.error} onRetry={q.refetch} compact /> : null}
      {q.data ? <FormIntelligenceView data={q.data.intelligence} units={me.data?.settings.units ?? 'metric'} /> : null}
    </>
  );
}
