import { NO_SCALE_PROVIDER, SCALE_IDLE, scaleReducer, type ScaleProvider } from '@form/domain';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { config } from './config';

/**
 * Kitchen scales. No Bluetooth or smart-scale integration exists yet, so the real provider is
 * NO_SCALE_PROVIDER: it says so, and the weight is typed in from any scale. For development only,
 * EXPO_PUBLIC_SIMULATED_SCALE=1 enables a simulated scale — clearly labelled, never real readings —
 * so the connect → read → stable flow can be exercised.
 */

export function simulatedScale(
  opts: {
    targetGrams?: () => number;
    intervalMs?: number;
    connectMs?: number;
  } = {},
): ScaleProvider {
  return {
    kind: 'scale',
    name: 'Simulated scale (development)',
    development: true,
    supported: true,
    connect(onEvent) {
      let sampler: ReturnType<typeof setInterval> | undefined;
      onEvent({ type: 'connect' });
      const connecting = setTimeout(() => {
        onEvent({ type: 'connected', device: 'Simulated scale' });
        const target = opts.targetGrams?.() ?? 120 + Math.round(Math.random() * 1200) / 10;
        let i = 0;
        // Food "lands" over ~2 s with a shrinking wobble, then holds steady like a real scale.
        sampler = setInterval(() => {
          i += 1;
          const settle = Math.min(1, i / 8);
          const wobble = i < 12 ? (Math.random() - 0.5) * 16 * (1 - settle) : 0;
          onEvent({
            type: 'sample',
            grams: Math.round((target * settle + wobble) * 10) / 10,
            atMs: Date.now(),
          });
        }, opts.intervalMs ?? 250);
      }, opts.connectMs ?? 600);
      return () => {
        clearTimeout(connecting);
        if (sampler) clearInterval(sampler);
      };
    },
  };
}

export function defaultScaleProvider(): ScaleProvider {
  return config.simulatedScale ? simulatedScale() : NO_SCALE_PROVIDER;
}

/** The scale's state (domain `scaleReducer`) plus connect/disconnect; disconnects on unmount. */
export function useScale(provider: ScaleProvider) {
  const [state, dispatch] = useReducer(scaleReducer, SCALE_IDLE);
  const stop = useRef<(() => void) | null>(null);
  const connect = useCallback(() => {
    stop.current?.();
    stop.current = provider.connect(dispatch);
  }, [provider]);
  const disconnect = useCallback(() => {
    stop.current?.();
    stop.current = null;
    dispatch({ type: 'reset' });
  }, []);
  useEffect(() => () => stop.current?.(), []);
  return { state, connect, disconnect };
}
