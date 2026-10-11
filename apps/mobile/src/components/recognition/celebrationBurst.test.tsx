import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { Celebration } from '@/lib/types';
import { colors } from '@/theme/tokens';
import { CelebrationCard, CelebrationHost } from './Celebrations';

// The shared test setup turns reduced motion on; these tests flip it per case.
let mockReduce = true;
jest.mock('@/lib/a11y', () => ({ useReducedMotion: () => mockReduce }));

const at = '2026-09-30T10:00:00Z';
const record: Celebration = {
  id: 12,
  kind: 'personal_record',
  at,
  payload: { workoutId: 'w1', exerciseId: 'squat', exerciseName: 'Squat', kind: 'max_load', label: 'Heaviest weight', display: '45 kg', previousDisplay: '40 kg', rewarded: true },
};
const mockMutate = jest.fn();

jest.mock('@/lib/queries', () => ({
  useCelebrations: () => ({ data: { celebrations: [mockRecord()] } }),
  useMarkCelebrationsSeen: () => ({ mutate: mockMutate }),
}));
const mockRecord = () => record;

describe('Celebration burst', () => {
  afterEach(() => {
    mockReduce = true;
  });

  it('is skipped under reduced motion: a static card, no confetti pieces', async () => {
    mockReduce = true;
    await render(<CelebrationCard celebration={record} onDone={jest.fn()} />);
    expect(screen.queryAllByTestId('confetti-piece', { includeHiddenElements: true })).toHaveLength(0);
    expect(screen.getByText('New personal record')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nice' })).toBeTruthy();
  });

  it('throws a burst of at most 12 pieces when motion is allowed', async () => {
    mockReduce = false;
    await render(<CelebrationCard celebration={record} onDone={jest.fn()} />);
    const pieces = screen.getAllByTestId('confetti-piece', { includeHiddenElements: true });
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.length).toBeLessThanOrEqual(12);
  });

  it('paints the scrim with the theme token, not a hard-coded colour', async () => {
    await render(<CelebrationHost />);
    expect(StyleSheet.flatten(screen.getByTestId('celebration-scrim').props.style).backgroundColor).toBe(colors.scrim);
  });
});
