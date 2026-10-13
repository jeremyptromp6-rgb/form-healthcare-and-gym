import { render, screen } from '@testing-library/react-native';
import { weekBounds, WeekSummary } from './WeekSummary';

const w = (localDate: string, durationMinutes: number, xp: number) => ({ localDate, durationMinutes, xp });

describe('weekBounds', () => {
  it('is Monday to Sunday around the date', () => {
    expect(weekBounds('2026-10-12')).toEqual({ first: '2026-10-12', last: '2026-10-18' }); // a Monday
    expect(weekBounds('2026-10-18')).toEqual({ first: '2026-10-12', last: '2026-10-18' }); // its Sunday
    expect(weekBounds('2026-10-14')).toEqual({ first: '2026-10-12', last: '2026-10-18' });
    expect(weekBounds('2026-01-01')).toEqual({ first: '2025-12-29', last: '2026-01-04' }); // across a year end
  });
});

describe('WeekSummary', () => {
  it('totals only this week, not the latest ten whatever their date', async () => {
    const workouts = [w('2026-10-14', 40, 300), w('2026-10-12', 30, 200), w('2026-10-09', 60, 500), w('2026-09-01', 45, 400)];
    await render(<WeekSummary workouts={workouts} today="2026-10-14" />);
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getByLabelText(/Workouts/)).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // workouts
    expect(screen.getByText('70')).toBeTruthy(); // minutes: 40 + 30
    expect(screen.getByText('500')).toBeTruthy(); // xp: 300 + 200
  });

  it('shows zeros for a week with nothing in it', async () => {
    await render(<WeekSummary workouts={[w('2026-09-01', 45, 400)]} today="2026-10-14" />);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(3);
  });
});
