import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ChartModel, ProgressAnalytics, Trend } from '@/lib/types';
import { AnalyticsView } from './AnalyticsView';
import { Chart, chartSummary, TrendBadge, trendChange } from './Chart';

const trend = (over: Partial<Trend> = {}): Trend => ({ direction: 'improving', movement: 'up', from: 60, to: 70, change: 10, changePercent: 16.7, points: 5, spanDays: 14, reason: null, ...over });
const chart = (over: Partial<ChartModel> = {}): ChartModel => ({
  id: 'strength',
  title: 'Squat — estimated 1RM',
  unit: 'kg',
  trendUnit: 'kg',
  kind: 'line',
  granularity: 'day',
  points: [
    { key: '2026-09-07', value: 60, estimated: false, partial: false },
    { key: '2026-09-08', value: null, estimated: false, partial: false },
    { key: '2026-09-14', value: 65, estimated: false, partial: false },
    { key: '2026-09-21', value: 70, estimated: true, partial: true },
  ],
  target: null,
  trend: trend(),
  state: 'partial',
  ...over,
});
const none = (): ChartModel => chart({ points: [{ key: '2026-09-30', value: null, estimated: false, partial: true }], trend: trend({ direction: 'insufficient_data', movement: null, change: null, changePercent: null, from: null, to: null, points: 0, reason: 'too_few_points' }), state: 'no_data' });

function analytics(over: Partial<ProgressAnalytics> = {}): ProgressAnalytics {
  const sec = <T,>(data: T, available = true, focus = false, interpretation: string | null = 'Trending up over this range.') => ({ available, focus, interpretation, data });
  return {
    range: { days: 30, from: '2026-09-01', to: '2026-09-30', timezone: 'Europe/London', granularity: 'day' },
    units: 'metric',
    goal: { primary: 'get_stronger' },
    order: ['strength', 'form', 'prs', 'consistency', 'rom', 'verified_reps', 'nutrition', 'weight', 'xp', 'body_quest', 'quests'],
    strength: sec(
      {
        exercises: [
          { exerciseId: 'squat', name: 'Barbell Back Squat', sessions: 5, measure: 'estimated_1rm' },
          { exerciseId: 'push_up', name: 'Push-up', sessions: 2, measure: 'verified_reps' },
        ],
        selected: { exerciseId: 'squat', name: 'Barbell Back Squat', measure: 'estimated_1rm', chart: chart(), best: 70 },
      },
      true,
      true,
      'Trending up over this range. This is one of the clearest signals for your goal.',
    ),
    form: sec({ chart: chart({ id: 'form', title: 'Form score', unit: 'score', trendUnit: 'score' }), averageScore: 91, reps: 25 }, true, true),
    rom: sec({ chart: chart({ id: 'rom', title: 'Range of motion', unit: '%', trendUnit: '%', trend: trend({ direction: 'stable', movement: 'flat' }) }), averagePercent: 97, reps: 25 }),
    verifiedReps: sec({ chart: chart({ id: 'verified_reps', kind: 'bar', unit: 'reps', trendUnit: 'reps' }), total: 25 }),
    consistency: sec({ chart: chart({ id: 'consistency', kind: 'bar', unit: 'days', trendUnit: '%', granularity: 'week', target: { value: 3, label: 'Your plan' } }), trainingDays: 6, plannedDays: 12.4, adherencePercent: 48, workouts: 6, minutes: 240 }),
    nutrition: sec({ kcalChart: chart({ id: 'kcal', kind: 'bar', unit: 'kcal', trendUnit: '%' }), proteinChart: chart({ id: 'protein', kind: 'bar', unit: 'g', trendUnit: '%' }), daysLogged: 12, daysOnTarget: 5, daysMeetingProtein: 4, daysBelowSafeMinimum: 1, estimatedPercent: 40, measuredPercent: 60, hasTargets: true }),
    weight: sec({ chart: chart({ id: 'weight', unit: 'lb', trendUnit: 'lb', trend: trend({ direction: 'declining', movement: 'down', change: -2.2, changePercent: -1.2 }) }), latest: 181.2, latestDate: '2026-09-30', entries: 4 }, true, false, 'Weight is moving away from your goal\'s direction over this range.'),
    xp: sec({ chart: chart({ id: 'xp', unit: 'xp', trendUnit: 'xp' }), earned: 640, lost: 10, levelUps: [{ level: 5, rank: 'Starter', date: '2026-09-20' }], level: 5, rank: 'Starter', resets: [] }),
    prs: sec({ chart: none(), records: [{ date: '2026-09-21', exercise: 'Barbell Back Squat', label: 'Heaviest weight', display: '70 kg', previousDisplay: '65 kg', beaten: true }, { date: '2026-09-07', exercise: 'Push-up', label: 'Most verified reps', display: '12 reps', previousDisplay: null, beaten: false }] }, true, true, null),
    quests: sec({ completed: 3, daily: 2, weekly: 1, history: [{ title: 'Log 3 meals', cadence: 'daily', period: '2026-09-29', xpReward: 10 }] }, true, false, null),
    bodyQuest: sec({ chart: chart({ id: 'body_quest', unit: 'score', trendUnit: 'score', granularity: 'week' }), stage: 'foundation', overall: 46, stageChanges: [] }),
    achievements: { unlocked: [{ id: 'pr_breaker', title: 'PR Breaker', date: '2026-09-21' }] },
    streaks: { workout: { current: 2, longest: 6 }, weekly: { current: 1, longest: 2 }, nutrition: { current: 0, longest: 3, available: true }, quest: { current: 1, longest: 4 } },
    summaries: {
      daily: null,
      weekly: [
        { key: '2026-09-21', from: '2026-09-21', to: '2026-09-27', partial: false, hasData: true, trainingDays: 3, workouts: 3, minutes: 120, verifiedReps: 15, averageForm: 92, daysLogged: 5, averageKcal: 2300, averageProteinG: 140, xpEarned: 210, prs: 1 },
        { key: '2026-09-28', from: '2026-09-28', to: '2026-09-30', partial: true, hasData: false, trainingDays: 0, workouts: 0, minutes: 0, verifiedReps: 0, averageForm: null, daysLogged: 0, averageKcal: null, averageProteinG: null, xpEarned: 0, prs: 0 },
      ],
      monthly: null,
    },
    generatedAt: '2026-09-30T12:00:00Z',
    ...over,
  };
}

