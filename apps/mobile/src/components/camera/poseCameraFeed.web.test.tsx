/** @jest-environment jsdom */
import { fromMediaPipePose, type LiveFeedback, type LivePoseSession } from '@form/domain';
import { act } from 'react';
import type { CameraStatus, PoseStatus } from '@/lib/pose/status';
import { PoseCameraFeed } from './PoseCameraFeed.web';
import type { SkeletonPage } from './skeletonTypes';

// react-dom ships no types in this repo (and none are added for one test file).
interface Root {
  render(node: React.ReactNode): void;
  unmount(): void;
}
const { createRoot } = jest.requireActual('react-dom/client') as { createRoot(el: Element): Root };

// The web feed is exercised against a fake camera, a fake model provider and a hand-cranked clock
// (performance.now and requestAnimationFrame), with the real skeleton page drawing onto a fake
// 2D context. Everything the feed tells the page is observable through spies that delegate to it.
let mockNow = 0;
let mockReduce = true;
let mockCreateFail = false;
let mockPage: Record<keyof SkeletonPage, jest.Mock> | null = null;
let mockProvider: { backend: 'GPU' | 'CPU' | null; load: jest.Mock; estimate: jest.Mock; close: jest.Mock };

jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  return {
    View: ({ children }: { children?: unknown }) => React.createElement('div', null, children),
    StyleSheet: { absoluteFill: {}, create: (s: unknown) => s },
    // What the theme tokens (the skeleton palette) read at load.
    Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default },
    Appearance: { getColorScheme: () => 'dark' },
  };
});
jest.mock('expo-secure-store', () => ({ getItem: () => null, setItem: () => undefined }));
jest.mock('@/lib/a11y', () => ({ useReducedMotion: () => mockReduce }));
jest.mock('@/lib/pose/mediapipe', () => ({ createPoseProvider: () => mockProvider }));
jest.mock('./skeletonPage', () => {
  const actual = jest.requireActual('./skeletonPage');
  return {
    ...actual,
    createSkeletonPage: (env: unknown, cfg: unknown) => {
      if (mockCreateFail) throw new Error('blocked by policy');
      const real = actual.createSkeletonPage(env, cfg) as SkeletonPage;
      const wrap = {} as Record<string, jest.Mock>;
      for (const k of ['push', 'setState', 'setBackend', 'setInline', 'start', 'stop', 'frame', 'stats'] as const) {
        wrap[k] = jest.fn((...args: never[]) => (real[k] as (...a: never[]) => unknown)(...args));
      }
      mockPage = wrap as never;
      return wrap;
    },
  };
});

const flushMicrotasks = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

// ---- a hand-cranked animation-frame clock ----------------------------------------------------
let rafQueue: { id: number; cb: () => unknown }[] = [];
let rafId = 0;
let videoTime = 0;
async function step(ms = 16, newVideoFrame = true) {
  mockNow += ms;
  if (newVideoFrame) videoTime += 1;
  const due = rafQueue;
  rafQueue = [];
  await act(async () => {
    due.forEach((f) => f.cb());
    await flushMicrotasks();
  });
}

// ---- fakes ------------------------------------------------------------------------------------
function fakeCtx() {
  const base: Record<string | symbol, unknown> = { getImageData: () => ({ data: new Uint8ClampedArray(32 * 24 * 4) }) };
  const proxy: unknown = new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : (t[k] = jest.fn(() => proxy))),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
  return proxy;
}

const track = { stop: jest.fn(), listeners: {} as Record<string, () => void>, addEventListener: jest.fn((type: string, fn: () => void) => void (track.listeners[type] = fn)) };
const stream = { getTracks: () => [track], getVideoTracks: () => [track] };

const standing = Array.from({ length: 33 }, (_, i) => ({ x: 0.5 + (i % 3) * 0.01, y: 0.1 + (i / 33) * 0.8, visibility: 0.95 }));
const detection = () => ({ timestampMs: 0, frame: { width: 640, height: 480 }, people: [{ keypoints: fromMediaPipePose(standing) }] });

let feedback: LiveFeedback | null = null;
let side: 'left' | 'right' | null = 'left';
let trackable = true;
let stale = false;
const mockSession = {
  exerciseId: 'squat',
  push: jest.fn(() => ({ trackable, framing: { side }, people: [], angle: null, events: [], analyzed: true })),
  repState: jest.fn(() => (feedback ? { feedback } : null)),
  interrupt: jest.fn(),
  isStale: jest.fn(() => stale),
  traceFull: false,
};
const session = mockSession as unknown as LivePoseSession;

let root: Root;
let host: HTMLDivElement;
const onCamera = jest.fn<void, [CameraStatus]>();
const onPose = jest.fn<void, [PoseStatus]>();
const onReadout = jest.fn();

