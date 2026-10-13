import { buildScanReview, VERIFIED_FOODS, verifiedFood, type RecognitionResult } from '@form/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator } from 'expo-image-manipulator';
import { useState } from 'react';
import ScanMeal from '@/app/(tabs)/eat/scan';
import { confirmItems, initialReview, itemEstimate, qualityNote, reviewSummary, scanErrorMessage, statusMessage, type ReviewState } from '@/lib/scan';
import { capturePhoto } from '@/lib/scanCapture';
import type { FoodScan } from '@/lib/types';
import { ScanReviewView, type ScanReviewViewProps } from './ScanReviewView';

const mockCreateScan = jest.fn();
const mockDiscard = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: () => mockBack() }, useLocalSearchParams: () => ({ meal: 'lunch', date: '2026-10-12' }) }));
jest.mock('@/lib/features', () => ({ useFeature: () => ({ loading: false, unknown: false, available: true, checking: false, recheck: jest.fn() }) }));
jest.mock('@/components/eat/FoodPicker', () => ({ FoodPicker: () => null }));
jest.mock('@/components/pro/ProUpsellFor', () => ({ ProUpsellFor: () => null }));
jest.mock('@/lib/queries', () => ({
  useConfirmScan: () => ({ mutate: jest.fn(), isPending: false }),
  useCreateScan: () => ({ mutate: (...a: unknown[]) => mockCreateScan(...a), isPending: false }),
  useDiscardScan: () => ({ mutate: (...a: unknown[]) => mockDiscard(...a) }),
  useUpdateSettings: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));

const RESULT: RecognitionResult = {
  imageQuality: 'ok',
  containsFood: true,
  items: [
    {
      label: 'Grilled chicken breast',
      confidence: 0.88,
      alternatives: [],
      servingGrams: 150,
      servingLowGrams: 110,
      servingHighGrams: 200,
      per100g: { kcal: 170, proteinG: 30, carbsG: 0, fatG: 5 },
      hiddenIngredients: ['cooking oil'],
      composite: false,
    },
    {
      label: 'Greens',
      confidence: 0.3,
      alternatives: [{ label: 'Broccoli', confidence: 0.3, per100g: { kcal: 34, proteinG: 2.8, carbsG: 6.6, fatG: 0.4 } }],
      servingGrams: 80,
      servingLowGrams: 50,
      servingHighGrams: 120,
      per100g: { kcal: 35, proteinG: 2.4, carbsG: 7, fatG: 0.4 },
      hiddenIngredients: [],
      composite: false,
    },
  ],
};

function scanOf(over: Partial<FoodScan> = {}, result = RESULT): FoodScan {
  const review = buildScanReview(result, VERIFIED_FOODS);
  return {
    id: 's1',
    clientScanId: 'c1',
    status: review.status,
    imageQuality: review.imageQuality,
    items: review.items,
    provider: { name: 'Test', development: false },
    createdAt: '',
    expiresAt: '',
    confirmedAt: null,
    logs: [],
    ...over,
  };
}

describe('scan review logic', () => {
  const scan = scanOf();

  it('confident items start on their best guess; unsure ones wait for a choice', () => {
    const s = initialReview(scan);
    expect(s.i1).toMatchObject({ option: 'primary', amount: 150, removed: false });
    expect(s.i2).toMatchObject({ option: null, amount: 80 });
    expect(reviewSummary(scan, s)).toMatchObject({ kept: 1, undecided: ['i2'], canConfirm: false });
  });

  it('choosing, removing and editing update the estimate and the confirm payload', () => {
    const s: ReviewState = { ...initialReview(scan), i2: { option: 'alt1', food: null, amount: 100, removed: false } };
    expect(itemEstimate(scan.items[1]!, s.i2!)!.kcal).toBe(35); // Broccoli, boiled (verified) at 100 g
    expect(reviewSummary(scan, s)).toMatchObject({ kept: 2, canConfirm: true });
    const oats = verifiedFood('fdb:oats_dry')!;
    const edited: ReviewState = { i1: { ...s.i1!, removed: true }, i2: { option: null, food: oats, amount: 40, removed: false } };
    expect(confirmItems(scan, edited)).toEqual([
      { itemId: 'i1', remove: true },
      { itemId: 'i2', foodId: 'fdb:oats_dry', amount: 40 },
    ]);
    expect(confirmItems(scan, s)[0]).toEqual({ itemId: 'i1', optionKey: 'primary', amount: 150 });
  });

  it('explains no food, poor photos and unknown foods; notes poor quality on a usable scan', () => {
    expect(statusMessage({ status: 'no_food', imageQuality: 'ok' })!.title).toBe('No food found');
    expect(statusMessage({ status: 'poor_image', imageQuality: 'blurry' })!.message).toMatch(/blurry/);
    expect(statusMessage({ status: 'unknown_food', imageQuality: 'ok' })!.message).toMatch(/Search/);
    expect(statusMessage({ status: 'ok', imageQuality: 'ok' })).toBeNull();
    expect(qualityNote({ status: 'ok', imageQuality: 'too_dark' })).toMatch(/dark/);
  });

  it('maps failures to a next step', () => {
    expect(scanErrorMessage({ kind: 'network', code: 'network', message: '' })).toMatchObject({ retry: true });
    expect(scanErrorMessage({ kind: 'server', code: 'scan_timeout', message: '' })).toMatchObject({ retry: true });
    expect(scanErrorMessage({ kind: 'unavailable', code: 'food_scan_unavailable', message: '' })).toMatchObject({ retry: false });
    expect(scanErrorMessage({ kind: 'server', code: 'provider_invalid_input', message: '' })).toMatchObject({ retry: false });
  });
});

function Harness({ scan, onConfirm, onPickFood, photo, scrollRef }: { scan: FoodScan; onConfirm: jest.Mock; onPickFood?: jest.Mock; photo?: ScanReviewViewProps['photo']; scrollRef?: ScanReviewViewProps['scrollRef'] }) {
  const [state, setState] = useState(initialReview(scan));
  const [meal, setMeal] = useState<'lunch' | 'dinner' | 'breakfast' | 'snack'>('lunch');
  const [name, setName] = useState('');
  return (
    <ScanReviewView
      scan={scan}
      state={state}
      onChange={(id, patch) => setState((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }))}
      onPickFood={onPickFood ?? jest.fn()}
      meal={meal}
      onMeal={setMeal}
      mealName={name}
      onMealName={setName}
      onConfirm={() => onConfirm(state)}
      onRetake={jest.fn()}
      photo={photo}
      scrollRef={scrollRef}
    />
  );
}

