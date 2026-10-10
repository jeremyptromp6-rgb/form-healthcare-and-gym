import { createContext } from 'react';

/**
 * The phone tab bar is docked (laid out below the screens, never floating over them), so tab
 * screens need no extra room for it. Screens outside the tabs still clear the system navigation
 * bar themselves. `InTabsContext` tells the shared Screen which case it's in.
 */
export const TAB_BAR = {
  /** Height of the bar's content, above the system navigation area. */
  height: 62,
  /** Breathing room under the labels when the system bar takes no space. */
  minBottomPadding: 8,
} as const;

export const InTabsContext = createContext(false);

/** Bottom padding of the docked bar for a given system inset. */
export const tabBarBottomPadding = (insetBottom: number) => Math.max(insetBottom, TAB_BAR.minBottomPadding);
