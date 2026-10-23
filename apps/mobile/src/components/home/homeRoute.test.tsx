import { fireEvent, render, screen } from '@testing-library/react-native';
import Home from '@/app/(tabs)/index';

/** The Home route: pull-to-refresh retries the coach tip along with the page. */

const mockHomeRefetch = jest.fn();
const mockCoachRefetch = jest.fn();
let mockCoachMode = 'real_ai';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock('@/components/home/HomeView', () => {
  const { Pressable, Text: MockText } = jest.requireActual('react-native');
  return {
    HomeView: ({ onRefresh }: { onRefresh: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={onRefresh} style={{ minHeight: 44 }}>
        <MockText>Refresh</MockText>
      </Pressable>
    ),
  };
});
jest.mock('@/lib/useSteps', () => ({ useSteps: () => ({ status: 'unavailable' }) }));
jest.mock('@/components/pro/ProWelcome', () => ({ ProWelcomeHost: () => null }));
jest.mock('@/lib/queries', () => ({
  useHome: () => ({ data: { coach: { mode: mockCoachMode } }, isError: false, isRefetching: false, error: null, refetch: mockHomeRefetch }),
  useAddWater: () => ({ mutate: jest.fn(), isPending: false }),
  useUndoWater: () => ({ mutate: jest.fn(), isPending: false }),
  useCoachInsight: () => ({ data: undefined, isPending: false, isError: true, fetchStatus: 'idle', refetch: mockCoachRefetch }),
  useRefetchOnFocus: () => undefined,
  useTodayWorkout: () => ({ data: undefined, isError: true }),
  useActiveSession: () => ({ data: null }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCoachMode = 'real_ai';
  mockHomeRefetch.mockResolvedValue(undefined);
  mockCoachRefetch.mockResolvedValue(undefined);
});

describe('Home pull-to-refresh', () => {
  it('refetches the page and the coach tip', async () => {
    await render(<Home />);
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(mockHomeRefetch).toHaveBeenCalledTimes(1);
    expect(mockCoachRefetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the coach alone when coaching is unavailable', async () => {
    mockCoachMode = 'unavailable';
    await render(<Home />);
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(mockHomeRefetch).toHaveBeenCalledTimes(1);
    expect(mockCoachRefetch).not.toHaveBeenCalled();
  });
});
