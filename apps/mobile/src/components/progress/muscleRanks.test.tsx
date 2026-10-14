import { computeMuscleRanks } from '@form/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { MuscleRanks } from '@/lib/types';
import { climb, MuscleRanksView, tierLabel, toNextLine } from './MuscleRanksView';

const data = (sets: { exerciseId: string; verifiedReps: number }[]): MuscleRanks => ({ windowDays: 28, from: '2026-09-17', to: '2026-10-14', ranks: computeMuscleRanks(sets) });
const squats = (n: number) => Array.from({ length: n }, () => ({ exerciseId: 'squat', verifiedReps: 5 }));

describe('helpers', () => {
  it('names tiers and levels', () => {
    expect(tierLabel('untrained', 0)).toBe('Untrained');
    expect(tierLabel('gold', 2)).toBe('Gold II');
    expect(tierLabel('diamond', 3)).toBe('Diamond III');
  });
  it('says how many sets reach the next tier', () => {
    expect(toNextLine({ nextTier: 'gold', setsToNext: 6 })).toBe('6 more sets to reach Gold');
    expect(toNextLine({ nextTier: 'bronze', setsToNext: 1 })).toBe('1 more set to reach Bronze');
    expect(toNextLine({ nextTier: null, setsToNext: null })).toMatch(/Top rank/);
  });
  it('measures the climb to the next tier', () => {
    const r = computeMuscleRanks(squats(24)).find((m) => m.muscle === 'quads')!; // silver, 24 of 16..32
    expect(climb(r)).toBeCloseTo(0.5);
    expect(climb({ ...r, nextTier: null, setsToNext: null })).toBe(1);
  });
});

describe('MuscleRanksView', () => {
  it('welcomes a brand-new user: every muscle untrained, nothing alarming', async () => {
    await render(<MuscleRanksView data={data([])} />);
    expect(screen.getByText('Every muscle starts untrained')).toBeTruthy();
    expect(screen.getByText('Muscles to improve')).toBeTruthy();
    expect(screen.getAllByText('Untrained').length).toBeGreaterThanOrEqual(13);
    expect(screen.getByLabelText(/^Muscle ranks: Chest untrained/)).toBeTruthy();
    expect(countSvg().forbidden).toEqual([]);
  });

  it('lists the weakest muscles first, with the strongest last', async () => {
    await render(<MuscleRanksView data={data(squats(40))} />);
    const rows = screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
    const at = (m: string) => rows.findIndex((l) => l.startsWith(`${m},`));
    expect(at('Chest')).toBeGreaterThanOrEqual(0);
    expect(at('Chest')).toBeLessThan(at('Quads'));
    expect(screen.getByText('Focus next')).toBeTruthy();
  });

  it('expands a row to show sets this period and sets to the next tier', async () => {
    await render(<MuscleRanksView data={data(squats(20))} />);
    expect(screen.queryByText(/more sets to reach/)).toBeNull();
    await fireEvent.press(screen.getByLabelText(/^Quads, Silver I, 20 sets/));
    expect(screen.getByText('20 sets in the last 28 days')).toBeTruthy();
    expect(screen.getByText('12 more sets to reach Gold')).toBeTruthy();
    expect(screen.getByText(/^Try /)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Quads, Silver I, 20 sets/));
    expect(screen.queryByText('12 more sets to reach Gold')).toBeNull();
  });
});
