import { rankLabel, stepProgress } from './prestige';

const base = { level: 13, xpIntoLevel: 2450, xpForNextLevel: 3000, fractionToNext: 2450 / 3000 };

describe('stepProgress', () => {
  it('follows the level below the top', () => {
    expect(stepProgress({ ...base, prestige: null, xpIntoStep: 2450, xpForStep: 3000 })).toMatchObject({ into: 2450, span: 3000, toNext: 550, nextName: 'level 14' });
    expect(stepProgress(base).fraction).toBeCloseTo(2450 / 3000);
  });

  it('is Champion 1 exactly at the top, heading for Champion 2', () => {
    const s = stepProgress({ level: 100, xpIntoLevel: 0, xpForNextLevel: 0, fractionToNext: 1, prestige: 1, xpIntoStep: 0, xpForStep: 3000 });
    expect(s).toMatchObject({ into: 0, span: 3000, fraction: 0, toNext: 3000, nextName: 'Champion 2' });
  });

  it('keeps going past Champion 1', () => {
    const s = stepProgress({ level: 100, xpIntoLevel: 31_200, xpForNextLevel: 0, fractionToNext: 1, prestige: 11, xpIntoStep: 1200, xpForStep: 3000 });
    expect(s).toMatchObject({ into: 1200, toNext: 1800, nextName: 'Champion 12' });
    expect(s.fraction).toBeCloseTo(0.4);
  });

  it('treats an older server at the top as plain max level', () => {
    expect(stepProgress({ level: 100, xpIntoLevel: 500, xpForNextLevel: 0, fractionToNext: 1 })).toMatchObject({ span: 0, fraction: 1, nextName: null });
  });
});

describe('rankLabel', () => {
  it('adds the prestige number only when there is one', () => {
    expect(rankLabel('Champion', 4)).toBe('Champion 4');
    expect(rankLabel('Champion', null)).toBe('Champion');
    expect(rankLabel('Iron')).toBe('Iron');
  });
});
