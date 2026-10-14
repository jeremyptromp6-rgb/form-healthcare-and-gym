import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Streaks } from '@/lib/types';
import { dayLabel, longDate, restLine, SeasonCalendar, StreakHero, StreakSeasonView } from './StreakViews';
import { seasonProgress } from '@form/domain';

const TODAY = '2026-10-14'; // a Wednesday, in season 4

const workout = { current: 5, longest: 12, activeToday: true, restDaysRemaining: 2, startDate: '2026-10-10', plannedRestDays: 2 };
const streaks: Streaks = {
  workout,
  nutrition: { current: 0, longest: 0, activeToday: false, restDaysRemaining: null, startDate: null, available: true },
  quest: { current: 0, longest: 0, activeToday: false, restDaysRemaining: null, startDate: null },
  weekly: { current: 1, longest: 1, metThisWeek: false, startWeek: null, target: 3 },
};
const w = (localDate: string, painLevel = 'none') => ({ localDate, painLevel });

describe('restLine', () => {
  it('explains the protection in each state', () => {
    expect(restLine({ ...workout, current: 0, activeToday: false, restDaysRemaining: null })).toMatch(/start a streak/);
    expect(restLine(workout)).toBe('Done today. Up to 2 rest days in a row keep it alive.');
    expect(restLine({ ...workout, activeToday: false, restDaysRemaining: 0 })).toBe('Train today to keep your streak going.');
    expect(restLine({ ...workout, activeToday: false, restDaysRemaining: 1 })).toBe('1 rest day left before it breaks.');
  });
});

describe('dates', () => {
  it('names a day for screen readers', () => {
    expect(longDate('2026-10-14')).toBe('Wednesday 14 October 2026');
    expect(dayLabel('2026-10-14', TODAY, true)).toBe('Wednesday 14 October 2026, today, trained');
    expect(dayLabel('2026-10-12', TODAY, false)).toBe('Monday 12 October 2026, no workout');
    expect(dayLabel('2026-10-20', TODAY, false)).toBe('Tuesday 20 October 2026, upcoming');
  });
});

describe('StreakHero', () => {
  it('shows the big number, best streak and rest protection', async () => {
    await render(<StreakHero streak={workout} />);
    expect(screen.getByLabelText('5 day streak')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Best 12')).toBeTruthy();
    expect(screen.getByText('2 rest days allowed')).toBeTruthy();
  });
});

describe('SeasonCalendar', () => {
  const progress = seasonProgress([], TODAY);

  it('opens on the current month, Monday first, marking trained days and today', async () => {
    await render(<SeasonCalendar progress={progress} today={TODAY} trainedDates={['2026-10-12', '2026-10-14']} />);
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(screen.getByLabelText('Monday 12 October 2026, trained')).toBeTruthy();
    expect(screen.getByLabelText('Tuesday 13 October 2026, no workout')).toBeTruthy();
    expect(screen.getByLabelText('Wednesday 14 October 2026, today, trained')).toBeTruthy();
    expect(screen.getByLabelText('Thursday 15 October 2026, upcoming')).toBeTruthy();
    // 1 October 2026 is a Thursday: three blank cells before it, so it sits in the fourth column.
    expect(screen.getByLabelText('Thursday 1 October 2026, no workout')).toBeTruthy();
  });

  it('moves between the season months with the arrows and stops at the ends', async () => {
    await render(<SeasonCalendar progress={progress} today={TODAY} trainedDates={[]} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('November 2026')).toBeTruthy();
    expect(screen.getByLabelText('Sunday 1 November 2026, upcoming')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('December 2026')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('December 2026')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('October 2026')).toBeTruthy();
  });
});

describe('StreakSeasonView', () => {
  it('shows the hero, the reward track and the calendar from real workouts', async () => {
    const days = Array.from({ length: 8 }, (_, i) => w(`2026-10-0${i + 1}`));
    await render(<StreakSeasonView streaks={streaks} today={TODAY} workouts={[...days, w('2026-10-09', 'serious'), w('2026-09-20')]} />);
    expect(screen.getByLabelText('5 day streak')).toBeTruthy();
    expect(screen.getByText('Season 4 · 2026')).toBeTruthy();
    expect(screen.getByText('8 training days this season')).toBeTruthy();
    expect(screen.getByText('Season ends in 78 days')).toBeTruthy();
    expect(screen.getByText('12 more training days for the next chest.')).toBeTruthy();
    expect(screen.getByLabelText('Spark chest, 7 training days, opened')).toBeTruthy();
    expect(screen.getByLabelText('Kindle chest, 20 training days, locked')).toBeTruthy();
    expect(screen.getByLabelText('Friday 9 October 2026, no workout')).toBeTruthy(); // serious pain does not count
    expect(screen.getByLabelText('Thursday 8 October 2026, trained')).toBeTruthy();
    expect(screen.getByLabelText('Progress to the next season chest')).toBeTruthy();
  });

  it('starts empty and cold without any workouts', async () => {
    await render(<StreakSeasonView streaks={{ ...streaks, workout: { ...workout, current: 0, longest: 0, activeToday: false, restDaysRemaining: null, startDate: null } }} today={TODAY} workouts={[]} />);
    expect(screen.getByLabelText('0 day streak')).toBeTruthy();
    expect(screen.getByText('7 more training days for the next chest.')).toBeTruthy();
    expect(screen.getByLabelText('Spark chest, 7 training days, locked')).toBeTruthy();
  });
});
