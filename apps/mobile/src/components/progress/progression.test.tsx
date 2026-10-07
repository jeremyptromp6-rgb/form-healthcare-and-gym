import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Progress, XpLedgerEntry } from '@/lib/types';
import { ConsistencyCard, LevelHero, LevelUpBanner, levelLine, RankLadder, ResetNotice, streakCaption, XpHistory } from './ProgressionViews';

const LADDER = [
  { name: 'Rookie', minLevel: 1, xpRequired: 0 },
  { name: 'Starter', minLevel: 5, xpRequired: 1 },
  { name: 'Athlete', minLevel: 10, xpRequired: 2 },
  { name: 'Iron', minLevel: 20, xpRequired: 3 },
  { name: 'Elite', minLevel: 30, xpRequired: 4 },
  { name: 'Master', minLevel: 45, xpRequired: 5 },
  { name: 'Champion', minLevel: 60, xpRequired: 6 },
];

function progress(overrides: Partial<Progress> = {}): Progress {
  return {
    totalXp: 26_000,
    level: 13,
    rank: 'Athlete',
    xpIntoLevel: 2450,
    xpForNextLevel: 3000,
    fractionToNext: 2450 / 3000,
    provisionalXp: 0,
    rankLadder: LADDER,
    lifetimeXp: 31_200,
    xpSources: { workouts: 20_000, nutrition: 3000, quests: 3100, achievements: 0, decay: -100, corrections: 0 },
    nutritionXpEnabled: true,
    streak: { current: 4, longest: 9, activeToday: true, restDaysRemaining: 2 },
    consistency: { trainingDaysPerWeek: 3, decayPerMissedDay: 10, resetAfterDays: 5, trainWithinDays: 6, recovering: false, missedThisWeek: 0 },
    lastReset: null,
    recentLevelUp: null,
    ...overrides,
  } as Progress;
}

