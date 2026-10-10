import { formatRest } from './workoutSession';

describe('formatRest', () => {
  it('says rest the way people do', () => {
    expect(formatRest(45)).toBe('45 s');
    expect(formatRest(60)).toBe('1 min');
    expect(formatRest(90)).toBe('1 min 30 s');
    expect(formatRest(120)).toBe('2 min');
  });
});
