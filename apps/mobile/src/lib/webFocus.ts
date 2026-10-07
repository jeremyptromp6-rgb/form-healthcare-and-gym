import { Platform } from 'react-native';
import { colors } from '@/theme/tokens';

/**
 * Web only: React Native Web removes the browser's focus outline, so keyboard users can't see
 * where they are. A visible ring for keyboard focus (`:focus-visible`), none for mouse or touch.
 */
export function installFocusRing(): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || document.getElementById('form-focus-ring')) return;
  const style = document.createElement('style');
  style.id = 'form-focus-ring';
  style.textContent = `[tabindex]:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid ${colors.primary} !important;
  outline-offset: 2px;
}`;
  document.head.appendChild(style);
}
