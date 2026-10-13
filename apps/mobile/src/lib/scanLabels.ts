import type { ScanBox } from '@form/domain';

/**
 * Where the food labels go on the review photo. Pure and deterministic: the same items and size
 * always give the same layout. Boxes are [ymin, xmin, ymax, xmax] in 0–1000 of the whole image; the
 * photo shown is the exact JPEG the model saw (same pixels, upright), contain-fitted, so a box maps
 * straight onto the displayed block with no orientation or crop correction.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The largest block of the image's aspect that fits the container, centred in it (contain). */
export function containFit(imageW: number, imageH: number, containerW: number, containerH: number): Rect {
  if (!(imageW > 0 && imageH > 0 && containerW > 0 && containerH > 0)) return { x: 0, y: 0, w: Math.max(0, containerW), h: Math.max(0, containerH) };
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

/** A box inside the displayed image block `dw × dh` (offset `ox, oy` when the block sits inside a larger container). */
export function boxToRect(box: ScanBox, dw: number, dh: number, ox = 0, oy = 0): Rect {
  const c = (v: number) => Math.min(1000, Math.max(0, v));
  const [ymin, xmin, ymax, xmax] = box;
  return {
    x: ox + (c(xmin) / 1000) * dw,
    y: oy + (c(ymin) / 1000) * dh,
    w: ((c(xmax) - c(xmin)) / 1000) * dw,
    h: ((c(ymax) - c(ymin)) / 1000) * dh,
  };
}

export interface LabelInput {
  id: string;
  /** The text on the chip (the item's name); long names are cut with an ellipsis. */
  text: string;
  /** Absent when the food couldn't be located: no label is placed. */
  box?: ScanBox;
  /** A removed item gets no label. */
  removed?: boolean;
}

export interface LabelOptions {
  chipHeight?: number;
  /** Space kept between a chip and the photo's edge. */
  margin?: number;
  /** Space kept between two chips. */
  gap?: number;
  /** Estimated width of one character of chip text. */
  charWidth?: number;
  /** Chip width not taken by text (padding plus the number badge). */
  chrome?: number;
  minWidth?: number;
  /** The widest a chip may be, as a fraction of the photo's width. */
  maxWidthFraction?: number;
  /** Radius of the anchor dot drawn on the food; no chip may cover it. */
  dotRadius?: number;
  /** Distance from the anchor point to the chip's near edge: the dot's radius plus the stem's length. */
  anchorGap?: number;
}

export interface PlacedLabel {
  id: string;
  /** The text to show, ellipsised to fit the chip. */
  text: string;
  /** Centre of the food's box: the anchor dot always goes here. */
  anchor: Point;
  /** The chip, inside the photo block. */
  rect: Rect;
  /** Draw a stem from the chip to the anchor: the chip sits beside its food, not on it (always, unless the photo is too small to). */
  leader: boolean;
}

const DEFAULTS: Required<LabelOptions> = { chipHeight: 28, margin: 4, gap: 4, charWidth: 7.2, chrome: 44, minWidth: 64, maxWidthFraction: 0.6, dotRadius: 8, anchorGap: 15 };

// Where to try a chip relative to its anchor, in order: above (like a map pin), below, right, left and the diagonals.
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 1],
];
const RINGS = 6;

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * Where a stem from `anchor` meets a pill-shaped chip: the point on the chip's outline nearest the anchor
 * (a pill is a rectangle with fully rounded ends, so its ends are half-circles).
 */
export function stemEnd(rect: Rect, anchor: Point): Point {
  const r = rect.h / 2;
  const cy = rect.y + r;
  const qx = Math.min(rect.x + rect.w - r, Math.max(rect.x + r, anchor.x));
  const dx = anchor.x - qx;
  const dy = anchor.y - cy;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: qx, y: cy };
  return { x: qx + (dx / d) * r, y: cy + (dy / d) * r };
}

/** Places one chip per located, kept item so that chips stay inside the photo and off each other. */
export function layoutScanLabels(items: readonly LabelInput[], dw: number, dh: number, options: LabelOptions = {}): PlacedLabel[] {
  const o = { ...DEFAULTS, ...options };
  const maxChars = (w: number) => Math.max(1, Math.floor((w - o.chrome) / o.charWidth + 1e-9));

  type Job = { index: number; id: string; text: string; anchor: Point; w: number; area: number };
  const jobs: Job[] = [];
  items.forEach((item, index) => {
    if (!item.box || item.removed) return;
    const r = boxToRect(item.box, dw, dh);
    const w = Math.min(Math.max(o.charWidth * item.text.length + o.chrome, o.minWidth), Math.max(o.minWidth, o.maxWidthFraction * dw));
    const room = maxChars(w);
    const text = item.text.length > room ? `${item.text.slice(0, Math.max(0, room - 1)).trimEnd()}…` : item.text;
    jobs.push({ index, id: item.id, text, anchor: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, w, area: r.w * r.h });
  });

  // Big foods first, so the small ones move around them (ties keep the item order).
  const order = [...jobs].sort((a, b) => b.area - a.area || a.index - b.index);
  const placed: Rect[] = [];
  const result = new Map<number, PlacedLabel>();
  const h = o.chipHeight;

  const anchors = jobs.map((j) => j.anchor);
  const clampRect = (cx: number, cy: number, w: number): Rect => {
    const loX = o.margin;
    const hiX = dw - o.margin - w;
    const loY = o.margin;
    const hiY = dh - o.margin - h;
    // A photo too small for the chip: centre it rather than push it off the other side.
    const x = hiX < loX ? (dw - w) / 2 : Math.min(hiX, Math.max(loX, cx - w / 2));
    const y = hiY < loY ? (dh - h) / 2 : Math.min(hiY, Math.max(loY, cy - h / 2));
    return { x, y, w, h };
  };

  for (const job of order) {
    let best: Rect | null = null;
    let bestCost = Infinity;
    search: for (let k = 0; k <= RINGS; k++) {
      const step = k * (h + o.gap);
      for (const [dx, dy] of DIRECTIONS) {
        // The chip's near edge sits `anchorGap` from the anchor, so the dot and a short stem stay visible.
        const rect = clampRect(job.anchor.x + dx * (o.anchorGap + job.w / 2 + step), job.anchor.y + dy * (o.anchorGap + h / 2 + step), job.w);
        const probe = inflate(rect, o.gap);
        const overlap = placed.reduce((sum, p) => sum + overlapArea(probe, p), 0);
        // A chip over its own dot is the worst (it hides the food it names); over another food's dot is a small cost.
        const cover = inflate(rect, o.dotRadius);
        const ownCover = contains(cover, job.anchor) ? 1 : 0;
        const otherCover = anchors.reduce((n, a) => n + (a !== job.anchor && contains(cover, a) ? 1 : 0), 0);
        const cost = ownCover * 1e9 + overlap * 1e3 + otherCover;
        if (cost === 0) {
          best = rect;
          break search;
        }
        if (cost < bestCost) {
          best = rect;
          bestCost = cost;
        }
      }
    }
    const rect = best!;
    placed.push(rect);
    result.set(job.index, { id: job.id, text: job.text, anchor: job.anchor, rect, leader: !contains(rect, job.anchor) });
  }

  return jobs.map((j) => result.get(j.index)!);
}
