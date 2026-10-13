import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { WorkoutSummaryView } from '@/components/train/WorkoutSummaryView';
import { adsSettings } from '@/lib/config';
import type { WorkoutSummaryDetail } from '@/lib/types';
import { AdFailure, type InterstitialAdProvider, type LoadedInterstitial } from './provider';
import { usePostWorkoutAd } from './usePostWorkoutAd';

/** Prompt S, client side: the AdService runs after completion, never blocks, and Pro never asks. */

let mockFeatures: string[] = [];
let mockEntitlementsPending = false;
const mockDecide = jest.fn();
const mockEvent = jest.fn();

// usePostWorkoutAd only needs pro's pure hasFeature(); the real module drags in expo-router and the whole
// navigation stack, which was most of this file's run time.
jest.mock('@/lib/pro', () => ({ hasFeature: (e: { features: string[] } | undefined, f: string) => !!e?.features.includes(f) }));
jest.mock('@/lib/queries', () => ({
  useEntitlements: () => ({ isPending: mockEntitlementsPending, data: mockEntitlementsPending ? undefined : { tier: 'free', features: mockFeatures } }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ authed: (fn: (t: string) => Promise<unknown>) => fn('token') }) }));
jest.mock('@/lib/api', () => ({
  api: {
    postWorkoutAd: (...a: unknown[]) => mockDecide(...a),
    postWorkoutAdEvent: (...a: unknown[]) => mockEvent(...a),
  },
}));

const flush = () => act(async () => {});

function fakeProvider(opts: { available?: boolean; loadFails?: string; showFails?: string; deferLoad?: boolean } = {}) {
  const show = jest.fn(async ({ onShown }: { onShown: () => void }) => {
    if (opts.showFails) throw new AdFailure(opts.showFails);
    onShown();
  });
  const dispose = jest.fn();
  let resolveLoad: (ad: LoadedInterstitial) => void = () => {};
  const load = jest.fn(
    () =>
      new Promise<LoadedInterstitial>((resolve, reject) => {
        if (opts.loadFails) return reject(new AdFailure(opts.loadFails));
        const ad = { show, dispose };
        if (opts.deferLoad) resolveLoad = resolve;
        else resolve(ad);
      }),
  );
  const provider: InterstitialAdProvider = {
    availability: () => (opts.available === false ? { available: false, reason: 'not_configured' } : { available: true, network: 'test', test: true }),
    load,
  };
  return { provider, load, show, dispose, finishLoad: () => resolveLoad({ show, dispose }) };
}

const events = () => mockEvent.mock.calls.map((c) => (c[3] ? `${c[2]}:${c[3]}` : c[2]));

beforeEach(() => {
  mockFeatures = [];
  mockEntitlementsPending = false;
  mockDecide.mockReset().mockResolvedValue({ eligible: true, adId: 'ad-1', placement: 'post_workout', personalized: false });
  mockEvent.mockReset().mockResolvedValue({ state: 'reserved' });
});

