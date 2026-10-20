import { useCallback, useEffect, useState } from 'react';
import { listProgressPhotos, subscribeProgressPhotos, type ProgressPhoto } from './progressPhotos';

/** The stored progress photos (oldest first), kept in step with adds and deletes anywhere in the app. `photos` is null until read. */
export function useProgressPhotos(): { photos: ProgressPhoto[] | null; failed: boolean; reload: () => void } {
  const [photos, setPhotos] = useState<ProgressPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const read = () =>
      void listProgressPhotos().then(
        (p) => {
          if (!alive) return;
          setPhotos(p);
          setFailed(false);
        },
        () => alive && setFailed(true),
      );
    read();
    const unsubscribe = subscribeProgressPhotos(read);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { photos, failed, reload };
}
