/**
 * Layout rules for the live camera screen, kept pure so they can be tested without rendering:
 * when the screen goes compact, how a fallback feed is fitted so none of the analysed frame is
 * hidden, and how much of the screen the video gets. The numbers here are the same ones the
 * styles use, so the estimates below describe the real layout.
 */

/** Below this window height (dp) the bottom panel switches to its tighter layout. */
export const COMPACT_MAX_HEIGHT = 640;
/** Above this font scale the bottom panel switches to its tighter layout. */
export const COMPACT_FONT_SCALE = 1.3;
/** The numbers in the panel stop growing with the OS font scale here (see `a11y.maxNumberScale`). */
const MAX_NUMBER_SCALE = 1.4;

/**
 * How the feed fills its slot. `fill`: the feed is sized to the slot and shows exactly what it
 * analyses (the native camera). `aspect`: the feed gets a box with the video's own aspect, so the
 * browser/WebView's `object-fit: cover` has nothing to cut off.
 */
export type FeedFit = 'fill' | 'aspect';

export function isCompactCamera(windowHeight: number, fontScale: number): boolean {
  return windowHeight < COMPACT_MAX_HEIGHT || fontScale > COMPACT_FONT_SCALE;
}

/** Width / height of the video before the feed has reported one: portrait on a phone, landscape on a wide window. */
export function defaultFrameAspect(windowWidth: number, windowHeight: number): number {
  return windowWidth < windowHeight ? 3 / 4 : 4 / 3;
}

/** The aspect the fallback box uses: what the feed reported once known, else the default. */
export function feedAspect(reported: number | undefined, windowWidth: number, windowHeight: number): number {
  return typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? reported : defaultFrameAspect(windowWidth, windowHeight);
}

export interface FeedBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The largest box with the given aspect (width / height) that fits the slot, centred in it. */
export function fitBox(slotWidth: number, slotHeight: number, aspect: number): FeedBox {
  if (!(slotWidth > 0) || !(slotHeight > 0) || !(aspect > 0)) return { left: 0, top: 0, width: Math.max(0, slotWidth), height: Math.max(0, slotHeight) };
  const width = Math.min(slotWidth, slotHeight * aspect);
  const height = width / aspect;
  return { left: (slotWidth - width) / 2, top: (slotHeight - height) / 2, width, height };
}

/**
 * The share of the video's width and height that stays visible when it is drawn to cover a box
 * (what `object-fit: cover` does). 1 and 1 means nothing is cut off.
 */
export function visibleFraction(boxWidth: number, boxHeight: number, videoAspect: number): { x: number; y: number } {
  if (!(boxWidth > 0) || !(boxHeight > 0) || !(videoAspect > 0)) return { x: 1, y: 1 };
  const boxAspect = boxWidth / boxHeight;
  return { x: Math.min(1, boxAspect / videoAspect), y: Math.min(1, videoAspect / boxAspect) };
}

/** The bottom panel never takes more than this of the window; past it, its middle scrolls. */
export function panelMaxHeight(windowHeight: number): number {
  return Math.round(windowHeight * 0.5);
}

/** Room the translucent top bar takes over the video, so the HUD chips and the state card sit below it. */
export function topBarReserve(fontScale: number): number {
  const bar = Math.max(44, Math.round(Math.min(fontScale, 1.6) * 45 + 16));
  return 8 + bar + 8;
}

/** Spacing of the bottom panel: the single source for the styles and the estimate. */
export const PANEL = {
  regular: { padTop: 12, padBottom: 16, gap: 12, feedbackMin: 56, feedbackPad: 12, bar: 8 },
  compact: { padTop: 6, padBottom: 8, gap: 6, feedbackMin: 44, feedbackPad: 6, bar: 4 },
} as const;
const BUTTON_MIN = 52;

/**
 * About how tall the bottom panel is (feedback strip, stats, range-of-motion bar, button). Text
 * heights scale with the OS font scale. With `cue` the feedback strip carries a headline as well
 * as a message (a rep cue); without it, one line. The quality line and the save message appear
 * only after a set and are not counted.
 */
export function estimatePanelHeight(compact: boolean, fontScale: number, cue = false): number {
  const p = compact ? PANEL.compact : PANEL.regular;
  const text = (px: number) => px * fontScale;
  const number = (px: number) => px * Math.min(fontScale, MAX_NUMBER_SCALE);
  const feedback = Math.max(p.feedbackMin, p.feedbackPad * 2 + (cue ? text(23 + 20) : text(23)));
  const tiles = compact ? text(18) + number(28) + text(18) : text(18) + number(38) + text(20);
  const rom = text(18) + p.bar + (compact ? 4 : 6);
  const button = Math.max(BUTTON_MIN, text(23));
  return Math.round(p.padTop + p.padBottom + feedback + tiles + rom + button + p.gap * 3);
}

export interface CameraLayout {
  compact: boolean;
  /** Window height minus the system bars. */
  safeHeight: number;
  panelHeight: number;
  /** The video slot (the native feed fills it). */
  feedHeight: number;
  /** feedHeight / safeHeight. */
  feedShare: number;
  /** The fallback feed's box inside the slot at the default aspect, and its share of the safe height. */
  aspectBox: FeedBox;
  aspectShare: number;
}

/** The numbers for one window size (insets default to none, as in a browser). */
export function cameraLayout(win: { width: number; height: number; fontScale?: number; insetTop?: number; insetBottom?: number }, opts: { cue?: boolean; aspect?: number } = {}): CameraLayout {
  const fontScale = win.fontScale ?? 1;
  const safeHeight = win.height - (win.insetTop ?? 0) - (win.insetBottom ?? 0);
  const compact = isCompactCamera(win.height, fontScale);
  const panelHeight = Math.min(estimatePanelHeight(compact, fontScale, opts.cue), panelMaxHeight(win.height));
  const feedHeight = safeHeight - panelHeight;
  const aspectBox = fitBox(win.width, feedHeight, feedAspect(opts.aspect, win.width, win.height));
  return { compact, safeHeight, panelHeight, feedHeight, feedShare: feedHeight / safeHeight, aspectBox, aspectShare: aspectBox.height / safeHeight };
}
