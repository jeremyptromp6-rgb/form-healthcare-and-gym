import { fireEvent, render, screen } from '@testing-library/react-native';
import ScanMeal from '@/app/(tabs)/eat/scan';
import { ApiError } from '@/lib/api';

/** The scan route: when saving the "allow recognition" choice fails, the screen says so and keeps the button. */

const mockCreateScan = jest.fn();
const mockUpdateSettings = jest.fn();

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ meal: 'lunch', date: '2026-10-12' }) }));
jest.mock('@/lib/features', () => ({ useFeature: () => ({ loading: false, unknown: false, available: true, checking: false, recheck: jest.fn() }) }));
jest.mock('@/lib/scanCapture', () => ({ capturePhoto: jest.fn(() => Promise.resolve({ ok: true, image: { uri: 'file://meal.jpg', base64: 'AAAA' } })) }));
jest.mock('@/components/eat/FoodPicker', () => ({ FoodPicker: () => null }));
jest.mock('@/components/eat/ScanReviewView', () => ({ ScanReviewView: () => null }));
jest.mock('@/components/pro/ProUpsellFor', () => ({ ProUpsellFor: () => null }));
jest.mock('@/lib/queries', () => ({
  useConfirmScan: () => ({ mutate: jest.fn(), isPending: false }),
  useCreateScan: () => ({ mutate: (...a: unknown[]) => mockCreateScan(...a), isPending: false }),
  useDiscardScan: () => ({ mutate: jest.fn() }),
  useUpdateSettings: () => ({ mutate: (...a: unknown[]) => mockUpdateSettings(...a), isPending: false }),
}));

const consentRequired = () => new ApiError('forbidden', 'scan_consent_required', 'Consent needed', 403, false);

/** Photo taken, recognition refused for lack of consent: the screen is on the consent prompt. */
async function reachConsentPrompt() {
  mockCreateScan.mockImplementation((_body: unknown, opts: { onError: (e: ApiError) => void }) => opts.onError(consentRequired()));
  await render(<ScanMeal />);
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Use photo' }));
  await screen.findByRole('button', { name: 'Allow and analyse' });
}

beforeEach(() => jest.clearAllMocks());

describe('Scan consent', () => {
  it('says so when saving the choice fails, and offers the same button again', async () => {
    await reachConsentPrompt();
    mockUpdateSettings.mockImplementation((_v: unknown, opts: { onError: (e: ApiError) => void }) => opts.onError(new ApiError('network', 'network', 'x', null, true)));
    await fireEvent.press(screen.getByRole('button', { name: 'Allow and analyse' }));
    expect(await screen.findByText(/Couldn.t save your choice. Check your connection/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Allow and analyse' })).toBeTruthy();
    // Nothing was analysed on the strength of a choice that did not save.
    expect(mockCreateScan).toHaveBeenCalledTimes(1);
  });

  it('analyses the photo once the choice is saved', async () => {
    await reachConsentPrompt();
    mockUpdateSettings.mockImplementation((_v: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    mockCreateScan.mockImplementation(() => undefined);
    await fireEvent.press(screen.getByRole('button', { name: 'Allow and analyse' }));
    expect(mockCreateScan).toHaveBeenCalledTimes(2);
  });
});
