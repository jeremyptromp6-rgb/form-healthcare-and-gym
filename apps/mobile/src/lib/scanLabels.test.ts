import type { ScanBox } from '@form/domain';
import { boxToRect, containFit, layoutScanLabels, stemEnd, type LabelInput, type PlacedLabel, type Point, type Rect } from './scanLabels';

import { itemNumber, macroShares } from './scan';

const overlaps =(a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (r: Rect, p: Point) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const inflate = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const inside = (r: Rect, dw: number, dh: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= dw + 1e-9 && r.y + r.h <= dh + 1e-9;
const item = (id: string, box: ScanBox | undefined, text = id, removed = false): LabelInput => ({ id, text, box, removed });

describe('containFit', () => {
  it('fits a portrait photo in a wide container, centred', () => {
    expect(containFit(960, 1280, 400, 300)).toEqual({ x: 400 / 2 - 112.5, y: 0, w: 225, h: 300 });
  });
  it('fits a landscape photo in a tall container, centred', () => {
    expect(containFit(1280, 960, 300, 400)).toEqual({ x: 0, y: (400 - 225) / 2, w: 300, h: 225 });
  });
  it('fits a square photo and handles a container of the same aspect', () => {
    expect(containFit(500, 500, 300, 300)).toEqual({ x: 0, y: 0, w: 300, h: 300 });
    expect(containFit(500, 500, 200, 400)).toEqual({ x: 0, y: 100, w: 200, h: 200 });
  });
  it('falls back to the container for unknown image dimensions', () => {
    expect(containFit(0, 0, 300, 200)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });
});

describe('boxToRect', () => {
  // [ymin, xmin, ymax, xmax]
  const box: ScanBox = [100, 200, 600, 800];
  it('maps onto a portrait block', () => {
    expect(boxToRect(box, 300, 400)).toEqual({ x: 60, y: 40, w: 180, h: 200 });
  });
  it('maps onto a landscape block', () => {
    expect(boxToRect(box, 400, 300)).toEqual({ x: 80, y: 30, w: 240, h: 150 });
  });
  it('maps onto a square block', () => {
    expect(boxToRect(box, 500, 500)).toEqual({ x: 100, y: 50, w: 300, h: 250 });
  });
  it('adds the block offset inside a larger container (contain fit)', () => {
    const fit = containFit(960, 1280, 400, 300);
    const r = boxToRect([0, 0, 1000, 1000], fit.w, fit.h, fit.x, fit.y);
    expect(r).toEqual({ x: fit.x, y: fit.y, w: fit.w, h: fit.h });
  });
  it('maps the whole image to the whole block and clamps a box that strays out of range', () => {
    expect(boxToRect([0, 0, 1000, 1000], 300, 400)).toEqual({ x: 0, y: 0, w: 300, h: 400 });
    expect(boxToRect([-50, -50, 1200, 1200], 300, 400)).toEqual({ x: 0, y: 0, w: 300, h: 400 });
  });
});

describe('layoutScanLabels', () => {
  const DW = 300;
  const DH = 400;

  it('pins a lone label just above its food, centred on it, with a stem and the dot uncovered', () => {
    const [l] = layoutScanLabels([item('a', [300, 300, 700, 700], 'Rice')], DW, DH);
    expect(l!.anchor).toEqual({ x: 150, y: 200 });
    expect(l!.rect.x + l!.rect.w / 2).toBeCloseTo(150);
    // The chip's bottom edge sits a small gap (anchorGap 15 from the anchor, 7 from the 8 dp dot) above the anchor.
    expect(l!.rect.y + l!.rect.h).toBeCloseTo(200 - 15);
    expect(contains(l!.rect, l!.anchor)).toBe(false);
    expect(l!.leader).toBe(true);
    expect(l!.text).toBe('Rice');
  });

  it('puts the chip below the food when there is no room above (food at the top edge)', () => {
    const [l] = layoutScanLabels([item('a', [0, 400, 40, 600], 'Rice')], DW, DH);
    expect(l!.anchor.y).toBeCloseTo(8);
    expect(l!.rect.y).toBeGreaterThan(l!.anchor.y);
    expect(l!.rect.y - l!.anchor.y).toBeCloseTo(15);
    expect(l!.rect.x + l!.rect.w / 2).toBeCloseTo(l!.anchor.x);
    expect(contains(l!.rect, l!.anchor)).toBe(false);
    expect(l!.leader).toBe(true);
  });

  it('keeps every food visible: no chip covers any anchor dot when there is room', () => {
    const items = [item('a', [100, 100, 300, 300], 'Rice'), item('b', [400, 600, 600, 800], 'Chicken'), item('c', [700, 200, 900, 400], 'Broccoli'), item('d', [450, 450, 550, 550], 'Sauce')];
    const out = layoutScanLabels(items, DW, DH);
    for (const l of out) for (const m of out) expect(contains(inflate(l.rect, 8), m.anchor)).toBe(false);
  });

  it('finds the point where a stem meets the pill-shaped chip', () => {
    const rect = { x: 100, y: 100, w: 80, h: 28 };
    // Straight below the chip's flat middle: the bottom edge.
    expect(stemEnd(rect, { x: 140, y: 160 })).toEqual({ x: 140, y: 128 });
    // Below the rounded end: on the half-circle, 14 from its centre toward the anchor.
    const p = stemEnd(rect, { x: 100, y: 160 });
    expect(Math.hypot(p.x - 114, p.y - 114)).toBeCloseTo(14);
    expect(p.y).toBeGreaterThan(114);
  });

  it('skips items without a box and removed items', () => {
    const out = layoutScanLabels([item('a', undefined), item('b', [100, 100, 400, 400], 'b', true), item('c', [100, 100, 400, 400])], DW, DH);
    expect(out.map((l) => l.id)).toEqual(['c']);
  });

  it('returns labels in item order and is deterministic', () => {
    const items = [item('small', [480, 480, 520, 520]), item('big', [300, 300, 700, 700]), item('mid', [400, 400, 600, 600])];
    const a = layoutScanLabels(items, DW, DH);
    const b = layoutScanLabels(items, DW, DH);
    expect(a).toEqual(b);
    expect(a.map((l) => l.id)).toEqual(['small', 'big', 'mid']);
  });

  it('places the largest box first, above its food, and moves the small ones around it', () => {
    const items = [item('small', [480, 480, 520, 520], 'Pepper'), item('big', [300, 300, 700, 700], 'Chicken')];
    const out = layoutScanLabels(items, DW, DH);
    const big = out.find((l) => l.id === 'big')!;
    const small = out.find((l) => l.id === 'small')!;
    expect(big.rect.y + big.rect.h).toBeCloseTo(big.anchor.y - 15);
    expect(big.leader).toBe(true);
    expect(overlaps(big.rect, small.rect)).toBe(false);
    expect(small.leader).toBe(true);
    expect(contains(small.rect, small.anchor)).toBe(false);
  });

  it('never overlaps chips for eight foods piled on one spot, and keeps them inside the photo', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`, [420 - i * 5, 420 - i * 5, 580 + i * 5, 580 + i * 5], `Food number ${i}`));
    const out = layoutScanLabels(items, DW, DH);
    expect(out).toHaveLength(8);
    for (const l of out) expect(inside(l.rect, DW, DH)).toBe(true);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i]!.rect, out[j]!.rect)).toBe(false);
  });

  it('keeps a gap between chips', () => {
    const out = layoutScanLabels([item('a', [450, 450, 550, 550]), item('b', [452, 452, 552, 552])], DW, DH);
    const [a, b] = out as [PlacedLabel, PlacedLabel];
    const grown = { x: a.rect.x - 4, y: a.rect.y - 4, w: a.rect.w + 8, h: a.rect.h + 8 };
    expect(overlaps(grown, b.rect)).toBe(false);
  });

  it('clamps a label whose food is in a corner or at an edge inside the photo, and flags the leader', () => {
    const corner = layoutScanLabels([item('tl', [0, 0, 60, 60]), item('br', [940, 940, 1000, 1000])], DW, DH);
    for (const l of corner) {
      expect(inside(l.rect, DW, DH)).toBe(true);
      expect(l.rect.x).toBeGreaterThanOrEqual(4);
      expect(l.rect.y).toBeGreaterThanOrEqual(4);
      expect(l.rect.x + l.rect.w).toBeLessThanOrEqual(DW - 4 + 1e-9);
      expect(l.rect.y + l.rect.h).toBeLessThanOrEqual(DH - 4 + 1e-9);
      expect(l.leader).toBe(true);
    }
    // The anchor dot still sits on the food, not on the clamped chip.
    expect(corner[0]!.anchor).toEqual({ x: 9, y: 12 });
  });

  it('moves a label that would run off the right edge left without shrinking it', () => {
    const [near, far] = layoutScanLabels([item('a', [450, 880, 550, 1000], 'Salmon fillet'), item('b', [450, 400, 550, 500], 'Salmon fillet')], DW, DH);
    expect(near!.rect.w).toBe(far!.rect.w);
    expect(near!.rect.x + near!.rect.w).toBeLessThanOrEqual(DW - 4 + 1e-9);
  });

  it('sizes the chip from the text (min 64, max 0.6 of the photo) and ellipsises long names', () => {
    const [short, long] = layoutScanLabels([item('a', [100, 100, 300, 300], 'Egg'), item('b', [600, 600, 800, 800], 'Slow-cooked beef and vegetable casserole with dumplings')], DW, DH);
    expect(short!.rect.w).toBeCloseTo(65.6);
    expect(short!.rect.h).toBe(28);
    expect(long!.rect.w).toBeCloseTo(0.6 * DW);
    expect(long!.text.endsWith('…')).toBe(true);
    expect(long!.text.length).toBeLessThan('Slow-cooked beef and vegetable casserole with dumplings'.length);
    expect(layoutScanLabels([item('x', [100, 100, 300, 300], 'A')], DW, DH)[0]!.rect.w).toBe(64);
  });

  it('never shrinks a chip below its minimum width on a tiny photo', () => {
    const [l] = layoutScanLabels([item('a', [100, 100, 900, 900], 'Rice')], 60, 80);
    expect(l!.rect.w).toBe(64);
  });

  it('with no free spot takes the least overlapping one and still returns a label for every item', () => {
    // A photo so small only a couple of chips fit.
    const items = Array.from({ length: 6 }, (_, i) => item(`i${i}`, [100 + i * 10, 100, 900, 900], `Item ${i}`));
    const out = layoutScanLabels(items, 120, 60);
    expect(out).toHaveLength(6);
    for (const l of out) expect(inside(l.rect, 120, 60)).toBe(true);
  });

  it('returns nothing for no items', () => {
    expect(layoutScanLabels([], DW, DH)).toEqual([]);
  });
});

describe('itemNumber', () => {
  const scan = { items: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] } as never;
  it('is the 1-based place in the scan, so unlocated items keep their number too', () => {
    expect(itemNumber(scan, 'x')).toBe(1);
    expect(itemNumber(scan, 'z')).toBe(3);
  });
  it('is 0 for an item that is not in the scan', () => {
    expect(itemNumber(scan, 'nope')).toBe(0);
  });
});

describe('macroShares', () => {
  it('splits calories 4/4/9 per gram and adds up to 1', () => {
    // 30 g protein = 120 kcal, 0 carbs, 5 g fat = 45 kcal.
    const s = macroShares({ proteinG: 30, carbsG: 0, fatG: 5 });
    expect(s.protein).toBeCloseTo(120 / 165);
    expect(s.carbs).toBe(0);
    expect(s.fat).toBeCloseTo(45 / 165);
    expect(s.protein + s.carbs + s.fat).toBeCloseTo(1);
  });
  it('weights fat at 9 kcal per gram', () => {
    expect(macroShares({ proteinG: 10, carbsG: 10, fatG: 10 })).toEqual({ protein: 40 / 170, carbs: 40 / 170, fat: 90 / 170 });
  });
  it('is all zero when there is nothing to split, or the numbers are unusable', () => {
    const zero = { protein: 0, carbs: 0, fat: 0 };
    expect(macroShares({ proteinG: 0, carbsG: 0, fatG: 0 })).toEqual(zero);
    expect(macroShares({ proteinG: Number.NaN, carbsG: -3, fatG: Number.POSITIVE_INFINITY })).toEqual(zero);
  });
  it('ignores a negative or non-finite part but keeps the rest', () => {
    expect(macroShares({ proteinG: -5, carbsG: 25, fatG: Number.NaN })).toEqual({ protein: 0, carbs: 1, fat: 0 });
  });
});
