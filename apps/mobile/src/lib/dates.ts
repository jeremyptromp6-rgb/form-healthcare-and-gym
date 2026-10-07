let userZone: string | null = null;

/**
 * The time zone the server uses for this user's days. Set from /me and settings; cleared on
 * sign-out. When the user picked a zone by hand (or the device has moved since), the app follows
 * the server's zone, so "today" in the app is always the server's today.
 */
export function setUserTimeZone(tz: string | null | undefined): void {
  userZone = tz ?? null;
}

/** The user's local calendar date as YYYY-MM-DD — the key the API uses for days. */
export function localDateKey(d: Date = new Date()): string {
  if (userZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat('en-CA', { timeZone: userZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch {
      // An unknown zone on this device: fall back to the device's calendar.
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  return h < 5 ? 'Late session' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** RFC 4122 v4 id used as a workout idempotency key. */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
