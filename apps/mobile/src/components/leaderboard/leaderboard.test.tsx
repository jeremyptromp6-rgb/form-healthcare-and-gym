import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Leaderboard, LeaderboardEntry, LeaderboardPeriod } from '@/lib/types';
import { LeaderboardView, type LeaderboardState } from './LeaderboardView';

const entry = (position: number, over: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  position,
  name: `Athlete #AAA${position}`,
  anonymous: true,
  isYou: false,
  points: 1000 - position * 10,
  level: 12,
  rank: 'Athlete',
  rankLabel: 'Athlete',
  prestige: null,
  ...over,
});
const board = (over: Partial<Leaderboard> = {}): Leaderboard => ({
  period: 'week',
  from: '2026-10-12',
  to: '2026-10-15',
  totalRanked: 5,
  entries: [entry(1, { name: 'Sam', anonymous: false }), entry(2), entry(3), entry(4), entry(5, { isYou: true })],
  you: { position: 5, name: 'Athlete #AAA5', anonymous: true, points: 950, level: 12, rank: 'Athlete', rankLabel: 'Athlete', prestige: null, optedIn: false },
  ...over,
});
const show = async (state: LeaderboardState, extra: { onPeriodChange?: (p: LeaderboardPeriod) => void; onOpenSettings?: () => void } = {}) =>
  render(<LeaderboardView period="week" onPeriodChange={extra.onPeriodChange ?? jest.fn()} state={state} onOpenSettings={extra.onOpenSettings} />);

describe('LeaderboardView', () => {
  it('shows the podium, the rows below it and highlights your own row', async () => {
    await show({ kind: 'ok', board: board() });
    expect(screen.getByLabelText('First place')).toBeTruthy();
    expect(screen.getByLabelText('Second place')).toBeTruthy();
    expect(screen.getByLabelText('Third place')).toBeTruthy();
    expect(screen.getByLabelText('1. Sam, Athlete, 990 XP this week')).toBeTruthy();
    expect(screen.getByLabelText('4. Athlete #AAA4, Athlete, 960 XP this week')).toBeTruthy();
    expect(screen.getByLabelText('5. You, Athlete #AAA5, Athlete, 950 XP this week')).toBeTruthy();
    expect(screen.getByText('Athlete #AAA5 (you)')).toBeTruthy();
    expect(screen.queryByText('Your place')).toBeNull();
    expect(screen.getByText(/5 people earned XP this week/)).toBeTruthy();
  });

  it('adds your own place after the list when you are outside it', async () => {
    const b = board({
      entries: [entry(1), entry(2), entry(3), entry(4)],
      you: { position: 51, name: 'Athlete #ZZZ9', anonymous: true, points: 12, level: 2, rank: 'Rookie', rankLabel: 'Rookie', prestige: null, optedIn: false },
      totalRanked: 80,
    });
    await show({ kind: 'ok', board: b });
    expect(screen.getByText('Your place')).toBeTruthy();
    expect(screen.getByLabelText('51. You, Athlete #ZZZ9, Rookie, 12 XP this week')).toBeTruthy();
  });

  it('says when you have no points yet, and when nobody does', async () => {
    const none = board({ entries: [], totalRanked: 0, you: { ...board().you, position: null, points: 0 } });
    await show({ kind: 'ok', board: none });
    expect(screen.getByText('No one on the board yet')).toBeTruthy();
    expect(screen.getByText('Earn XP this week to join the board.')).toBeTruthy();
  });

  it('shows a champion label for a prestige athlete', async () => {
    const b = board({ entries: [entry(1, { rank: 'Champion', rankLabel: 'Champion 3', prestige: 3 })] });
    await show({ kind: 'ok', board: b });
    expect(screen.getByLabelText('1. Athlete #AAA1, Champion 3, 990 XP this week')).toBeTruthy();
  });

  it('is friendly on an older server, offers a retry on errors and a loading state', async () => {
    const { unmount } = await show({ kind: 'unsupported' });
    expect(screen.getByText('Leaderboards are coming soon')).toBeTruthy();
    await unmount();
    const onRetry = jest.fn();
    const err = await show({ kind: 'error', onRetry });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await err.unmount();
    await show({ kind: 'loading' });
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('switches the period and opens settings from the privacy note', async () => {
    const onPeriodChange = jest.fn();
    const onOpenSettings = jest.fn();
    await show({ kind: 'ok', board: board() }, { onPeriodChange, onOpenSettings });
    await fireEvent.press(screen.getByRole('radio', { name: 'Today' }));
    expect(onPeriodChange).toHaveBeenCalledWith('today');
    expect(screen.getByText(/Athlete #code/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose how you appear' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
