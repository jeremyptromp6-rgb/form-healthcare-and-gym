import type { ProgressPhoto } from '@/lib/progressPhotos';
import { clampFraction, defaultPair, fractionFromX, SLIDER_STEP, sliderValueText, stepFraction } from './compareMath';
import { groupByMonth, monthLabel, shortDate } from './timeline';

const photo = (id: string, pose: ProgressPhoto['pose'], date: string, weightKg: number | null = null): ProgressPhoto => ({ id, pose, date, file: `${id}.jpg`, weightKg });

describe('compare slider position', () => {
  it('maps a touch to a fraction of the width, clamped to the frame', () => {
    expect(fractionFromX(150, 300)).toBe(0.5);
    expect(fractionFromX(75, 300)).toBe(0.25);
    expect(fractionFromX(-40, 300)).toBe(0);
    expect(fractionFromX(900, 300)).toBe(1);
  });

  it('rests in the middle before the frame has a width, and for junk numbers', () => {
    expect(fractionFromX(10, 0)).toBe(0.5);
    expect(clampFraction(Number.NaN)).toBe(0.5);
    expect(clampFraction(Infinity)).toBe(0.5);
  });

  it('screen-reader steps move a tenth at a time and stop at the ends', () => {
    expect(SLIDER_STEP).toBe(0.1);
    expect(stepFraction(0.5, 1)).toBe(0.6);
    expect(stepFraction(0.5, -1)).toBe(0.4);
    expect(stepFraction(0.95, 1)).toBe(1);
    expect(stepFraction(0.05, -1)).toBe(0);
    expect(sliderValueText(0.6)).toBe('60 percent before');
  });
});

describe('default comparison', () => {
  const all = [photo('a', 'front', '2026-07-01'), photo('b', 'side', '2026-07-02'), photo('c', 'front', '2026-08-15'), photo('d', 'front', '2026-10-01')];

  it('is the oldest against the newest photo of the pose', () => {
    const pair = defaultPair(all, 'front');
    expect(pair?.before.id).toBe('a');
    expect(pair?.after.id).toBe('d');
  });

  it('needs two photos of the same pose', () => {
    expect(defaultPair(all, 'side')).toBeNull();
    expect(defaultPair(all, 'back')).toBeNull();
    expect(defaultPair([], 'front')).toBeNull();
  });
});

describe('timeline grouping', () => {
  const all = [
    photo('a', 'front', '2026-09-03', 82),
    photo('b', 'side', '2026-10-01'),
    photo('c', 'front', '2026-10-20', 81.2),
    photo('d', 'back', '2026-10-20'),
    photo('e', 'front', '2025-12-31'),
  ];

  it('groups by month, newest month first and newest photo first within it', () => {
    const groups = groupByMonth(all);
    expect(groups.map((g) => g.key)).toEqual(['2026-10', '2026-09', '2025-12']);
    expect(groups.map((g) => g.label)).toEqual(['October 2026', 'September 2026', 'December 2025']);
    expect(groups[0]!.photos.map((p) => p.date)).toEqual(['2026-10-20', '2026-10-20', '2026-10-01']);
  });

  it('can narrow to one pose, dropping months with none', () => {
    expect(groupByMonth(all, 'front').map((g) => [g.key, g.photos.length])).toEqual([
      ['2026-10', 1],
      ['2026-09', 1],
      ['2025-12', 1],
    ]);
    expect(groupByMonth(all, 'back').map((g) => g.key)).toEqual(['2026-10']);
    expect(groupByMonth([])).toEqual([]);
  });

  it('formats dates without any time-zone shift', () => {
    expect(shortDate('2026-10-01')).toBe('1 Oct 2026');
    expect(shortDate('2025-12-31')).toBe('31 Dec 2025');
    expect(monthLabel('2026-01-15')).toBe('January 2026');
  });
});
