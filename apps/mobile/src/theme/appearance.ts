import * as SecureStore from 'expo-secure-store';

/** Light, dark, or follow the device. Read once at launch: the palette is fixed for the session. */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'form.theme';

export function readThemePreference(): ThemePreference {
  try {
    const v = SecureStore.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePreference(p: ThemePreference): void {
  try {
    SecureStore.setItem(KEY, p);
  } catch {
    // Not saved: the app keeps following the device, which is a fine fallback.
  }
}

/** Native can't swap the palette mid-session; the new look applies the next time FORM opens. */
export const appliesImmediately = false;

export function applyThemeNow(): void {}
