import { act, fireEvent, render, screen } from '@testing-library/react-native';
import EditSection from '@/app/(tabs)/profile/edit/[section]';
import ProfileHub from '@/app/(tabs)/profile/index';
import { ApiError } from '@/lib/api';

/** The profile hub shows a failed catalog instead of spinning forever; the edit screen cancels its pending "back" when you leave. */

const mockBack = jest.fn();
const mockCatalogRefetch = jest.fn();
let mockCatalog: Record<string, unknown> = {};

const mockQuery = (data: unknown) => ({ data, isError: false, isPending: false, isRefetching: false, error: null, refetch: jest.fn() });
const mockMe = { user: { id: 'u1', email: 'a@b.co' }, profile: null, hasPhoto: false, onboarding: { remaining: [] }, settings: { units: 'metric' } };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), back: () => mockBack() },
  useLocalSearchParams: () => ({ section: 'goal' }),
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/features', () => ({ useFeature: () => ({ loading: false, available: true }) }));
jest.mock('@/components/profile/sections', () => {
  const { Pressable, Text: MockText } = jest.requireActual('react-native');
  const Section = ({ onSaved }: { onSaved: () => void }) => (
    <Pressable accessibilityRole="button" accessibilityLabel="Save" onPress={onSaved} style={{ minHeight: 44 }}>
      <MockText>Save</MockText>
    </Pressable>
  );
  return { GoalSection: Section, BodySection: Section, TrainingSection: Section, NutritionSection: Section, HabitsSection: Section, GOAL_ICONS: {} };
});
jest.mock('@/lib/queries', () => ({
  useMe: () => mockQuery(mockMe),
  useCatalog: () => mockCatalog,
  useProgress: () => mockQuery(undefined),
  useRecords: () => mockQuery(undefined),
  useWorkouts: () => mockQuery(undefined),
  useWeightHistory: () => mockQuery(undefined),
  useBodyQuest: () => mockQuery(undefined),
  useAchievements: () => mockQuery(undefined),
  useProfileSummary: () => mockQuery(undefined),
  useRefetchOnFocus: () => undefined,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCatalog = { ...mockQuery({ goals: [] }) };
});

describe('Profile hub', () => {
  it('shows an error with a retry when the catalog fails, not a spinner', async () => {
    mockCatalog = { data: undefined, isError: true, isPending: false, error: new ApiError('network', 'network', "Can't reach FORM.", null, true), refetch: mockCatalogRefetch };
    await render(<ProfileHub />);
    await fireEvent.press(screen.getByRole('button', { name: /try again|retry/i }));
    expect(mockCatalogRefetch).toHaveBeenCalledTimes(1);
  });

  it('still loads while the catalog is on its way', async () => {
    mockCatalog = { data: undefined, isError: false, isPending: true, error: null, refetch: jest.fn() };
    await render(<ProfileHub />);
    expect(screen.queryByRole('button', { name: /try again|retry/i })).toBeNull();
  });
});

describe('Edit profile section', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('goes back shortly after saving', async () => {
    await render(<EditSection />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(mockBack).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('does not go back a second time when you already left before the delay ended', async () => {
    const { unmount } = await render(<EditSection />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(mockBack).not.toHaveBeenCalled();
  });
});
