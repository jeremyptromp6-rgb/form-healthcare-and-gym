import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Achievement, BodyQuest, Celebration, PersonalRecord, Streaks } from '@/lib/types';
import { BodyQuestView } from './BodyQuestView';
import { CelebrationCard, celebrationCopy } from './Celebrations';
import { AchievementList, RecordsList, sortAchievements, StreaksGrid } from './RecognitionViews';

const insufficient = (needs: BodyQuest['stats']['strength']['needs']) => ({ value: null, status: 'insufficient_data' as const, sample: 0, needs, detail: {} });
const ok = (value: number) => ({ value, status: 'ok' as const, sample: 40, needs: null, detail: {} });

function bodyQuest(over: Partial<BodyQuest> = {}): BodyQuest {
  return {
    engineVersion: 1,
    asOf: '2026-09-30',
    stage: 'foundation',
    highestStage: 'foundation',
    overall: 46,
    stats: { strength: insufficient('verify_same_exercise_twice'), muscle: ok(38), endurance: ok(52), mobility: ok(91), form: ok(86), consistency: ok(100) },
    statsWithData: 5,
    historyWeeks: 3,
    next: {
      stage: 'builder',
      requirements: [
        { kind: 'overall', needed: 40, have: 46, met: true },
        { kind: 'stats', needed: 4, have: 5, met: true },
        { kind: 'weeks', needed: 4, have: 3, met: false },
      ],
    },
    snapshots: [
      { weekStart: '2026-09-07', asOf: '2026-09-13', stage: 'starter', overall: null, stats: {} as never, engineVersion: 1 },
      { weekStart: '2026-09-14', asOf: '2026-09-20', stage: 'foundation', overall: 41, stats: {} as never, engineVersion: 1 },
    ],
    ...over,
  };
}

const achievement = (over: Partial<Achievement>): Achievement => ({
  id: 'first_workout',
  title: 'First Workout',
  description: 'Finish your first workout.',
  xpReward: 20,
  requires: null,
  state: 'locked',
  progress: 0,
  target: 1,
  unlockedAt: null,
  ...over,
});

