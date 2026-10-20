import { secondsSinceSet, startSetClock } from './liveSet';

const s = (pausedMs: number) => ({ pausedMs });

describe('time since the previous set (device clock)', () => {
  it('counts whole seconds from the anchor', () => {
    const clock = startSetClock(s(0), 1_000_000);
    expect(secondsSinceSet(clock, s(0), 1_041_900)).toBe(41);
  });

  it('takes pauses since the anchor off the clock, but not pauses before it', () => {
    const clock = startSetClock(s(60_000), 1_000_000); // 60 s were already paused when the anchor was set
    expect(secondsSinceSet(clock, s(60_000 + 90_000), 1_000_000 + 180_000)).toBe(180 - 90);
    expect(secondsSinceSet(clock, s(60_000), 1_000_000 + 30_000)).toBe(30);
  });

  it('stays within the server range of 1 to 3600 seconds', () => {
    const clock = startSetClock(s(0), 1_000_000);
    expect(secondsSinceSet(clock, s(0), 1_000_000)).toBe(1);
    expect(secondsSinceSet(clock, s(0), 990_000)).toBe(1); // a clock that ran backwards
    expect(secondsSinceSet(clock, s(0), 1_000_000 + 5 * 3600_000)).toBe(3600);
    expect(secondsSinceSet(clock, s(Number.NaN), 1_050_000)).toBe(1);
  });
});
