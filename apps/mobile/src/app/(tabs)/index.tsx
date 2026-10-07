import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { AdSlot } from '@/components/AdSlot';
import { HomeView, type HomeRoute } from '@/components/home/HomeView';
import { ErrorState, Screen, StateView } from '@/components/ui';
import { uuid } from '@/lib/dates';
import { useAddWater, useCoachInsight, useHome, useRefetchOnFocus, useUndoWater } from '@/lib/queries';

const ROUTES: Record<HomeRoute, '/train' | '/eat' | '/progress' | '/profile'> = {
  train: '/train',
  eat: '/eat',
  progress: '/progress',
  profile: '/profile',
};

/** Home container: fetches the view model, wires actions and navigation. Rendering lives in HomeView. */
export default function Home() {
  const home = useHome();
  const addWater = useAddWater();
  const undoWater = useUndoWater();
  const [waterError, setWaterError] = useState<string | null>(null);
  const coach = useCoachInsight('home', !!home.data && home.data.coach.mode !== 'unavailable');
  useRefetchOnFocus(home.refetch);

  if (!home.data) {
    return (
      <Screen title="Home" subtitle="FORM">
        {home.isError ? <ErrorState error={home.error} onRetry={home.refetch} /> : <StateView kind="loading" />}
      </Screen>
    );
  }

  return (
    <HomeView
        vm={home.data}
        onNavigate={(r) => router.navigate(ROUTES[r])}
        onAddWater={(ml) => {
          setWaterError(null);
          // A fresh id per tap: retries of this request dedupe on the server, separate taps don't.
          addWater.mutate({ ml, clientLogId: uuid() }, { onError: (e) => setWaterError(e.kind === 'network' ? "Couldn't log water. Check your connection." : e.message) });
        }}
        onUndoWater={(id) => undoWater.mutate(id, { onError: () => setWaterError("Couldn't undo. Try again.") })}
        waterBusy={addWater.isPending || undoWater.isPending}
        waterError={waterError}
        refreshing={home.isRefetching}
        onRefresh={home.refetch}
        refreshFailed={home.isError}
        footer={<AdSlot placement="home_feed" />}
        coach={{ response: coach.data?.insight ?? null, loading: coach.isPending && coach.fetchStatus !== 'idle', failed: coach.isError }}
        onOpenCoach={() => router.push('/coach' as Href)}
        onOpenRoute={(route) => router.push(route as Href)}
      />
  );
}