describe('Body Quest', () => {
  it('shows the stage, every stat honestly, what the next stage needs, and weekly history', async () => {
    await render(<BodyQuestView bodyQuest={bodyQuest()} />);
    expect(screen.getByLabelText('Stage 2 of 5: Foundation')).toBeTruthy();
    expect(screen.getByText('Overall 46 of 100')).toBeTruthy();
    expect(screen.getByLabelText('Strength: not enough data yet')).toBeTruthy();
    expect(screen.getByText('Verify the same exercise with the camera a week apart.')).toBeTruthy();
    expect(screen.getByLabelText('Form: 86 out of 100')).toBeTruthy();
    expect(screen.getByLabelText('4 weeks of training (now 3)')).toBeTruthy();
    expect(screen.getByLabelText('Overall score of 40 or more (now 46), done')).toBeTruthy();
    expect(screen.getByLabelText('Week of 2026-09-14: Foundation, overall 41')).toBeTruthy();
    expect(screen.getByText(/never your weight or how you look/)).toBeTruthy();
  });

  it('is honest for a brand-new user', async () => {
    const none = { strength: insufficient('verify_same_exercise_twice'), muscle: insufficient('train_for_a_week'), endurance: insufficient('train_for_a_week'), mobility: insufficient('verify_more_reps'), form: insufficient('verify_more_reps'), consistency: insufficient('train_for_a_week') };
    await render(<BodyQuestView bodyQuest={bodyQuest({ stage: 'starter', highestStage: 'starter', overall: null, statsWithData: 0, stats: none, snapshots: [] })} />);
    expect(screen.getByText('Overall score appears once 3 stats are measured')).toBeTruthy();
    expect(screen.getAllByText('Measured after your first week of training.')).toHaveLength(3);
    expect(screen.getByText(/A snapshot is saved at the end of every week/)).toBeTruthy();
  });

  it('remembers a higher stage reached before, without hiding the current one', async () => {
    await render(<BodyQuestView bodyQuest={bodyQuest({ stage: 'foundation', highestStage: 'builder' })} />);
    expect(screen.getByText(/You've reached Builder before/)).toBeTruthy();
  });
});

describe('achievements', () => {
  const list = [
    achievement({ id: 'form_master', title: 'Form Master', description: 'Do 100 verified reps with great form (85+).', requires: 'camera', state: 'in_progress', progress: 40, target: 100, xpReward: 75 }),
    achievement({ state: 'unlocked', progress: 1, unlockedAt: '2026-09-28T10:00:00Z' }),
    achievement({ id: 'nutrition_on_track', title: 'Nutrition On Track', description: 'Finish 7 days within 10% of your calorie target.', requires: 'nutrition_targets', target: 7, xpReward: 60 }),
  ];

  it('shows locked, in-progress and unlocked states from real progress', async () => {
    await render(<AchievementList achievements={list} />);
    expect(screen.getByLabelText(/First Workout: Finish your first workout\. unlocked on/)).toBeTruthy();
    expect(screen.getByLabelText('Form Master: Do 100 verified reps with great form (85+). 40 of 100. 75 XP')).toBeTruthy();
    expect(screen.getByText('Needs your body profile for targets')).toBeTruthy();
  });

  it('puts unlocked first, then the closest to unlocking', () => {
    expect(sortAchievements(list).map((a) => a.id)).toEqual(['first_workout', 'form_master', 'nutrition_on_track']);
  });
});

describe('streaks and records', () => {
  const streaks: Streaks = {
    workout: { current: 6, longest: 9, activeToday: true, restDaysRemaining: 2, startDate: '2026-09-21', plannedRestDays: 2 },
    nutrition: { current: 0, longest: 0, activeToday: false, restDaysRemaining: null, startDate: null, available: false },
    quest: { current: 2, longest: 4, activeToday: true, restDaysRemaining: 0, startDate: '2026-09-29' },
    weekly: { current: 3, longest: 3, metThisWeek: false, startWeek: '2026-09-14', target: 3 },
  };

  it('shows all four streaks with rest built in, and is honest when nutrition is not tracked', async () => {
    await render(<StreaksGrid streaks={streaks} />);
    expect(screen.getByLabelText('Training: 6 days. Rest days in your plan keep it going. Best 9')).toBeTruthy();
    expect(screen.getByLabelText('Weeks on plan: 3 weeks. 3 days a week. Best 3')).toBeTruthy();
    expect(screen.getByText('Set your body profile to track this')).toBeTruthy();
  });

  it('lists records across all training first, then per exercise, marking new ones', async () => {
    const records: PersonalRecord[] = [
      { exerciseId: 'squat', exerciseName: 'Squat', kind: 'max_load', label: 'Heaviest weight', unit: 'kg', direction: 'higher', value: 65, display: '65 kg', previous: 60, localDate: '2026-09-29', recent: true },
      { exerciseId: null, exerciseName: null, kind: 'longest_streak', label: 'Longest training streak', unit: 'days', direction: 'higher', value: 9, display: '9 days', previous: 6, localDate: '2026-09-20', recent: false },
    ];
    await render(<RecordsList records={records} />);
    expect(screen.getByText('Longest training streak')).toBeTruthy();
    expect(screen.getByText(/Across all training/)).toBeTruthy();
    expect(screen.getByText('65 kg')).toBeTruthy();
    expect(screen.getAllByText('New')).toHaveLength(1);
  });
});

describe('celebrations', () => {
  const at = '2026-09-30T10:00:00Z';
  const all: Celebration[] = [
    { id: 1, kind: 'achievement', at, payload: { achievementId: 'first_workout', title: 'First Workout', description: 'Finish your first workout.', xpReward: 20 } },
    { id: 2, kind: 'personal_record', at, payload: { workoutId: 'w', exerciseId: 'squat', exerciseName: 'Squat', kind: 'max_load', label: 'Heaviest weight', display: '65 kg', previousDisplay: '60 kg', rewarded: true } },
    { id: 3, kind: 'streak', at, payload: { streak: 'workout', length: 7, startDate: '2026-09-24' } },
    { id: 4, kind: 'body_quest', at, payload: { stage: 'builder', overall: 52 } },
  ];

  it('says what happened, from the event, and never pushes past rest', () => {
    expect(celebrationCopy(all[0]!)).toMatchObject({ overline: 'Achievement unlocked', title: 'First Workout', value: '+20 XP' });
    expect(celebrationCopy(all[1]!)).toMatchObject({ overline: 'New personal record', title: 'Squat · Heaviest weight', value: '65 kg', body: expect.stringContaining('Up from 60 kg') });
    const streak = celebrationCopy(all[2]!);
    expect(streak.title).toBe('7-day training streak');
    expect(streak.body).toMatch(/Rest days included/);
    expect(celebrationCopy(all[3]!)).toMatchObject({ overline: 'Body Quest', title: 'Builder reached' });
  });

  it('steps through several celebrations and dismisses with one tap', async () => {
    const onDone = jest.fn();
    const { rerender } = await render(<CelebrationCard celebration={all[0]!} position={{ index: 0, total: 2 }} onDone={onDone} />);
    expect(screen.getByLabelText('Achievement unlocked: First Workout. Finish your first workout. Plus 20 XP.')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    await rerender(<CelebrationCard celebration={all[3]!} position={{ index: 1, total: 2 }} onDone={onDone} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Nice' }));
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