describe('usePostWorkoutAd', () => {
  it('Free user: decides after completion, loads in the background, shows on Done, then goes Home once', async () => {
    const f = fakeProvider();
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(mockDecide).toHaveBeenCalledWith('token', 'w1');
    expect(f.load).toHaveBeenCalledWith({ personalized: false, timeoutMs: expect.any(Number) });
    expect(result.current.phase).toBe('READY');
    expect(result.current.adReady).toBe(true);

    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(f.show).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(events()).toEqual(['requested', 'loaded', 'shown', 'dismissed']);
    expect(result.current.phase).toBe('DISMISSED');
  });

  it('does nothing before there is a committed workout', async () => {
    const f = fakeProvider();
    const { result } = await renderHook(() => usePostWorkoutAd(null, f.provider));
    await flush();
    expect(mockDecide).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('IDLE');
  });

  it('Pro: no server request, no SDK load, straight Home', async () => {
    mockFeatures = ['AD_FREE'];
    const f = fakeProvider();
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(mockDecide).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('NOT_ELIGIBLE');
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(next).toHaveBeenCalledTimes(1);
    expect(f.show).not.toHaveBeenCalled();
  });

  it('waits for entitlements before deciding, so a Pro user is never asked while loading', async () => {
    mockEntitlementsPending = true;
    const f = fakeProvider();
    const { rerender } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(mockDecide).not.toHaveBeenCalled();
    mockEntitlementsPending = false;
    mockFeatures = ['AD_FREE'];
    await rerender({});
    await flush();
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('provider not configured: reports NOT_CONFIGURED, never fakes an ad, never asks the server', async () => {
    const f = fakeProvider({ available: false });
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(result.current.phase).toBe('NOT_CONFIGURED');
    expect(mockDecide).not.toHaveBeenCalled();
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('daily cap reached: no load, straight Home', async () => {
    mockDecide.mockResolvedValue({ eligible: false, reason: 'daily_cap' });
    const f = fakeProvider();
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(result.current.phase).toBe('NOT_ELIGIBLE');
    expect(f.load).not.toHaveBeenCalled();
  });

  it('server unreachable: the user just continues', async () => {
    mockDecide.mockRejectedValue(new Error('offline'));
    const f = fakeProvider();
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(result.current.phase).toBe('NOT_ELIGIBLE');
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('load failure: reported with a short code, and Done goes straight Home', async () => {
    const f = fakeProvider({ loadFails: 'no_fill' });
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(result.current.phase).toBe('FAILED');
    expect(events()).toEqual(['requested', 'failed:no_fill']);
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(next).toHaveBeenCalledTimes(1);
    expect(f.show).not.toHaveBeenCalled();
  });

  it("show failure: reported, and the user still reaches Home", async () => {
    const f = fakeProvider({ showFails: 'show_failed' });
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(next).toHaveBeenCalledTimes(1);
    expect(events()).toEqual(['requested', 'loaded', 'failed:show_failed']);
  });

  it('Done while the ad is still loading: leave now, release the reservation, never show it later', async () => {
    const f = fakeProvider({ deferLoad: true });
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(result.current.phase).toBe('LOADING');
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(next).toHaveBeenCalledTimes(1);
    expect(events()).toEqual(['requested', 'failed:not_ready']);
    await act(async () => f.finishLoad());
    expect(f.show).not.toHaveBeenCalled();
  });

  it('bought Pro while on the summary: the loaded ad is not shown', async () => {
    const f = fakeProvider();
    const { result, rerender } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    expect(result.current.adReady).toBe(true);
    mockFeatures = ['AD_FREE'];
    await rerender({});
    expect(result.current.adReady).toBe(false);
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(f.show).not.toHaveBeenCalled();
    expect(f.dispose).toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(events()).toContain('failed:pro_user');
  });

  it('a double tap on Done shows the ad once and navigates once', async () => {
    const f = fakeProvider();
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    const next = jest.fn();
    await act(async () => {
      void result.current.finish(next);
      void result.current.finish(next);
    });
    expect(f.show).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('a failed event report never affects the user', async () => {
    mockEvent.mockRejectedValue(new Error('offline'));
    const f = fakeProvider();
    const { result } = await renderHook(() => usePostWorkoutAd('w1', f.provider));
    await flush();
    const next = jest.fn();
    await act(() => result.current.finish(next));
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('adsSettings', () => {
  it('development builds only ever use test ads, even if production is requested', () => {
    expect(adsSettings({ mode: 'production', android: 'real-unit' }, true)).toEqual({ mode: 'test', interstitial: { android: null, ios: null } });
    expect(adsSettings({}, true).mode).toBe('test');
    expect(adsSettings({ mode: 'off' }, true).mode).toBe('off');
  });

  it('release builds are off unless explicitly configured', () => {
    expect(adsSettings({}, false).mode).toBe('off');
    expect(adsSettings({ mode: 'test' }, false).mode).toBe('test');
    expect(adsSettings({ mode: 'production', android: 'a', ios: '' }, false)).toEqual({ mode: 'production', interstitial: { android: 'a', ios: null } });
  });
});

describe('summary before the ad', () => {
  const summary: WorkoutSummaryDetail = {
    workout: { id: 'w1', localDate: '2026-09-28', durationMinutes: 42, painLevel: 'none', xp: 320, flags: [] },
    totals: { sets: 1, reps: 10, verifiedReps: 10, volumeKg: 0, perfectReps: 8, averageFormScore: 94 },
    sets: [{ exerciseId: 'push_up', name: 'Push-Up', setIndex: 0, targetReps: 10, reps: 10, verifiedReps: 10, loadKg: 0, romPercent: 91, formScore: 94, quality: null }],
    prs: [],
  };

  it('shows the results in full and says an ad comes next, so it is never a surprise', async () => {
    const onDone = jest.fn();
    await render(<WorkoutSummaryView summary={summary} onDone={onDone} adNext />);
    expect(screen.getByText('+320')).toBeTruthy();
    expect(screen.getByText('Next: a short ad, then Home. FORM Pro has no ads.')).toBeTruthy();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done.props.accessibilityHint).toBe('A short ad plays, then you return Home.');
    await fireEvent.press(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says nothing about ads when none is coming', async () => {
    await render(<WorkoutSummaryView summary={summary} onDone={jest.fn()} />);
    expect(screen.queryByText(/short ad/)).toBeNull();
  });
});
