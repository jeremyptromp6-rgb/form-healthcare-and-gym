import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { useAuth } from './auth';
import { qk, useStepsHistory } from './queries';
import { createStepsSyncer, DEFAULT_STEP_GOAL, hasStepsPermission, openStepsInstall, openStepsSettings, readRecentSteps, requestStepsPermission, stepsAvailability } from './steps';

/**
 * Where the Steps card stands:
 * - `checking`: not known yet (nothing is shown).
 * - `unavailable`: iOS, web or a device without Health Connect (the card is hidden).
 * - `needs_install`: Android 13 or older without the Health Connect app (link to Google Play).
 * - `needs_permission`: installed, not connected yet (a "Connect steps" button).
 * - `denied`: the user said no; Health Connect's settings can turn it back on.
 * - `ready`: connected; today's total is shown.
 */
export type StepsStatus = 'checking' | 'unavailable' | 'needs_install' | 'needs_permission' | 'denied' | 'ready';

export interface StepsCardState {
  status: StepsStatus;
  /** Today's total from Health Connect (null until read, or if it couldn't be). */
  today: number | null;
  goal: number;
  /** XP today's steps are worth: 1 per full 1,000, up to 10 (the server decides the real award). */
  xpToday: number;
  /** Average over the days of the last week that have steps, from what the server holds. */
  weekAverage: number | null;
  busy: boolean;
  onConnect: () => void;
  onInstall: () => void;
  onOpenSettings: () => void;
}

const xpFor = (steps: number) => Math.min(10, Math.floor(steps / 1000));

/**
 * Reads today's steps from Health Connect, and (fire and forget) sends today's and yesterday's totals to the
 * server whenever Home comes into focus or the app returns to the foreground. Permission is only ever
 * requested from `onConnect`, a button press.
 */
export function useSteps(): StepsCardState {
  const { authed } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<StepsStatus>('checking');
  const [today, setToday] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const xpSeen = useRef(new Map<string, number>());
  const running = useRef(false);
  const [syncer] = useState(() => createStepsSyncer());
  useEffect(() => {
    syncer.setSend(async (day) => {
      const res = await authed((t) => api.postSteps(t, day));
      qc.invalidateQueries({ queryKey: qk.steps });
      // Steps XP changes the level bar: refresh those only when the server actually paid more.
      if (res.xp > (xpSeen.current.get(day.localDate) ?? 0)) {
        qc.invalidateQueries({ queryKey: ['home'] });
        qc.invalidateQueries({ queryKey: ['progress'] });
        qc.invalidateQueries({ queryKey: qk.xpEvents });
      }
      xpSeen.current.set(day.localDate, res.xp);
    });
  }, [syncer, authed, qc]);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const availability = await stepsAvailability();
      if (availability !== 'available') {
        setStatus(availability === 'needs_install' ? 'needs_install' : 'unavailable');
        return;
      }
      if (!(await hasStepsPermission())) {
        setStatus((s) => (s === 'denied' ? 'denied' : 'needs_permission'));
        return;
      }
      const { today: t, yesterday: y } = await readRecentSteps();
      if (t) setToday(t.steps);
      setStatus('ready');
      const days = [y, t].filter((d): d is NonNullable<typeof d> => d !== null);
      if (days.length) syncer.schedule(days);
    } finally {
      running.current = false;
    }
  }, [syncer]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const onConnect = useCallback(() => {
    setBusy(true);
    void requestStepsPermission()
      .then(async (granted) => {
        if (granted) await refresh();
        else setStatus('denied');
      })
      .finally(() => setBusy(false));
  }, [refresh]);

  const history = useStepsHistory(status === 'ready');
  const logged = (history.data?.days ?? []).filter((d) => d.steps > 0);
  const weekAverage = logged.length ? Math.round(logged.reduce((n, d) => n + d.steps, 0) / logged.length) : null;

  return {
    status,
    today,
    goal: history.data?.goal ?? DEFAULT_STEP_GOAL,
    xpToday: xpFor(today ?? 0),
    weekAverage,
    busy,
    onConnect,
    onInstall: openStepsInstall,
    onOpenSettings: openStepsSettings,
  };
}
