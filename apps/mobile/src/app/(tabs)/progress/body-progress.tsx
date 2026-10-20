import { router, type Href } from 'expo-router';
import { BodyProgressView } from '@/components/progress/bodyProgress/BodyProgressView';
import { Screen, StateView } from '@/components/ui';
import { deleteAllProgressPhotos, deleteProgressPhoto, progressPhotosSupported } from '@/lib/progressPhotos';
import { useUnits } from '@/lib/units';
import { useProgressPhotos } from '@/lib/useProgressPhotos';

/** Body progress: photos kept on this phone only, a month-by-month timeline, and before/after comparison. */
export default function BodyProgressScreen() {
  const units = useUnits();
  const { photos, failed, reload } = useProgressPhotos();
  return (
    <Screen title="Body progress" subtitle="Private to this phone">
      {!progressPhotosSupported() ? (
        <StateView kind="unavailable" title="Progress photos are for the phone app" message="They are kept privately on your phone, so there is nothing to see here on the web." />
      ) : failed && !photos ? (
        <StateView kind="error" compact title="Couldn't read your photos" message="They are stored on this phone only, and the list could not be opened." actionLabel="Try again" onAction={reload} />
      ) : !photos ? (
        <StateView kind="loading" compact />
      ) : (
        <BodyProgressView
          photos={photos}
          units={units}
          onCapture={() => router.push('/progress/body-progress-capture' as Href)}
          onCompare={() => router.push('/progress/body-progress-compare' as Href)}
          onDeleteOne={deleteProgressPhoto}
          onDeleteAll={deleteAllProgressPhotos}
        />
      )}
    </Screen>
  );
}
