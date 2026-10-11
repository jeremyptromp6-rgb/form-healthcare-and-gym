import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';

/**
 * The state at mount: anything but a known background or inactive state counts as active, because
 * `currentState` can be undefined (jest's AppState mock leaves it unset, and a function).
 */
const isActiveNow = (state: unknown) => state !== 'background' && state !== 'inactive';

/** True while the app is in the foreground. Subscribes once and unsubscribes on unmount. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => isActiveNow(AppState.currentState));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * Whether a decorative animation loop should run: enabled, motion allowed and the app in the
 * foreground. Use it as the single gate:
 *
 *   useEffect(() => { if (!run) return; const loop = Animated.loop(...); loop.start(); return () => loop.stop(); }, [run]);
 *
 * Budget: at most 3 loops per screen, and at most 1 animation driven by setState per screen.
 */
export function useActiveLoop(enabled = true): boolean {
  const reduce = useReducedMotion();
  const active = useAppActive();
  return enabled !== false && !reduce && active;
}
