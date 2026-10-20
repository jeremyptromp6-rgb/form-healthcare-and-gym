import { act, renderHook } from '@testing-library/react-native';
import { config } from '@/lib/config';
import * as prefetch from './prefetch';

// The module's state (one download at a time, "done", the retry pause) lives at module level, so every
// test starts from a reset, with the native module, availability and sticky flag set the way it needs.
let mockPrefetch: jest.Mock | undefined;
let mockModule: { apiVersion: number; prefetchModels?: jest.Mock } | null = null;
let mockAvailable = true;
let mockStickyFailed = false;
jest.mock('../../../modules/form-pose-camera', () => ({
  get FormPoseCameraModule() {
    return mockModule;
  },
}));
jest.mock('./nativePose', () => ({ nativePoseAvailable: () => mockAvailable }));
jest.mock('./nativeFallback', () => ({ nativeCameraFailedOnThisBuild: () => mockStickyFailed }));

const load = () => prefetch;

beforeEach(() => {
  prefetch.resetPoseModelPrefetch();
  mockPrefetch = jest.fn().mockResolvedValue(true);
  mockModule = { apiVersion: 1, prefetchModels: mockPrefetch };
  mockAvailable = true;
  mockStickyFailed = false;
});

describe('prefetchPoseModels', () => {
  it('downloads the full and lite model once and remembers it worked', async () => {
    const { prefetchPoseModels } = load();
    expect(mockPrefetch).not.toHaveBeenCalled(); // nothing happens at import (app launch)
    await expect(prefetchPoseModels()).resolves.toBe(true);
    expect(mockPrefetch).toHaveBeenCalledWith(config.poseModelUrl, config.poseLiteModelUrl);
    await expect(prefetchPoseModels()).resolves.toBe(true);
    expect(mockPrefetch).toHaveBeenCalledTimes(1);
  });

  it('runs one download at a time however often it is called', async () => {
    let finish!: (ok: boolean) => void;
    mockPrefetch!.mockReturnValue(new Promise<boolean>((r) => (finish = r)));
    const { prefetchPoseModels } = load();
    const a = prefetchPoseModels();
    const b = prefetchPoseModels();
    expect(mockPrefetch).toHaveBeenCalledTimes(1);
    finish(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
  });

  it('a failed download (false or a rejection) is not retried for a minute, then is', async () => {
    jest.useFakeTimers();
    try {
      mockPrefetch!.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('boom')).mockResolvedValue(true);
      const { prefetchPoseModels, PREFETCH_RETRY_MS } = load();
      await expect(prefetchPoseModels()).resolves.toBe(false);
      await expect(prefetchPoseModels()).resolves.toBe(false);
      expect(mockPrefetch).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(PREFETCH_RETRY_MS + 1);
      await expect(prefetchPoseModels()).resolves.toBe(false); // the rejection
      jest.advanceTimersByTime(PREFETCH_RETRY_MS + 1);
      await expect(prefetchPoseModels()).resolves.toBe(true);
      expect(mockPrefetch).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['there is no native module', () => (mockModule = null)],
    ['the build predates the function', () => (mockModule = { apiVersion: 1 })],
    ['the native camera is switched off', () => (mockAvailable = false)],
    ['the native camera already failed on this build (the WebView engine runs instead)', () => (mockStickyFailed = true)],
  ])('does nothing when %s', async (_n, arrange) => {
    arrange();
    const { prefetchPoseModels } = load();
    await expect(prefetchPoseModels()).resolves.toBe(false);
    expect(mockPrefetch).not.toHaveBeenCalled();
  });
});

describe('usePrefetchPoseModels', () => {
  it('waits a few seconds after the screen opens, then prefetches once', async () => {
    jest.useFakeTimers();
    try {
      const { usePrefetchPoseModels, PREFETCH_DELAY_MS } = load();
      await renderHook(() => usePrefetchPoseModels());
      expect(mockPrefetch).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(PREFETCH_DELAY_MS - 100));
      expect(mockPrefetch).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTime(200));
      expect(mockPrefetch).toHaveBeenCalledTimes(1);
      expect(mockPrefetch).toHaveBeenCalledWith(config.poseModelUrl, config.poseLiteModelUrl);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaving the screen first cancels it', async () => {
    jest.useFakeTimers();
    try {
      const { usePrefetchPoseModels, PREFETCH_DELAY_MS } = load();
      const { unmount } = await renderHook(() => usePrefetchPoseModels());
      await unmount();
      await act(async () => jest.advanceTimersByTime(PREFETCH_DELAY_MS * 2));
      expect(mockPrefetch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
