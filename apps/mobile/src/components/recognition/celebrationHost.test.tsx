import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Celebration } from '@/lib/types';
import { CelebrationHost } from './Celebrations';

const at = '2026-09-30T10:00:00Z';
const mockFeed: Celebration[] = [
  { id: 11, kind: 'achievement', at, payload: { achievementId: 'first_rep', title: 'First Rep', description: 'Complete your first camera-verified rep.', xpReward: 10 } },
  { id: 12, kind: 'personal_record', at, payload: { workoutId: 'w1', exerciseId: 'squat', exerciseName: 'Squat', kind: 'max_load', label: 'Heaviest weight', display: '45 kg', previousDisplay: '40 kg', rewarded: true } },
  { id: 13, kind: 'achievement', at, payload: { achievementId: 'pr_breaker', title: 'PR Breaker', description: 'Beat one of your personal records.', xpReward: 40 } },
];
const mockMutate = jest.fn();

jest.mock('@/lib/queries', () => ({
  useCelebrations: () => ({ data: { celebrations: mockFeed } }),
  useMarkCelebrationsSeen: () => ({ mutate: mockMutate }),
}));

describe('CelebrationHost', () => {
  it('shows each pending celebration once, counts the run steadily, and marks each seen as it is dismissed', async () => {
    await render(<CelebrationHost />);
    expect(screen.getByText('First Rep')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(mockMutate).toHaveBeenLastCalledWith([11]);
    expect(screen.getByText('Squat · Heaviest weight')).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('3 of 3')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Nice' }));
    expect(mockMutate).toHaveBeenLastCalledWith([13]);
    expect(screen.queryByText('PR Breaker')).toBeNull();
  });

  it('can leave some celebrations to another screen', async () => {
    await render(<CelebrationHost exclude={(c) => c.kind === 'personal_record'} />);
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });
});
