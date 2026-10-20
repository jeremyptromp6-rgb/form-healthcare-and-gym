import { CompareView } from '@/components/progress/bodyProgress/CompareView';
import { Screen, StateView } from '@/components/ui';
import { useUnits } from '@/lib/units';
import { useProgressPhotos } from '@/lib/useProgressPhotos';

/** Compare two progress photos of the same pose with a before/after slider or side by side. */
export default function BodyProgressCompareScreen() {
  const units = useUnits();
  const { photos } = useProgressPhotos();
  return (
    <Screen title="Compare" subtitle="Body progress">
      {!photos ? <StateView kind="loading" compact /> : <CompareView photos={photos} units={units} />}
    </Screen>
  );
}
