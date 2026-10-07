/** Light, dark, or follow the device. Read once at launch: the palette is fixed for the session. */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'form.theme';

export function readThemePreference(): ThemePreference {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePreference(p: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(KEY, p);
  } catch {
    // Not saved (private mode, blocked storage): the app keeps following the device.
  }
}

/** On the web a reload is instant, so the new look applies straight away. */
export const appliesImmediately = true;

export function applyThemeNow(): void {
  globalThis.location?.reload();
}
