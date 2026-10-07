import { useEffect, useRef } from 'react';
import { useMe, useUpdateSettings } from './queries';

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Keeps the server's copy of the user's time zone in step with the device (first run and
 * travel). The server then decides "today" from it — the client never picks a date.
 */
export function useTimeZoneSync(): void {
  const me = useMe();
  const update = useUpdateSettings();
  const attempted = useRef<string | null>(null);
  const stored = me.data?.settings.timezone;
  const auto = me.data?.settings.timezoneAuto ?? true;
  const device = deviceTimeZone();

  useEffect(() => {
    // A time zone the user chose by hand stays put, even when the device's changes.
    if (!me.data || !auto || !device || stored === device || attempted.current === device) return;
    attempted.current = device;
    update.mutate({ timezone: device });
  }, [me.data, auto, device, stored, update]);
}
