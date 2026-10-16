import { fireEvent, render, screen } from '@testing-library/react-native';
import { rankChart, xpChange, xpTimeline } from '@/lib/rankHistory';
import type { Progress, XpLedgerEntry } from '@/lib/types';
import { rankProgress, YourRankView, type StandingState } from './YourRankView';

const TODAY = '2026-10-14';
const ladder = [
  { name: 'Rookie', minLevel: 1, xpRequired: 0 },
  { name: 'Starter', minLevel: 5, xpRequired: 800 },
  { name: 'Athlete', minLevel: 10, xpRequired: 3000 },
];
const progress = (over: Partial<Progress> = {}): Progress =>
  ({ totalXp: 1000, level: 6, rank: 'Starter', xpIntoLevel: 0, xpForNextLevel: 0, fractionToNext: 0, provisionalXp: 0, rankLadder: ladder, lifetimeXp: 1000, ...over }) as Progress;
const ev = (id: number, xp: number, localDate: string, kind: XpLedgerEntry['kind'] = 'award'): XpLedgerEntry => ({ id, source: 'workout', reference: `w${id}`, kind, xp, localDate, label: 'Workout', detail: {}, at: `${localDate}T10:00:00Z` });

describe('rankProgress', () => {
  it('measures XP into the current rank and to the next one', () => {
    expect(rankProgress(progress())).toMatchObject({ into: 200, span: 2200, toNext: 2000 });
    expect(rankProgress(progress({ totalXp: 0, rank: 'Rookie' }))).toMatchObject({ into: 0, span: 800, toNext: 800 });
  });
  it('has no next rank at the top', () => {
    const top = rankProgress(progress({ totalXp: 5000, rank: 'Athlete' }));
    expect(top.next).toBeNull();
    expect(top.fraction).toBe(1);
  });
});

describe('xpTimeline', () => {
  it('walks back from today so the line ends at the badge total', () => {
    const events = [ev(3, 50, '2026-10-13'), ev(2, 100, '2026-10-10'), ev(1, 40, '2026-10-10')]; // newest first
    const { points, complete } = xpTimeline(events, 1000, 0, TODAY);
    expect(points).toEqual([
      { date: '2026-10-10', xp: 950 },
      { date: '2026-10-13', xp: 1000 },
      { date: TODAY, xp: 1000 },
    ]);
    expect(complete).toBe(true);
  });
  it('keeps today\'s food XP out of the ledger walk but in the final total', () => {
    const { points } = xpTimeline([ev(1, 100, '2026-10-13')], 600, 30, TODAY);
    expect(points).toEqual([
      { date: '2026-10-13', xp: 570 },
      { date: TODAY, xp: 600 },
    ]);
  });
  it('starts again at a fresh start and says when older history is cut off', () => {
    const reset = ev(2, -700, '2026-10-01', 'reset');
    expect(xpTimeline([ev(3, 60, '2026-10-05'), reset, ev(1, 700, '2026-09-20')], 60, 0, TODAY).points[0]).toEqual({ date: '2026-10-01', xp: 0 });
    expect(xpTimeline(Array.from({ length: 100 }, (_, i) => ev(100 - i, 1, '2026-10-13')), 500, 0, TODAY).complete).toBe(false);
  });
});

describe('rankChart', () => {
  const points = [
    { date: '2026-08-01', xp: 100 },
    { date: '2026-10-10', xp: 400 },
    { date: TODAY, xp: 500 },
  ];
  it('carries XP forward day by day inside a window', () => {
    const c = rankChart(points, '1M', TODAY);
    expect(c.kind).toBe('line');
    expect(c.points).toHaveLength(31);
    expect(c.points[0]).toMatchObject({ key: '2026-09-14', value: 100 });
    expect(c.points.at(-1)).toMatchObject({ key: TODAY, value: 500 });
    expect(xpChange(c)).toBe(400);
  });
  it('shows everything for All, thinned to a drawable size', () => {
    const c = rankChart(points, 'All', TODAY);
    expect(c.points[0]!.key).toBe('2026-08-01');
    expect(c.points.length).toBeLessThanOrEqual(120);
    expect(c.points.at(-1)!.key).toBe(TODAY);
  });
  it('reports no data when there is none', () => {
    expect(rankChart([], '1M', TODAY).state).toBe('no_data');
    expect(rankChart([{ date: TODAY, xp: 0 }], '1M', TODAY).state).toBe('insufficient_data');
  });
});