describe('progression views', () => {
  it('formats the level line exactly as specified', () => {
    expect(levelLine(progress())).toBe('LEVEL 13 — 2,450 / 3,000 XP');
    expect(levelLine({ level: 100, xpIntoLevel: 0, xpForNextLevel: 0 })).toBe('LEVEL 100 — max level');
  });

  it('shows the level hero with rank emblem, next rank and all-time XP', async () => {
    await render(<LevelHero progress={progress()} />);
    expect(screen.getByText('Level 13')).toBeTruthy();
    expect(screen.getByText('LEVEL 13 — 2,450 / 3,000 XP')).toBeTruthy();
    expect(screen.getByLabelText('Athlete rank')).toBeTruthy();
    expect(screen.getByText('Iron at level 20')).toBeTruthy();
    expect(screen.getByText('31,200 XP all time')).toBeTruthy();
  });

  it('marks reached ranks and the current one on the ladder', async () => {
    await render(<RankLadder progress={progress()} />);
    expect(screen.getByLabelText('Rookie, from level 1, reached')).toBeTruthy();
    expect(screen.getByLabelText('Athlete, from level 10, your rank')).toBeTruthy();
    expect(screen.getByLabelText('Champion, from level 60')).toBeTruthy();
  });

  it('explains how to keep progress, with urgency only when it is close', async () => {
    const { rerender } = await render(<ConsistencyCard progress={progress()} />);
    expect(screen.getByText('Train within 6 days to keep Level 13')).toBeTruthy();
    expect(screen.getByText(/Rest days in your plan never cost anything; a missed training day costs 10 XP/)).toBeTruthy();
    expect(screen.getByText(/your workouts, records and history always stay/)).toBeTruthy();

    await rerender(<ConsistencyCard progress={progress({ consistency: { ...progress().consistency, trainWithinDays: 1, missedThisWeek: 2 } })} />);
    expect(screen.getByText('Train today to keep Level 13')).toBeTruthy();
    expect(screen.getByText('2 missed days this week.')).toBeTruthy();

    await rerender(<ConsistencyCard progress={progress({ consistency: { ...progress().consistency, recovering: true } })} />);
    expect(screen.getByText('Recovering — take the time you need')).toBeTruthy();

    await rerender(<ConsistencyCard progress={progress({ consistency: { ...progress().consistency, trainWithinDays: null } })} />);
    expect(screen.getByText('Your first workout starts your progress')).toBeTruthy();

    // Right after a reset there is no XP left to lose, so no countdown — just the way back.
    const reset = { date: '2026-09-24', previousLevel: 3, previousRank: 'Rookie', previousActiveXp: 370, gapDays: 6 };
    await rerender(<ConsistencyCard progress={progress({ totalXp: 0, level: 1, lastReset: reset, consistency: { ...progress().consistency, trainWithinDays: 1 } })} />);
    expect(screen.getByText('Your next workout starts the climb again')).toBeTruthy();
    expect(screen.queryByText(/Train today/)).toBeNull();
  });

  it('tells the user about a recent reset and that their history is kept', async () => {
    const reset = { date: '2026-09-25', previousLevel: 8, previousRank: 'Starter', previousActiveXp: 2100, gapDays: 6 };
    const { rerender } = await render(<ResetNotice progress={progress({ lastReset: reset })} today="2026-09-30" />);
    expect(screen.getByText(/Fresh start: your level reset on .* after 6 days without training \(you were Level 8 · Starter\)/)).toBeTruthy();
    expect(screen.getByText(/workouts, records and full XP history are all kept/)).toBeTruthy();
    await rerender(<ResetNotice progress={progress({ lastReset: reset })} today="2026-10-20" />);
    expect(screen.queryByText(/Fresh start/)).toBeNull();
  });

  it('celebrates a level-up only when it is recent and current', async () => {
    const now = new Date('2026-09-30T12:00:00Z');
    const onDismiss = jest.fn();
    const { rerender } = await render(<LevelUpBanner progress={progress({ recentLevelUp: { level: 13, rank: 'Athlete', at: '2026-09-30T09:00:00Z' } })} now={now} onDismiss={onDismiss} />);
    expect(screen.getByText('Level 13 · Athlete')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
    // A day old, or a level since lost to a reset: no banner.
    await rerender(<LevelUpBanner progress={progress({ recentLevelUp: { level: 13, rank: 'Athlete', at: '2026-09-28T09:00:00Z' } })} now={now} />);
    expect(screen.queryByText('Level up')).toBeNull();
    await rerender(<LevelUpBanner progress={progress({ level: 1, recentLevelUp: { level: 13, rank: 'Athlete', at: '2026-09-30T09:00:00Z' } })} now={now} />);
    expect(screen.queryByText('Level up')).toBeNull();
  });

  it('lists the XP ledger with signed amounts, and has an honest empty state', async () => {
    const events: XpLedgerEntry[] = [
      { id: 3, source: 'reset', reference: '2026-09-25', kind: 'reset', xp: 0, localDate: '2026-09-25', label: 'Progress reset', detail: {}, at: '2026-09-26T00:00:00Z' },
      { id: 2, source: 'decay', reference: '2026-09-20', kind: 'decay', xp: -10, localDate: '2026-09-20', label: 'Missed training day', detail: {}, at: '2026-09-21T00:00:00Z' },
      { id: 1, source: 'workout', reference: 'w1', kind: 'award', xp: 38, localDate: '2026-09-18', label: 'Workout', detail: {}, at: '2026-09-18T10:00:00Z' },
    ];
    const { rerender } = await render(<XpHistory events={events} />);
    expect(screen.getByLabelText('Workout, plus 38 XP, 2026-09-18')).toBeTruthy();
    expect(screen.getByText('+38 XP')).toBeTruthy();
    expect(screen.getByText('−10 XP')).toBeTruthy();
    expect(screen.getByText('Progress reset')).toBeTruthy();
    await rerender(<XpHistory events={[]} />);
    expect(screen.getByText(/Your XP history appears here/)).toBeTruthy();
  });

  it('describes the streak in plain words', () => {
    expect(streakCaption(progress())).toBe('Trained today · rest days protect your streak');
    expect(streakCaption(progress({ streak: { current: 0, longest: 0, activeToday: false, restDaysRemaining: 0 } }))).toBe('Log a workout to start a streak');
  });
});