describe('Chart', () => {
  it('says plainly when there is nothing logged', async () => {
    await render(<Chart chart={none()} />);
    expect(screen.getByText('Nothing logged in this range yet.')).toBeTruthy();
  });

  it('summarises the series for screen readers and explains estimates and too-little data', async () => {
    const c = chart({ state: 'insufficient_data', trend: trend({ direction: 'insufficient_data', reason: 'too_short_span' }) });
    await render(<Chart chart={c} />);
    expect(screen.getByLabelText(/Squat — estimated 1RM: 3 of 4 days with data, from 60 kg on .* to 70 kg on .*\. Trend: Not enough data\./)).toBeTruthy();
    expect(screen.getByText('Hollow = includes estimates')).toBeTruthy();
    expect(screen.getByText('Not enough time covered yet to show a trend.')).toBeTruthy();
    expect(chartSummary(none())).toBe('Squat — estimated 1RM: nothing logged in this range.');
  });

  it('labels trends with their direction and change in the right unit', async () => {
    expect(trendChange(trend(), 'kg')).toBe('+10 kg (+16.7%)');
    expect(trendChange(trend({ change: -4, changePercent: -5 }), '%')).toBe('−4 pts');
    expect(trendChange(trend({ movement: 'flat' }), 'kg')).toBeNull();
    await render(<TrendBadge trend={trend({ direction: 'declining', movement: 'down', change: -2.2, changePercent: -1.2 })} unit="lb" />);
    expect(screen.getByLabelText('Trend: Declining, −2.2 lb (−1.2%)')).toBeTruthy();
  });
});

describe('AnalyticsView', () => {
  const handlers = () => ({ onRange: jest.fn(), onExercise: jest.fn() });

  it('puts goal-relevant sections first and marks them', async () => {
    await render(<AnalyticsView analytics={analytics()} range={30} exercise={null} {...handlers()} />);
    expect(screen.getAllByText('Key for your goal').length).toBe(3);
    expect(screen.getByText(/This is one of the clearest signals for your goal/)).toBeTruthy();
    expect(screen.getByText(/your time zone \(Europe\/London\)/)).toBeTruthy();
  });

  it('switches range and exercise', async () => {
    const h = handlers();
    await render(<AnalyticsView analytics={analytics()} range={30} exercise={null} {...h} />);
    await fireEvent.press(screen.getByRole('radio', { name: '90 days' }));
    expect(h.onRange).toHaveBeenCalledWith(90);
    await fireEvent.press(screen.getByRole('button', { name: 'Push-up' }));
    expect(h.onExercise).toHaveBeenCalledWith('push_up');
  });

  it('shows estimated vs weighed food, the safe-minimum warning, weight in the user unit, and records vs baselines', async () => {
    await render(<AnalyticsView analytics={analytics()} range={30} exercise={null} {...handlers()} />);
    expect(screen.getByText(/60% of calories weighed, 40% estimated/)).toBeTruthy();
    expect(screen.getByText(/1 day below your safe minimum — eating enough comes first/)).toBeTruthy();
    expect(screen.getByText(/Latest: 181.2 lb/)).toBeTruthy();
    expect(screen.getByText(/first record/)).toBeTruthy();
    expect(screen.getByText(/\(was 65 kg\)/)).toBeTruthy();
    expect(screen.getByText(/doesn't estimate body composition or compare you with other people/)).toBeTruthy();
  });

  it('is honest about missing sections and unfinished periods', async () => {
    const empty = analytics({
      strength: { available: false, focus: true, interpretation: null, data: { exercises: [], selected: null } },
      nutrition: { ...analytics().nutrition, available: false },
    });
    await render(<AnalyticsView analytics={empty} range={30} exercise={null} {...handlers()} />);
    expect(screen.getByText(/Strength trends come from camera-verified sets/)).toBeTruthy();
    expect(screen.getByText('No food logged in this range.')).toBeTruthy();
    expect(screen.getByText('so far')).toBeTruthy();
    expect(screen.getByText('Nothing logged')).toBeTruthy();
  });
});

describe('Pro-locked sections', () => {
  it('show what the section is and open FORM Pro — never a chart, since the server sent no data', async () => {
    const onPro = jest.fn();
    const base = analytics();
    const locked = {
      ...base,
      form: { ...base.form, available: false, interpretation: null, locked: { feature: 'ADVANCED_FORM_ANALYSIS' as const, title: 'Form intelligence', pro: 'Form history per exercise.' }, data: { chart: none(), averageScore: null, reps: 0 } },
    };
    await render(<AnalyticsView analytics={locked} range={30} exercise={null} onRange={jest.fn()} onExercise={jest.fn()} onPro={onPro} />);
    expect(screen.getByText('Form intelligence')).toBeTruthy();
    expect(screen.queryByText('Average form')).toBeNull();
    await fireEvent.press(screen.getAllByRole('button', { name: 'See FORM Pro' })[0]!);
    expect(onPro).toHaveBeenCalledWith('ADVANCED_FORM_ANALYSIS');
  });
});
