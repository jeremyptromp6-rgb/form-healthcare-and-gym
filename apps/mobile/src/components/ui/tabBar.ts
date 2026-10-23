import { createContext } from 'react';

/**
 * The phone tab bar is docked (laid out below the screens, never floating over them), so tab
 * screens need no extra room for it. Screens outside the tabs still clear the system navigation
 * bar themselves. `InTabsContext` tells the shared Screen which case it's in.
 *
 * Why nothing can hide behind it: expo-router's bundled bottom-tabs lays the bar out in a column
 * under the screens container (it only goes `position: absolute` while hidden), and every tab
 * screen, stack children included, lives inside that container. So the content area already ends
 * where the bar starts. The bar must therefore keep an explicit height that includes the system
 * inset (`tabBarHeight`), and hide while the keyboard is open so it never eats the form above it.
 */
export const TAB_BAR = {
  /** Height of the bar's content, above the system navigation area. */
  height: 62,
  /** Breathing room under the labels when the system bar takes no space. */
  minBottomPadding: 8,
} as const;

export const InTabsContext = createContext(false);

/** Total height of the docked bar: its content plus the bottom padding for the system inset. */
export const tabBarHeight = (insetBottom: number) => TAB_BAR.height + tabBarBottomPadding(insetBottom);

/** Bottom padding of the docked bar for a given system inset. */
export const tabBarBottomPadding = (insetBottom: number) => Math.max(insetBottom, TAB_BAR.minBottomPadding);