function ui(over: { active?: boolean; retryToken?: number } = {}) {
  return <PoseCameraFeed active={over.active ?? true} session={session} retryToken={over.retryToken ?? 0} onCamera={onCamera} onPose={onPose} onReadout={onReadout} />;
}
async function mount(over: Parameters<typeof ui>[0] = {}) {
  await act(async () => root.render(ui(over)));
  const video = host.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 });
  Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 480 });
  Object.defineProperty(video, 'currentTime', { configurable: true, get: () => videoTime });
  await act(async () => flushMicrotasks());
  return { video, canvas: host.querySelector('canvas')! };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 640 });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: jest.fn(async () => stream) } });
});

beforeEach(() => {
  mockNow = 5000;
  mockReduce = true;
  mockCreateFail = false;
  mockPage = null;
  rafQueue = [];
  rafId = 0;
  videoTime = 0;
  feedback = null;
  side = 'left';
  trackable = true;
  stale = false;
  track.listeners = {};
  jest.clearAllMocks();
  mockProvider = { backend: 'GPU', load: jest.fn(async () => ({ ok: true, value: undefined })), estimate: jest.fn(async () => ({ ok: true, value: detection() })), close: jest.fn() };
  jest.spyOn(performance, 'now').mockImplementation(() => mockNow);
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafQueue.push({ id: ++rafId, cb: cb as () => unknown });
    return rafId;
  });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    rafQueue = rafQueue.filter((f) => f.id !== id);
  });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement & { __ctx?: unknown }) {
    return (this.__ctx ??= fakeCtx()) as never;
  });
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('skeleton draw loop', () => {
  it('draws at animation-frame rate while results arrive far slower, and push stamps the result', async () => {
    let finish: (v: unknown) => void = () => {};
    mockProvider.estimate.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await mount();
    const tickStart = mockNow + 16;
    await step(); // the frame loop asks for an estimate that stays pending
    expect(mockProvider.estimate).toHaveBeenCalledTimes(1);
    const drawsBefore = (mockPage!.stats() as { draws: number }).draws;
    for (let i = 0; i < 10; i++) await step();
    const drawsAfter = (mockPage!.stats() as { draws: number }).draws;
    expect(mockPage!.push).not.toHaveBeenCalled();
    expect(drawsAfter - drawsBefore).toBeGreaterThanOrEqual(9); // a draw per animation frame, no result needed
    expect(mockProvider.estimate).toHaveBeenCalledTimes(1);

    // The slow result finally lands: pushed with when its camera frame was taken and when it arrived.
    const arrive = mockNow;
    const d = detection();
    await act(async () => {
      finish({ ok: true, value: d });
      await flushMicrotasks();
    });
    expect(mockPage!.push).toHaveBeenCalledTimes(1);
    const [people, captureMs, arriveMs, vw, vh] = mockPage!.push.mock.calls[0]!;
    expect(people).toHaveLength(1);
    expect(people[0]).toHaveLength(33);
    expect(captureMs).toBe(tickStart);
    expect(arriveMs).toBe(arrive);
    expect([vw, vh]).toEqual([640, 480]);
    // The raw detection still goes to the session untouched.
    expect(mockSession.push).toHaveBeenCalledTimes(1);
    expect((mockSession.push.mock.calls[0] as unknown[])[0]).toMatchObject({ people: d.people, frame: d.frame });
  });

  it('tells the page the backend, from a ready provider and from one that finishes loading', async () => {
    await mount();
    expect(mockPage!.setBackend).toHaveBeenCalledWith('GPU');
    await act(async () => root.unmount());
    root = createRoot(host);
    mockProvider.backend = null;
    mockProvider.load.mockImplementation(async () => {
      mockProvider.backend = 'CPU';
      return { ok: true, value: undefined };
    });
    await mount();
    expect(mockPage!.setBackend).toHaveBeenCalledWith('CPU');
    expect(onPose).toHaveBeenLastCalledWith({ kind: 'ready', backend: 'CPU' });
  });

  it('keeps tracking, counting and reporting when the skeleton page cannot be built', async () => {
    mockCreateFail = true;
    await mount();
    expect(mockPage).toBeNull();
    for (let i = 0; i < 3; i++) await step();
    expect(mockSession.push).toHaveBeenCalledTimes(3);
    expect(onReadout).toHaveBeenCalledWith(expect.objectContaining({ people: 0 }));
    expect(onCamera).toHaveBeenCalledWith({ kind: 'live' });
    expect(onPose).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'failed' }));
  });

  it('keeps going when a page call throws, and stops drawing instead of breaking the loop', async () => {
    await mount();
    mockPage!.push.mockImplementation(() => {
      throw new Error('boom');
    });
    for (let i = 0; i < 3; i++) await step();
    expect(mockSession.push).toHaveBeenCalledTimes(3);
    expect(mockPage!.push).toHaveBeenCalledTimes(1); // switched off after the first failure
  });
});

