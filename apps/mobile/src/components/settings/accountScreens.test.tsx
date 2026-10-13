import { act, fireEvent, render, screen } from '@testing-library/react-native';
import SecurityScreen from '@/app/(tabs)/profile/security';
import SettingsScreen from '@/app/(tabs)/profile/settings';
import WeightScreen from '@/app/(tabs)/profile/weight';
import { ApiError } from '@/lib/api';

/** The account screens: signing out everywhere must report failure, and deleting a weight entry asks first. */

const mockSignOutEverywhere = jest.fn();
const mockSignOut = jest.fn();
const mockDelete = jest.fn();
const mockDeleteReset = jest.fn();
let mockDeleteState: { isPending: boolean; isError: boolean; error: ApiError | null } = { isPending: false, isError: false, error: null };

const mockMe = {
  user: { id: 'u1', email: 'a@b.co' },
  settings: { units: 'metric', dateFormat: 'system', timezone: 'UTC', timezoneAuto: true, aiCoachEnabled: false, aiCoachConsent: false, coachKeepHistory: true, foodScanConsent: false, personalizedAdsConsent: false, analyticsConsent: false },
};
const mockQuery = (data: unknown) => ({ data, isError: false, isPending: false, isRefetching: false, error: null, refetch: jest.fn() });
const mockUpdate = { mutate: jest.fn(), isPending: false, isError: false };

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => false } }));
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()] }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ signOut: (...a: unknown[]) => mockSignOut(...a), signOutEverywhere: (...a: unknown[]) => mockSignOutEverywhere(...a), changePassword: jest.fn() }),
}));
jest.mock('@/lib/queries', () => ({
  useMe: () => mockQuery(mockMe),
  useEntitlements: () => mockQuery(undefined),
  useCoachStatus: () => mockQuery(undefined),
  useLegal: () => mockQuery(undefined),
  useUpdateSettings: () => mockUpdate,
  useCatalog: () => mockQuery({ limits: { weightKg: { min: 30, max: 300 } } }),
  useWeightHistory: () => mockQuery({ entries: [{ localDate: '2026-10-01', weightKg: 80 }] }),
  useLogWeight: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteWeight: () => ({ mutate: (...a: unknown[]) => mockDelete(...a), reset: () => mockDeleteReset(), ...mockDeleteState }),
}));
jest.mock('@/lib/pro', () => ({ openPaywall: jest.fn(), STATE_LABEL: {}, statusLine: () => null }));

const offline = () => new ApiError('network', 'network', "Can't reach FORM.", null, true);

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteState = { isPending: false, isError: false, error: null };
});

describe.each([
  ['Settings', SettingsScreen],
  ['Account & security', SecurityScreen],
])('%s: sign out on all devices', (_name, Screen) => {
  it('says so and stays signed in when the call fails', async () => {
    mockSignOutEverywhere.mockRejectedValue(offline());
    await render(<Screen />);
    expect(screen.queryByText(/still signed in here/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out on all devices' }));
    expect(mockSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Couldn.t sign out your other devices, so you.re still signed in here/)).toBeTruthy();
    // The local sign-out belongs to signOutEverywhere (only after the server call succeeds); the screen never does it itself.
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('shows no error when it works, and clears an old one on retry', async () => {
    mockSignOutEverywhere.mockRejectedValueOnce(offline()).mockResolvedValueOnce(undefined);
    await render(<Screen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out on all devices' }));
    expect(await screen.findByText(/still signed in here/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out on all devices' }));
    await act(async () => {});
    expect(screen.queryByText(/still signed in here/)).toBeNull();
  });
});

describe('Weight: deleting an entry', () => {
  it('asks first, and only deletes on the second tap', async () => {
    await render(<WeightScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry for 2026-10-01' }));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete this entry\?/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry' }));
    expect(mockDelete).toHaveBeenCalledWith('2026-10-01', expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it('can be cancelled without deleting', async () => {
    await render(<WeightScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry for 2026-10-01' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.queryByText(/Delete this entry\?/)).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('shows why a delete failed and keeps the question open', async () => {
    mockDeleteState = { isPending: false, isError: true, error: offline() };
    await render(<WeightScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete entry for 2026-10-01' }));
    expect(screen.getByText(/Couldn.t delete that entry. Check your connection/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeTruthy();
  });
});
