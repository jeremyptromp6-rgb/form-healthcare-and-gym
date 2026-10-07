import { buildScanReview, VERIFIED_FOODS, verifiedFood, type RecognitionResult } from '@form/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator } from 'expo-image-manipulator';
import { useState } from 'react';
import { confirmItems, initialReview, itemEstimate, qualityNote, reviewSummary, scanErrorMessage, statusMessage, type ReviewState } from '@/lib/scan';
import { capturePhoto } from '@/lib/scanCapture';
import type { FoodScan } from '@/lib/types';
import { ScanReviewView } from './ScanReviewView';

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

function Harness({ scan, onConfirm, onPickFood }: { scan: FoodScan; onConfirm: jest.Mock; onPickFood?: jest.Mock }) {
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
