import { router } from 'expo-router';
import { CaptureView } from '@/components/progress/bodyProgress/CaptureView';
import { Screen } from '@/components/ui';
import { localDateKey } from '@/lib/dates';
import { weightOnOrBefore } from '@/lib/progressPhotos';
import { useWeightHistory } from '@/lib/queries';
import { useProgressPhotos } from '@/lib/useProgressPhotos';

/** Take a progress photo, with the last one of the same pose as a ghost guide. Saved on this phone only. */
export default function BodyProgressCaptureScreen() {
  const { photos } = useProgressPhotos();
  const weights = useWeightHistory();
  const date = localDateKey();
  return (
    <Screen title="New photo" subtitle="Body progress">
      {photos ? <CaptureView photos={photos} date={date} weightKg={weightOnOrBefore(weights.data?.entries ?? [], date)} onDone={() => router.back()} /> : null}
    </Screen>
  );
}
