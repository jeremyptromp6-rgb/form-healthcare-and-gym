import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { localDateKey } from '@/lib/dates';

/** How often an open screen checks whether the calendar day has turned over. */
const CHECK_MS = 30_000;

/**
 * Today's date key, kept current: a screen left open across midnight (or a phone that slept through
 * it) moves to the new day instead of showing yesterday as "today".
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDateKey());
  useEffect(() => {
    const check = () => setToday(localDateKey());
    const id = setInterval(check, CHECK_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    check();
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return today;
}
