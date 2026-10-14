import { fromMediaPipePose, LivePoseSession } from '@form/domain';
import { act, render, screen } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import { Platform } from 'react-native';
import { MODEL_BUDGET_MS, POSE_CONFIDENCE } from '@/lib/pose/poseModels';
import { config } from '@/lib/config';
import type { LiveReadout, PoseDiag } from '@/lib/pose/status';
import { peopleFromLm, toEngineMessage } from '@/lib/pose/nativePose';
import { NATIVE_LIVE_FALLBACK_MS } from './NativePoseFeed';
import { PoseCameraFeed } from './PoseCameraFeed';
import { skeletonPalette } from './skeletonState';

// The native pose camera view, stood in for by a component that records its props (the events the
// real one fires are called by the tests) and counts how often it mounts.
type NativeEvents = {
  onCamera: (e: { nativeEvent: object }) => void;
  onPose: (e: { nativeEvent: object }) => void;
  onFrame: (e: { nativeEvent: object }) => void;
  onDiag?: (e: { nativeEvent: object }) => void;
};
let mockAvailable = true;
let mockNativeProps: (Record<string, unknown> & NativeEvents) | null = null;
let mockMounts = 0;
jest.mock('../../../modules/form-pose-camera', () => {
  const { useEffect } = jest.requireActual('react');
  const { View: MockView } = jest.requireActual('react-native');
  return {
    isFormPoseCameraAvailable: () => mockAvailable,
    FormPoseCameraView: (props: { testID?: string }) => {
      mockNativeProps = props as unknown as typeof mockNativeProps;
      useEffect(() => {
        mockMounts++;
      }, []);
      return <MockView testID={props.testID} />;
    },
  };
});
jest.mock('expo-camera', () => ({ useCameraPermissions: jest.fn() }));
// Local storage and the build id, in memory: the "native camera failed on this build" flag lives there.
const mockStore = new Map<string, string>();
let mockBuildCode = 7;
jest.mock('expo-secure-store', () => ({
  getItem: (k: string) => mockStore.get(k) ?? null,
  setItem: (k: string, v: string) => void mockStore.set(k, v),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { version: '0.1.0', android: { versionCode: mockBuildCode } };
    },
  },
}));
// The anonymous handover report: a signed-in token and the API call, recorded.
let mockToken: string | null = 'tok';
const mockReport = jest.fn(async (_token: string, _body: object) => undefined);
jest.mock('@/lib/tokenStore', () => ({ tokenStore: { get: async () => mockToken } }));
jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), api: { reportCameraFailure: (t: string, b: object) => mockReport(t, b) } }));
// The WebView engine, for the fallback: it records its message handler.
const mockWeb: { onMessage: ((e: { nativeEvent: { data: string } }) => void) | null; inject: jest.Mock } = { onMessage: null, inject: jest.fn() };
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View: MockView } = jest.requireActual('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: { testID?: string; onMessage?: typeof mockWeb.onMessage }, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: mockWeb.inject }));
      mockWeb.onMessage = props.onMessage ?? null;
      return <MockView testID={props.testID} />;
    }),
  };
});

const permission = useCameraPermissions as jest.Mock;
const fire = async (name: 'onCamera' | 'onPose' | 'onFrame' | 'onDiag', nativeEvent: object) => {
  await act(async () => mockNativeProps![name]!({ nativeEvent }));
};
const webMessage = async (m: object) => {
  await act(async () => mockWeb.onMessage!({ nativeEvent: { data: JSON.stringify(m) } }));
};

/** 33 landmarks of a person, all clearly visible, spread down the frame. */
const body = (): [number, number, number][] => Array.from({ length: 33 }, (_, i) => [0.4 + (i % 3) * 0.02, 0.1 + (i / 33) * 0.8, 0.95]);
const flat = (lm: [number, number, number][]) => lm.flat();
/** Torso joints for a person facing the camera: shoulders and hips about as wide as the torso is long. */
const frontOn = (): [number, number, number][] => {
  const lm = body();
  lm[11] = [0.3, 0.3, 0.95];
  lm[12] = [0.7, 0.3, 0.95];
  lm[23] = [0.4, 0.6, 0.95];
  lm[24] = [0.6, 0.6, 0.95];
  return lm;
};
const frame = (lm: number[], over: Partial<{ ts: number; b: number }> = {}) => ({ ts: 1000, w: 480, h: 640, ms: 21, b: 120, lm, ...over });

