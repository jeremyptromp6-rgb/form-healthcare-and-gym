import { trainingWeek } from './week';

describe('trainingWeek', () => {
  it('marks this week\'s training days, Monday first, and finds today', () => {
    // 2026-10-06 is a Tuesday.
    const w = trainingWeek(['2026-10-05', '2026-10-06', '2026-10-04', '2026-10-12'], '2026-10-06');
    expect(w.todayIndex).toBe(1);
    expect(w.trained).toEqual([true, true, false, false, false, false, false]);
  });

  it('handles Sunday as the last day of the week', () => {
    const w = trainingWeek(['2026-10-11', '2026-10-05'], '2026-10-11');
    expect(w.todayIndex).toBe(6);
    expect(w.trained).toEqual([true, false, false, false, false, false, true]);
  });
});