describe('skeleton page lifecycle', () => {
  it('starts when the camera goes live', async () => {
    await mount();
    expect(mockPage!.start).toHaveBeenCalled();
    expect(onCamera).toHaveBeenCalledWith({ kind: 'live' });
  });

  it('stops the page when the stream is interrupted, and restarts it when frames return', async () => {
    jest.useFakeTimers({ doNotFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask'] });
    await mount();
    await step();
    expect(onReadout).toHaveBeenCalled();
    mockPage!.stop.mockClear();
    mockPage!.start.mockClear();
    stale = true;
    await act(async () => {
      jest.advanceTimersByTime(600);
      await flushMicrotasks();
    });
    expect(mockSession.interrupt).toHaveBeenCalled();
    expect(onCamera).toHaveBeenLastCalledWith({ kind: 'interrupted' });
    expect(onReadout).toHaveBeenLastCalledWith(null);
    expect(mockPage!.stop).toHaveBeenCalledTimes(1);
    stale = false;
    await step();
    expect(onCamera).toHaveBeenLastCalledWith({ kind: 'live' });
    expect(mockPage!.start).toHaveBeenCalledTimes(1);
  });

  it('stops the page when the camera track ends', async () => {
    await mount();
    mockPage!.stop.mockClear();
    act(() => track.listeners.ended!());
    expect(mockPage!.stop).toHaveBeenCalledTimes(1);
    expect(onCamera).toHaveBeenLastCalledWith({ kind: 'unavailable', reason: 'ended' });
  });

  it('stops the page on pause and on unmount, and releases the camera', async () => {
    await mount();
    mockPage!.stop.mockClear();
    await act(async () => root.render(ui({ active: false })));
    expect(mockPage!.stop).toHaveBeenCalledTimes(1);
    expect(track.stop).toHaveBeenCalled();
    await act(async () => root.render(ui({ active: true, retryToken: 1 })));
    await act(async () => flushMicrotasks());
    const resumed = mockPage!; // a fresh page for the new camera session
    resumed.stop.mockClear();
    await act(async () => root.unmount());
    expect(resumed.stop).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it('stops the page when the model fails mid-session', async () => {
    await mount();
    mockPage!.stop.mockClear();
    mockProvider.estimate.mockImplementation(async () => ({ ok: false, code: 'unavailable', message: 'gone', retryable: true }));
    await step();
    expect(mockPage!.stop).toHaveBeenCalledTimes(1);
    expect(onPose).toHaveBeenLastCalledWith({ kind: 'failed', message: 'gone', retryable: true });
  });
});

describe('skeleton state', () => {
  it('hands the page the tone from the coach cue and the tracked side, as the phone does', async () => {
    feedback = { headline: 'FIX YOUR FORM', message: 'Chest up', tone: 'fix', atMs: 0 };
    await mount();
    const initial = mockPage!.setState.mock.calls[0]![0];
    expect(initial).toMatchObject({ v: 1, tone: 'good', side: null, chain: [] });
    for (let i = 0; i < 7; i++) await step();
    const states = mockPage!.setState.mock.calls.map((c) => c[0]);
    const last = states[states.length - 1];
    expect(last).toMatchObject({ tone: 'fix', side: 'left', chain: [23, 25, 27] });
    // Only real changes reach the page (tone first, then the side once it has held 5 frames).
    expect(states.length).toBeLessThanOrEqual(4);
  });

  it('shows untrackable after a few untrackable frames and recovers at once', async () => {
    trackable = false;
    await mount();
    for (let i = 0; i < 5; i++) await step();
    expect(mockPage!.setState.mock.calls.some((c) => c[0].tone === 'untrackable')).toBe(true);
    trackable = true;
    await step();
    expect(mockPage!.setState.mock.calls[mockPage!.setState.mock.calls.length - 1]![0].tone).toBe('good');
  });

  it('passes reduce motion through, and follows it when it changes', async () => {
    mockReduce = true;
    await mount();
    expect(mockPage!.setState.mock.calls[mockPage!.setState.mock.calls.length - 1]![0].reduceMotion).toBe(true);
    mockReduce = false;
    await act(async () => root.render(ui()));
    expect(mockPage!.setState.mock.calls[mockPage!.setState.mock.calls.length - 1]![0].reduceMotion).toBe(false);
    mockReduce = true;
    await act(async () => root.render(ui()));
    expect(mockPage!.setState.mock.calls[mockPage!.setState.mock.calls.length - 1]![0].reduceMotion).toBe(true);
  });
});

describe('media styles', () => {
  it('mirrors and crops only the video; the canvas gets no transform or object-fit', async () => {
    const { video, canvas } = await mount();
    expect(video.style.transform).toBe('scaleX(-1)');
    expect(video.style.objectFit).toBe('cover');
    expect(canvas.style.transform).toBe('');
    expect(canvas.style.objectFit).toBe('');
    expect(canvas.style.width).toBe('100%');
    expect(canvas.style.height).toBe('100%');
    expect(canvas.style.position).toBe('absolute');
  });
});
