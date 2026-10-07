import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useId } from 'react';
import { AppState } from 'react-native';

/**
 * Keeps the screen awake while the calling screen is mounted — without the rough edges of
 * expo-keep-awake's hook on web:
 * - a refused wake lock (page hidden, browser policy) never surfaces as an uncaught error;
 * - leaving before the lock is granted releases it once granted, instead of leaking it;
 * - browsers drop wake locks when the tab is hidden, so it's re-acquired when the app is active again.
 * Keeping the screen awake is a convenience: every failure here is silent by design.
 */
export function useScreenAwake(): void {
  const tag = `form-awake-${useId()}`;

  useEffect(() => {
    let mounted = true;
    let held = false;

    const acquire = () => {
      if (held) return;
      activateKeepAwakeAsync(tag)
        .then(() => {
          held = true;
          if (!mounted) release();
        })
        .catch(() => {});
    };
    const release = () => {
      if (!held) return;
      held = false;
      deactivateKeepAwake(tag).catch(() => {});
    };

    acquire();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // The browser may have released the lock while hidden; ask again.
        held = false;
        acquire();
      }
    });
    return () => {
      mounted = false;
      sub.remove();
      release();
    };
  }, [tag]);
}
