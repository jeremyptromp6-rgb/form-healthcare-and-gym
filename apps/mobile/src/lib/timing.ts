import { useEffect, useState } from 'react';

/** The value, once it has stopped changing for `delayMs` (the first value is returned straight away). */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** True once `active` has stayed true for `delayMs`; goes back to false as soon as it isn't. */
export function useAfterDelay(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(t);
      setElapsed(false);
    };
  }, [active, delayMs]);
  return active && elapsed;
}