type Cue = 'good' | 'fix' | 'warn' | null;
function fakeSession() {
  const f = { trackable: true, cue: null as Cue };
  const push = jest.fn((_d: unknown) => ({ trackable: f.trackable, framing: { side: 'left' }, angle: null, people: [{}] }));
  const session = {
    exerciseId: 'bodyweight_squat',
    traceFull: false,
    interrupt: jest.fn(),
    push,
    repState: () => (f.cue ? { feedback: { tone: f.cue, headline: 'CORRECT FORM', message: 'x', atMs: 0 } } : null),
  } as unknown as LivePoseSession;
  return { f, push, session };
}
const handlers = () => ({ onCamera: jest.fn(), onPose: jest.fn(), onReadout: jest.fn(), onEngine: jest.fn() });

beforeEach(() => {
  mockAvailable = true;
  mockNativeProps = null;
  mockMounts = 0;
  mockStore.clear();
  mockBuildCode = 7;
  mockToken = 'tok';
  mockReport.mockClear();
  mockWeb.onMessage = null;
  mockWeb.inject.mockClear();
  permission.mockReturnValue([{ granted: true, canAskAgain: true }, jest.fn()]);
});

describe('native pose feed', () => {
  it('renders the native view (not the WebView) and reports the engine', async () => {
    const h = handlers();
    await render(<PoseCameraFeed active session={LivePoseSession.for('bodyweight_squat')!} retryToken={0} {...h} />);
    expect(screen.getByTestId('camera-view-native')).toBeTruthy();
    expect(screen.queryByTestId('camera-view')).toBeNull();
    expect(h.onEngine).toHaveBeenCalledWith('native');
  });

  it('uses the WebView engine when the native view is not available', async () => {
    mockAvailable = false;
    const h = handlers();
    await render(<PoseCameraFeed active session={LivePoseSession.for('bodyweight_squat')!} retryToken={0} {...h} />);
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    expect(screen.queryByTestId('camera-view-native')).toBeNull();
    expect(h.onEngine).toHaveBeenCalledWith('webview');
  });

  it('is off while inactive or without the camera permission, and restarts on retry', async () => {
    const { session } = fakeSession();
    const h = handlers();
    const { rerender } = await render(<PoseCameraFeed active={false} session={session} retryToken={0} {...h} />);
    expect(screen.queryByTestId('camera-view-native')).toBeNull();
    await rerender(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    expect(screen.getByTestId('camera-view-native')).toBeTruthy();
    expect(mockMounts).toBe(1);
    await rerender(<PoseCameraFeed active session={session} retryToken={1} {...h} />);
    expect(mockMounts).toBe(2);
    permission.mockReturnValue([{ granted: false, canAskAgain: true }, jest.fn().mockResolvedValue({ granted: false, canAskAgain: true })]);
    await rerender(<PoseCameraFeed active session={session} retryToken={1} {...h} />);
    expect(screen.queryByTestId('camera-view-native')).toBeNull();
  });

  it('gives the view the model, confidence and budget, and keeps those session props stable across renders', async () => {
    const { session, f } = fakeSession();
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    const first = mockNativeProps!;
    expect(first).toMatchObject({
      active: true,
      facing: 'front',
      modelUrl: config.poseModelUrl,
      liteModelUrl: config.poseLiteModelUrl,
      confidence: [POSE_CONFIDENCE.detection, POSE_CONFIDENCE.presence, POSE_CONFIDENCE.tracking],
      budgetMs: MODEL_BUDGET_MS,
      overlayMode: 'outline',
      diagnostics: false,
    });
    expect(first.leadMs).toBeUndefined();
    f.cue = 'fix';
    await fire('onCamera', { kind: 'live' });
    await fire('onPose', { kind: 'ready', backend: 'GPU', variant: 'full', rung: 'mask' });
    for (let i = 0; i < 8; i++) await fire('onFrame', frame(flat(body()), { ts: 1000 + i * 250 }));
    expect(mockNativeProps!.confidence).toBe(first.confidence);
    expect(mockNativeProps!.modelUrl).toBe(first.modelUrl);
    expect(mockMounts).toBe(1);
  });

  it('maps the skeleton state onto the overlay props: tone, tracked chain, palette', async () => {
    const { session, f } = fakeSession();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
    expect(mockNativeProps).toMatchObject({ tone: 'good', chain: [], palette: skeletonPalette(), reduceMotion: true });
    await fire('onCamera', { kind: 'live' });
    f.cue = 'fix';
    // The side (left) is confirmed after five frames; the cue read at the next readout changes the tone.
    for (let i = 0; i < 12; i++) await fire('onFrame', frame(flat(body()), { ts: 1000 + i * 250 }));
    expect(mockNativeProps).toMatchObject({ tone: 'fix', chain: [23, 25, 27] });
    f.trackable = false;
    for (let i = 0; i < 6; i++) await fire('onFrame', frame(flat(body()), { ts: 5000 + i * 250 }));
    expect(mockNativeProps!.tone).toBe('untrackable');
  });

  describe('frame contract', () => {
    const expected = (lm: [number, number, number][], brightness: number | undefined) => ({
      timestampMs: 1000,
      frame: { width: 480, height: 640 },
      people: [{ keypoints: fromMediaPipePose(lm.map(([x, y, visibility]) => ({ x, y, visibility }))) }],
      brightness,
    });

    it('a native frame reaches the session with exactly the detection the WebView engine produces', async () => {
      const lm = body();
      const native = fakeSession();
      const h = handlers();
      const { unmount } = await render(<PoseCameraFeed active session={native.session} retryToken={0} {...h} />);
      await fire('onFrame', frame(flat(lm)));
      expect(native.push).toHaveBeenCalledTimes(1);
      expect(native.push.mock.calls[0]![0]).toEqual(expected(lm, 120));
      await unmount();

      mockAvailable = false;
      const web = fakeSession();
      await render(<PoseCameraFeed active session={web.session} retryToken={0} {...handlers()} />);
      await webMessage({ t: 'frame', ts: 1000, w: 480, h: 640, ms: 21, b: 120, people: [lm] });
      expect(web.push.mock.calls[0]![0]).toEqual(native.push.mock.calls[0]![0]);
    });

    it('an unknown brightness (-1) is left out, and no landmarks means nobody', async () => {
      const { session, push } = fakeSession();
      await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
      await fire('onFrame', frame([], { b: -1 }));
      const d = push.mock.calls[0]![0] as { brightness?: number; people: unknown[] };
      expect(d.brightness).toBeUndefined();
      expect(d.people).toEqual([]);
    });

    it('adapts events: nulls become undefined, brightness -1 becomes unknown, bad landmark lists mean nobody', () => {
      expect(toEngineMessage('camera', { kind: 'error', name: null })).toEqual({ t: 'camera', kind: 'error', name: undefined });
      expect(toEngineMessage('camera', { kind: 'error', name: 'NotAllowedError' })).toMatchObject({ name: 'NotAllowedError' });
      expect(toEngineMessage('pose', { kind: 'loading', stage: 'model', pct: 42 })).toMatchObject({ t: 'pose', kind: 'loading', stage: 'model', pct: 42 });
      expect(toEngineMessage('pose', { kind: 'ready', backend: 'GPU', variant: null, rung: 'mask', offline: null, message: null, fatal: null, stage: null, pct: null })).toEqual({
        t: 'pose',
        kind: 'ready',
        backend: 'GPU',
        stage: undefined,
        pct: undefined,
        variant: undefined,
        offline: undefined,
        fatal: undefined,
      });
      expect(toEngineMessage('frame', frame([], { b: -1 }))).toMatchObject({ t: 'frame', b: undefined, people: [] });
      expect(peopleFromLm([0.1, 0.2, 0.9])).toEqual([]);
      expect(peopleFromLm(null)).toEqual([]);
      expect(peopleFromLm(flat(body()))).toEqual([body()]);
    });
  });

  it('reports camera events and pose progress through the shared handler', async () => {
    const { session } = fakeSession();
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    await fire('onPose', { kind: 'loading', stage: 'model', pct: 30 });
    await fire('onPose', { kind: 'loading', stage: 'starting', pct: null });
    await fire('onCamera', { kind: 'live', name: null });
    await fire('onPose', { kind: 'ready', backend: 'CPU', variant: 'lite', rung: 'capsule' });
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'loading', stage: 'model', pct: 30 });
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'loading', stage: 'starting', pct: undefined });
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'live' });
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'ready', backend: 'CPU' });
    await fire('onCamera', { kind: 'error', name: 'NotReadableError' });
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'unavailable', reason: 'in_use' });
    await fire('onPose', { kind: 'failed', offline: true, message: 'x', fatal: false });
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'failed', message: 'Camera coaching needs an internet connection the first time it loads.', retryable: true });
    expect(screen.getByTestId('camera-view-native')).toBeTruthy();
  });

  it('a native camera that never delivers a frame hands over to the WebView engine instead of failing', async () => {
    jest.useFakeTimers();
    try {
      const { session } = fakeSession();
      const h = handlers();
      await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
      await act(async () => jest.advanceTimersByTime(NATIVE_LIVE_FALLBACK_MS - 100));
      expect(screen.getByTestId('camera-view-native')).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(200));
      expect(screen.queryByTestId('camera-view-native')).toBeNull();
      expect(screen.getByTestId('camera-view')).toBeTruthy();
      expect(h.onEngine).toHaveBeenLastCalledWith('webview');
      expect(h.onCamera).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'unavailable' }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('a native camera that went live is never handed over by the start timer', async () => {
    jest.useFakeTimers();
    try {
      const { session } = fakeSession();
      const h = handlers();
      await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
      await fire('onCamera', { kind: 'live', name: null });
      await act(async () => jest.advanceTimersByTime(NATIVE_LIVE_FALLBACK_MS + 1000));
      expect(screen.getByTestId('camera-view-native')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a ready native engine that never delivers a frame result hands over to the WebView engine', async () => {
    jest.useFakeTimers();
    try {
      const { session } = fakeSession();
      const h = handlers();
      await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
      await fire('onCamera', { kind: 'live', name: null });
      await fire('onPose', { kind: 'ready', backend: 'GPU', variant: 'full', rung: 'mask' });
      await act(async () => jest.advanceTimersByTime(NATIVE_LIVE_FALLBACK_MS - 100));
      expect(screen.getByTestId('camera-view-native')).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(200));
      expect(screen.queryByTestId('camera-view-native')).toBeNull();
      expect(screen.getByTestId('camera-view')).toBeTruthy();
      expect(h.onEngine).toHaveBeenLastCalledWith('webview');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a ready native engine that delivers a frame is never handed over by the ready timer', async () => {
    jest.useFakeTimers();
    try {
      const { session } = fakeSession();
      await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
      await fire('onCamera', { kind: 'live', name: null });
      await fire('onPose', { kind: 'ready', backend: 'GPU', variant: 'full', rung: 'mask' });
      await fire('onFrame', frame(flat(body())));
      await act(async () => jest.advanceTimersByTime(NATIVE_LIVE_FALLBACK_MS + 1000));
      expect(screen.getByTestId('camera-view-native')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives the native view an accessibility label like the other engines', async () => {
    await render(<PoseCameraFeed active session={LivePoseSession.for('bodyweight_squat')!} retryToken={0} {...handlers()} />);
    expect(mockNativeProps).toMatchObject({ accessibilityLabel: 'Live camera preview' });
  });

  it('a fatal native failure hands this session to the WebView engine', async () => {
    const { session } = fakeSession();
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    await fire('onPose', { kind: 'failed', fatal: true, message: 'no camerax' });
    expect(screen.queryByTestId('camera-view-native')).toBeNull();
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    expect(h.onEngine).toHaveBeenLastCalledWith('webview');
    expect(h.onReadout).toHaveBeenLastCalledWith(null);
    // The user is not shown a failure: the new engine starts from "loading".
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'loading' });
    expect(h.onPose).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'failed' }));
    // And the WebView feed works from there on.
    await webMessage({ t: 'camera', kind: 'live' });
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'live' });
  });

  describe('sticky native fallback', () => {
    const storedReason = () => (JSON.parse([...mockStore.values()][0] ?? '{}') as { reason?: string; build?: string });

    it('a fatal failure is remembered with its reason for this build', async () => {
      const { session } = fakeSession();
      await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
      await fire('onPose', { kind: 'failed', fatal: true, message: 'no camerax' });
      expect(storedReason()).toMatchObject({ reason: 'fatal:no camerax', build: '0.1.0+7' });
    });

    describe('anonymous handover report', () => {
      beforeEach(() => {
        jest.replaceProperty(Platform, 'OS', 'android');
        jest.spyOn(Platform, 'Version', 'get').mockReturnValue(35);
        jest.spyOn(Platform, 'constants', 'get').mockReturnValue({ Brand: 'google', Model: 'Pixel 9' } as typeof Platform.constants);
      });
      afterEach(() => jest.restoreAllMocks());

      it('sends the reason, build, OS and phone model once, with no user data', async () => {
        const { session } = fakeSession();
        await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
        await fire('onPose', { kind: 'failed', fatal: true, message: 'no camerax' });
        expect(mockReport).toHaveBeenCalledTimes(1);
        expect(mockReport).toHaveBeenCalledWith('tok', { reason: 'fatal:no camerax', build: '0.1.0+7', os: 'Android 35', device: 'google Pixel 9', engine: 'native' });
      });

      it('sends nothing without a session', async () => {
        mockToken = null;
        const { session } = fakeSession();
        await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
        await fire('onPose', { kind: 'failed', fatal: true, message: 'x' });
        expect(mockReport).not.toHaveBeenCalled();
        expect(screen.getByTestId('camera-view')).toBeTruthy();
      });

      it('a failing send is ignored', async () => {
        mockReport.mockRejectedValueOnce(new Error('offline'));
        const { session } = fakeSession();
        await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
        await fire('onPose', { kind: 'failed', fatal: true, message: 'x' });
        expect(mockReport).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('camera-view')).toBeTruthy();
      });
    });

    it('a camera that never goes live is remembered as no_live', async () => {
      jest.useFakeTimers();
      try {
        const { session } = fakeSession();
        await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
        await act(async () => jest.advanceTimersByTime(NATIVE_LIVE_FALLBACK_MS + 100));
        expect(storedReason().reason).toBe('no_live');
      } finally {
        jest.useRealTimers();
      }
    });

    it('a ready engine that never frames is remembered as no_frame_after_ready', async () => {
      jest.useFakeTimers();
      try {
        const { session } = fakeSession();
        await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
        await fire('onCamera', { kind: 'live', name: null });
        await fire('onPose', { kind: 'ready', backend: 'GPU', variant: 'full', rung: 'mask' });
        await act(async () => jest.advanceTimersByTime(NATIVE_LIVE_FALLBACK_MS + 100));
        expect(storedReason().reason).toBe('no_frame_after_ready');
      } finally {
        jest.useRealTimers();
      }
    });

    it('with the flag set for this build the WebView engine starts directly, with no native attempt', async () => {
      const { session } = fakeSession();
      const first = await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
      await fire('onPose', { kind: 'failed', fatal: true, message: 'x' });
      await first.unmount();
      mockNativeProps = null;
      mockMounts = 0;
      const h = handlers();
      await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
      expect(screen.getByTestId('camera-view')).toBeTruthy();
      expect(screen.queryByTestId('camera-view-native')).toBeNull();
      expect(mockMounts).toBe(0);
      expect(h.onEngine).toHaveBeenCalledWith('webview');
      expect(h.onEngine).not.toHaveBeenCalledWith('native');
    });

    it('a different build tries the native camera again', async () => {
      const { session } = fakeSession();
      const first = await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
      await fire('onPose', { kind: 'failed', fatal: true, message: 'x' });
      await first.unmount();
      mockBuildCode = 8;
      mockNativeProps = null;
      await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
      expect(screen.getByTestId('camera-view-native')).toBeTruthy();
      expect(screen.queryByTestId('camera-view')).toBeNull();
    });
  });

  it('raises the front-on stance after a second of frames and reports the frame aspect', async () => {
    const { session } = fakeSession();
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    const last = () => h.onReadout.mock.calls.map((c) => c[0]).filter(Boolean).at(-1) as LiveReadout;
    await fire('onFrame', frame(flat(frontOn())));
    expect(last().stance).toBeNull();
    expect(last().frameAspect).toBeCloseTo(0.75);
    // Readouts come every 200 ms of wall time, so let the clock run past them.
    const realNow = Date.now;
    let clock = realNow();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      for (let i = 0; i < 25; i++) {
        clock += 250;
        await fire('onFrame', frame(flat(frontOn()), { ts: 2000 + i * 33 }));
      }
      expect(last().stance).toBe('front-on');
      for (let i = 0; i < 12; i++) {
        clock += 250;
        await fire('onFrame', frame(flat(body()), { ts: 5000 + i * 33 }));
      }
      expect(last().stance).toBeNull();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('preview builds: forwards the lead and diagnostics, and maps the native numbers to a PoseDiag', async () => {
    const { session } = fakeSession();
    const onDiag = jest.fn();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} onDiag={onDiag} leadMs={30} />);
    expect(mockNativeProps).toMatchObject({ diagnostics: true, leadMs: 30 });
    await fire('onDiag', { fps: 27, inferMs: 31, ageP50: 78, ageP95: 120, drawMs: 2.1, backend: 'GPU', variant: 'full', rung: 'mask', mirrorX: true, region: '288x640', view: '360x560', maskMs: 4, delegateNote: 'x' });
    const want: PoseDiag = { fps: 27, inferMs: 31, ageP50: 78, ageP95: 120, backend: 'GPU', variant: 'full', rung: 'mask', engine: 'native', region: '288x640', view: '360x560', mirrorX: true, leadMs: 30 };
    expect(onDiag).toHaveBeenCalledWith(want);
  });

  it('main builds: no diagnostics subscription', async () => {
    const { session } = fakeSession();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} />);
    expect(mockNativeProps!.diagnostics).toBe(false);
    expect(mockNativeProps!.onDiag).toBeUndefined();
  });

  it('the WebView engine reports a minimal PoseDiag once a second', async () => {
    mockAvailable = false;
    const { session } = fakeSession();
    const onDiag = jest.fn();
    let clock = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      await render(<PoseCameraFeed active session={session} retryToken={0} {...handlers()} onDiag={onDiag} />);
      await webMessage({ t: 'pose', kind: 'ready', backend: 'GPU' });
      for (let i = 0; i < 6; i++) {
        clock += 250;
        await webMessage({ t: 'frame', ts: 1000 + i * 250, w: 480, h: 640, ms: 18, b: 100, people: [body()] });
      }
      expect(onDiag).toHaveBeenCalledWith(expect.objectContaining({ engine: 'webview', rung: 'webview', backend: 'GPU', inferMs: 18, ageP50: null, ageP95: null }));
    } finally {
      jest.restoreAllMocks();
    }
  });
});