describe('ScanReviewView', () => {
  it('is clearly an ESTIMATE; confidence and nutrition accuracy are shown separately', async () => {
    await render(<Harness scan={scanOf()} onConfirm={jest.fn()} />);
    expect(screen.getByText('ESTIMATED')).toBeTruthy();
    expect(screen.getByText("Likely · 88% sure it's Grilled chicken breast")).toBeTruthy();
    expect(screen.getByText(/Nutrition: rough — may include hidden oil/)).toBeTruthy(); // confident, but oil makes numbers rough
    expect(screen.getByText(/May include: cooking oil/)).toBeTruthy();
    expect(screen.getByText(/Estimated 110–200 g/)).toBeTruthy();
    expect(screen.queryByText(/DEVELOPMENT SAMPLE/)).toBeNull();
  });

  it('unsure items block logging until the user picks a food; then it can be confirmed', async () => {
    const onConfirm = jest.fn();
    await render(<Harness scan={scanOf()} onConfirm={onConfirm} />);
    expect(screen.getByText(/pick the right food/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log 1 item (estimated)' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Broccoli' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Log 2 items (estimated)' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ i2: expect.objectContaining({ option: 'alt1' }) }));
    expect(screen.getByLabelText('Name this meal (optional)')).toBeTruthy();
  });

  it('removes and restores items, edits amounts, and offers another food', async () => {
    const onPickFood = jest.fn();
    await render(<Harness scan={scanOf()} onConfirm={jest.fn()} onPickFood={onPickFood} />);
    await fireEvent.press(screen.getAllByRole('button', { name: '+' })[0]!);
    expect(screen.getByDisplayValue('160')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Grilled chicken breast' }));
    expect(screen.getByText('Grilled chicken breast — removed')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Other food' })[1]!);
    expect(onPickFood).toHaveBeenCalledWith('i2');
  });

  it('a development fallback says so, loudly', async () => {
    await render(<Harness scan={scanOf({ provider: { name: 'Development sample (not real recognition)', development: true } })} onConfirm={jest.fn()} />);
    expect(screen.getByText(/DEVELOPMENT SAMPLE — this isn’t real food recognition/)).toBeTruthy();
  });
});

// Two foods the model located (chicken, rice) and one it could not (greens), plus its one-line summary.
const BOXED: RecognitionResult = {
  imageQuality: 'ok',
  containsFood: true,
  summary: 'Grilled chicken with rice and greens.',
  items: [
    { ...RESULT.items[0]!, box: [300, 60, 700, 440] },
    { ...RESULT.items[0]!, label: 'White rice', confidence: 0.9, hiddenIngredients: [], per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }, box: [320, 480, 720, 880] },
    RESULT.items[1]!,
  ],
};
const PHOTO = { uri: 'file://meal.jpg', width: 1000, height: 750 };
const boxedScan = (over: Partial<FoodScan> = {}) => scanOf({ summary: BOXED.summary, ...over }, BOXED);
const chips = () => screen.queryAllByRole('button', { name: /Show details/ });

describe('ScanReviewView: the photo and its labels', () => {
  it('puts one numbered label on the photo for each located food', async () => {
    await render(<Harness scan={boxedScan()} onConfirm={jest.fn()} photo={PHOTO} />);
    expect(screen.getByLabelText('Your meal photo')).toBeTruthy();
    expect(chips()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Item 1: Grilled chicken breast. Show details.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Item 2: White rice. Show details.' })).toBeTruthy();
    // The third food was not located: no chip, and its card says so.
    expect(screen.getAllByText('Not located in the photo')).toHaveLength(1);
  });

  it('tapping a label highlights its card, and moves the highlight to the next one tapped', async () => {
    await render(<Harness scan={boxedScan()} onConfirm={jest.fn()} photo={PHOTO} />);
    expect(screen.queryByTestId('item-highlight-i2')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Item 2: White rice. Show details.' }));
    expect(screen.getByTestId('item-highlight-i2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Item 1: Grilled chicken breast. Show details.' }));
    expect(screen.getByTestId('item-highlight-i1')).toBeTruthy();
    expect(screen.queryByTestId('item-highlight-i2')).toBeNull();
  });

  it('copes with a screen that can scroll (and one that cannot)', async () => {
    const scrollRef = { current: { scrollTo: jest.fn(), getInnerViewRef: () => ({}) } } as never;
    await render(<Harness scan={boxedScan()} onConfirm={jest.fn()} photo={PHOTO} scrollRef={scrollRef} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Item 1: Grilled chicken breast. Show details.' }));
    expect(screen.getByTestId('item-highlight-i1')).toBeTruthy();
  });

  it('removing a food takes its label off the photo; undo brings it back', async () => {
    await render(<Harness scan={boxedScan()} onConfirm={jest.fn()} photo={PHOTO} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Grilled chicken breast' }));
    expect(chips()).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(chips()).toHaveLength(2);
  });

  it('a food we are unsure of reads as a question on the photo', async () => {
    const unsure: RecognitionResult = { ...BOXED, items: [{ ...RESULT.items[1]!, box: [100, 100, 500, 500] }] };
    await render(<Harness scan={scanOf({}, unsure)} onConfirm={jest.fn()} photo={PHOTO} />);
    expect(screen.getByRole('button', { name: 'Item 1: Greens (not sure). Show details.' })).toBeTruthy();
    expect(screen.getByText('Greens?')).toBeTruthy();
  });

  it('shows the AI summary in a card at the top, only when there is one', async () => {
    const view = await render(<Harness scan={boxedScan()} onConfirm={jest.fn()} photo={PHOTO} />);
    expect(screen.getByText('In your photo')).toBeTruthy();
    expect(screen.getByText('Grilled chicken with rice and greens.')).toBeTruthy();
    await view.unmount();
    await render(<Harness scan={scanOf()} onConfirm={jest.fn()} photo={PHOTO} />);
    expect(screen.queryByText('In your photo')).toBeNull();
  });

  it('numbers each card like its label, and splits calories in a bar that screen readers skip', async () => {
    await render(<Harness scan={boxedScan()} onConfirm={jest.fn()} photo={PHOTO} />);
    expect(screen.getByLabelText('Item 3')).toBeTruthy();
    // The bar is a picture of the numbers written beside it, so it is hidden from accessibility.
    expect(screen.queryByTestId('macro-bar-i1')).toBeNull();
    const bar = screen.getByTestId('macro-bar-i1', { includeHiddenElements: true });
    expect(bar.props.accessibilityElementsHidden).toBe(true);
    expect(bar.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getAllByText(/P .* g · .*C .* g · .*F .* g/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mostly protein — about \d+% of its calories/)).toBeTruthy();
    // The estimate is announced with its macros in words.
    expect(screen.getAllByLabelText(/grams protein, .* grams carbs, .* grams fat/).length).toBeGreaterThan(0);
  });

  it('with no photo there is no photo section and no "not located" note', async () => {
    await render(<Harness scan={boxedScan()} onConfirm={jest.fn()} />);
    expect(screen.queryByLabelText('Your meal photo')).toBeNull();
    expect(chips()).toHaveLength(0);
    expect(screen.queryByText('Not located in the photo')).toBeNull();
  });

  it('when nothing was located it says so once, instead of a note on every card', async () => {
    await render(<Harness scan={scanOf()} onConfirm={jest.fn()} photo={PHOTO} />);
    expect(screen.getByLabelText('Your meal photo')).toBeTruthy();
    expect(chips()).toHaveLength(0);
    expect(screen.queryByText('Not located in the photo')).toBeNull();
    expect(screen.getByText(/couldn’t place labels on this photo/)).toBeTruthy();
  });
});

describe('the scan screen keeps the photo through the review', () => {
  const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
  const manip = ImageManipulator as jest.Mocked<typeof ImageManipulator>;

  async function reachReview() {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 4000, height: 3000 }] } as never);
    const saveAsync = jest.fn().mockResolvedValue({ base64: 'QUJD', width: 1280, height: 960 });
    const ctx = { resize: jest.fn(), renderAsync: jest.fn().mockResolvedValue({ saveAsync }) };
    ctx.resize.mockReturnValue(ctx);
    manip.manipulate.mockReturnValue(ctx as never);
    mockCreateScan.mockImplementation((_body: unknown, opts: { onSuccess: (r: { scan: FoodScan }) => void }) => opts.onSuccess({ scan: boxedScan() }));
    await render(<ScanMeal />);
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Use photo' }));
    await screen.findByText('Review your meal');
  }

  beforeEach(() => jest.clearAllMocks());

  it('shows the photo with its labels in the review, and keeps it when picking another food', async () => {
    await reachReview();
    expect(screen.getByLabelText('Your meal photo')).toBeTruthy();
    expect(chips()).toHaveLength(2);
    await fireEvent.press(screen.getAllByRole('radio', { name: 'Other food' })[0]!);
    await fireEvent.press(await screen.findByRole('button', { name: 'Back to review' }));
    expect(screen.getByLabelText('Your meal photo')).toBeTruthy();
    expect(chips()).toHaveLength(2);
  });

  it('drops the photo when the user retakes', async () => {
    await reachReview();
    await fireEvent.press(screen.getByRole('button', { name: 'Retake photo' }));
    expect(mockDiscard).toHaveBeenCalledWith('s1');
    expect(screen.queryByLabelText('Your meal photo')).toBeNull();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
  });
});

describe('capturePhoto', () => {
  const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
  const manip = ImageManipulator as jest.Mocked<typeof ImageManipulator>;
  beforeEach(() => jest.clearAllMocks());

  it('permission denied vs blocked', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true } as never);
    expect(await capturePhoto('camera')).toEqual({ ok: false, reason: 'permission_denied' });
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false } as never);
    expect(await capturePhoto('camera')).toEqual({ ok: false, reason: 'permission_blocked' });
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('cancelled capture', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
    picker.launchCameraAsync.mockResolvedValue({ canceled: true, assets: null } as never);
    expect(await capturePhoto('camera')).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('captures, downsizes to 1280 px and re-encodes as JPEG without EXIF', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
    picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///photo.jpg', width: 4000, height: 3000 }] } as never);
    const saveAsync = jest.fn().mockResolvedValue({ base64: 'QUJD' });
    const ctx = { resize: jest.fn(), renderAsync: jest.fn().mockResolvedValue({ saveAsync }) };
    ctx.resize.mockReturnValue(ctx);
    manip.manipulate.mockReturnValue(ctx as never);
    const r = await capturePhoto('camera');
    expect(r).toEqual({ ok: true, image: { uri: 'data:image/jpeg;base64,QUJD', base64: 'QUJD' } });
    expect(picker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ exif: false, mediaTypes: ['images'] }));
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1280 });
    expect(saveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg', base64: true }));
  });

  it('a failure while processing is reported, never thrown', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
    picker.launchImageLibraryAsync.mockRejectedValue(new Error('boom'));
    expect(await capturePhoto('library')).toEqual({ ok: false, reason: 'failed' });
  });
});