describe('YourRankView', () => {
  const view = async (standing: StandingState, events: XpLedgerEntry[] = [ev(1, 200, '2026-10-12')], over: Partial<Progress> = {}) => {
    await render(<YourRankView progress={progress(over)} standing={standing} events={events} eventsState="ok" today={TODAY} />);
  };

  it('shows the badge rank, points in the rank, XP to the next rank and the percentile', async () => {
    await view({ kind: 'ok', standing: { percentile: 12, rankedUsers: 340 } });
    expect(screen.getAllByText('Starter').length).toBeGreaterThan(0);
    expect(screen.getByText('200 / 2,200 XP')).toBeTruthy();
    expect(screen.getByText('2,000 XP to Athlete')).toBeTruthy();
    expect(screen.getByText('Top 12%')).toBeTruthy();
    expect(screen.getByText(/340 people/)).toBeTruthy();
    expect(screen.getByText('Rank over time')).toBeTruthy();
  });

  it('explains a small population instead of a number', async () => {
    await view({ kind: 'ok', standing: { percentile: null, rankedUsers: 3 } });
    expect(screen.getByText('Standing appears once more people train')).toBeTruthy();
    expect(screen.queryByText(/^Top /)).toBeNull();
  });

  it('is friendly on an older server (404) and offers a retry on other failures', async () => {
    await view({ kind: 'unsupported' });
    expect(screen.getByText('Standing is not ready yet')).toBeTruthy();
  });

  it('retries a failed standing', async () => {
    const onRetry = jest.fn();
    await view({ kind: 'error', onRetry });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('switches the range of the XP line', async () => {
    await view({ kind: 'loading' });
    await fireEvent.press(screen.getByRole('radio', { name: '3M' }));
    expect(screen.getByRole('radio', { name: '3M' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByLabelText(/^XP over time:/)).toBeTruthy();
  });
});

describe('endless Champion levels', () => {
  const champLadder = [...ladder, { name: 'Champion', minLevel: 60, xpRequired: 45_000 }];
  const champ = (over: Partial<Progress>) => progress({ rank: 'Champion', rankLadder: champLadder, prestigeAtXp: 98_500, ...over });
  const shows = async (p: Progress) => {
    await render(<YourRankView progress={p} standing={{ kind: 'unsupported' }} events={[]} eventsState="ok" today={TODAY} />);
  };

  it('below the top Champion rank still counts down to Champion 1', async () => {
    await shows(champ({ totalXp: 60_000, level: 70, prestige: null }));
    expect(screen.getByText('38,500 XP to Champion 1')).toBeTruthy();
    expect(screen.getByText('15,000 / 53,500 XP')).toBeTruthy();
  });

  it('is Champion 1 exactly at the top, with the bar to Champion 2', async () => {
    await shows(champ({ totalXp: 98_500, level: 100, prestige: 1, xpIntoStep: 0, xpForStep: 3000 }));
    expect(screen.getAllByText('Champion 1').length).toBeGreaterThan(0);
    expect(screen.getByText('3,000 XP to Champion 2')).toBeTruthy();
    expect(screen.getByLabelText('Champion 1 rank')).toBeTruthy();
    expect(screen.queryByText(/Top rank reached/)).toBeNull();
  });

  it('keeps counting past Champion 1', async () => {
    await shows(champ({ totalXp: 98_500 + 7 * 3000 + 600, level: 100, prestige: 8, xpIntoStep: 600, xpForStep: 3000 }));
    expect(screen.getAllByText('Champion 8').length).toBeGreaterThan(0);
    expect(screen.getByText('600 / 3,000 XP')).toBeTruthy();
    expect(screen.getByText('2,400 XP to Champion 9')).toBeTruthy();
  });
});

describe('Your Rank leaderboard link', () => {
  it('opens the leaderboards from the standing section when a handler is given', async () => {
    const onOpenLeaderboard = jest.fn();
    await render(<YourRankView progress={progress()} standing={{ kind: 'unsupported' }} events={[]} eventsState="ok" today={TODAY} onOpenLeaderboard={onOpenLeaderboard} />);
    await fireEvent.press(screen.getByText('Leaderboards'));
    expect(onOpenLeaderboard).toHaveBeenCalledTimes(1);
  });
});
