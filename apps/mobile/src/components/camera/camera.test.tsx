/// <reference types="node" />
import { FRAMING_MESSAGES, LivePoseSession, LiveRepVerifier, type FramingAssessment, type LiveRepState } from '@form/domain';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { useCameraPermissions } from 'expo-camera';
import { Text } from 'react-native';
import { createPoseProvider, NATIVE_POSE_UNAVAILABLE } from '@/lib/pose/mediapipe';
import { cameraErrorStatus, cameraScreenModel, type CameraStatus, type LiveReadout, type PoseStatus } from '@/lib/pose/status';
import { livePoseSupport } from '@/lib/pose/support';
import { formWord } from '@/lib/workoutSession';
import { LiveCameraView, type LiveCameraViewProps } from './LiveCameraView';
import { PoseCameraFeed } from './PoseCameraFeed';
import { MEDIAPIPE_VERSION, poseEngineHtml, skeletonIndexEdges } from './poseEngineHtml';

jest.mock('expo-camera', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    useCameraPermissions: jest.fn(),
    CameraView: ({ onCameraReady }: { onCameraReady?: () => void }) => (
      // A stand-in for the native preview (not a control); the press is only how tests signal "ready".
      <MockText testID="camera-view" accessible={false} onPress={onCameraReady}>
        camera
      </MockText>
    ),
  };
});

// The WebView engine: a stand-in that records its props so tests can post engine messages.
const mockWeb: { props: { onMessage?: (e: { nativeEvent: { data: string } }) => void; source?: { html: string } } | null; inject: jest.Mock } = { props: null, inject: jest.fn() };
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View: MockView } = jest.requireActual('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: { testID?: string }, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ injectJavaScript: mockWeb.inject }));
      mockWeb.props = props as typeof mockWeb.props;
      return <MockView testID={props.testID} />;
    }),
  };
});
const engine = async (m: object) => {
  await act(async () => mockWeb.props!.onMessage!({ nativeEvent: { data: JSON.stringify(m) } }));
};
/** 33 MediaPipe landmarks of a person standing side-on, all clearly visible. */
const standing = (): [number, number, number][] => Array.from({ length: 33 }, (_, i) => [0.5 + (i % 3) * 0.01, 0.1 + (i / 33) * 0.8, 0.95]);

const LIVE: CameraStatus = { kind: 'live' };
const READY: PoseStatus = { kind: 'ready', backend: 'GPU' };
const framing = (issue: FramingAssessment['issue']): FramingAssessment => ({
  issue,
  message: issue ? FRAMING_MESSAGES[issue] : "Tracking — you're in position.",
  trackable: issue === null,
  side: issue === null ? 'left' : null,
  missing: [],
});
const readout = (issue: FramingAssessment['issue'], angleDeg: number | null = null, rep: LiveRepState | null = null): LiveReadout => ({
  framing: framing(issue),
  trackable: issue === null,
  angleDeg,
  people: issue === 'no_person' ? 0 : 1,
  fps: 28,
  latencyMs: 19,
  rep,
  traceFull: false,
});

/** Real rep engine state: squats through the same LiveRepVerifier the camera uses. */
function repState(bottoms: number[], repMs = 2000): LiveRepState {
  const v = LiveRepVerifier.for('bodyweight_squat')!;
  let t = 0;
  const at = (a: number) => v.push({ tMs: (t += 50), angleDeg: a, confidence: 0.9, features: { torsoLeanDeg: 20 } });
  for (let i = 0; i < 5; i++) at(172);
  for (const bottom of bottoms) {
    const n = repMs / 50;
    for (let i = 0; i <= n; i++) at(172 - (172 - bottom) * (i <= n / 2 ? i / (n / 2) : (n - i) / (n / 2)));
    for (let i = 0; i < 4; i++) at(172);
  }
  return v.state(t);
}

describe('cameraScreenModel', () => {
  it('never opens the camera unasked: off shows the explainer with a start action', () => {
    const m = cameraScreenModel({ kind: 'off' }, { kind: 'idle' }, null, false);
    expect(m.overlay).toMatchObject({ kind: 'permission', action: 'start', actionLabel: 'Turn on camera' });
    expect(m.overlay!.message).toMatch(/never recorded or uploaded/);
  });

  it('permission denied: ask again when possible, otherwise send to settings; manual logging stays available', () => {
    const again = cameraScreenModel({ kind: 'denied', canAskAgain: true }, READY, null, false);
    expect(again.overlay).toMatchObject({ kind: 'permission', action: 'retry' });
    expect(again.overlay!.message).toMatch(/log your sets manually/);
    expect(cameraScreenModel({ kind: 'denied', canAskAgain: false }, READY, null, false).overlay).toMatchObject({ action: 'settings', actionLabel: 'Open settings' });
  });

  it('camera unavailable reasons', () => {
    const m = (reason: Extract<CameraStatus, { kind: 'unavailable' }>['reason']) => cameraScreenModel({ kind: 'unavailable', reason }, READY, null, false).overlay!;
    expect(m('no_camera')).toMatchObject({ title: 'No camera found', action: 'retry' });
    expect(m('in_use')).toMatchObject({ title: 'Camera is busy', action: 'retry' });
    expect(m('ended')).toMatchObject({ title: 'Camera disconnected', action: 'retry' });
    expect(m('insecure').action).toBeNull();
    expect(m('unsupported').action).toBeNull();
  });

  it('provider failure blocks with retry; an unsupported provider keeps the feed with honest guidance', () => {
    expect(cameraScreenModel(LIVE, { kind: 'failed', message: "The pose model couldn't be loaded.", retryable: true }, null, false).overlay).toMatchObject({ kind: 'error', action: 'retry' });
    expect(cameraScreenModel(LIVE, { kind: 'failed', message: 'x', retryable: false }, null, false).overlay!.action).toBeNull();
    const u = cameraScreenModel(LIVE, { kind: 'unsupported', message: NATIVE_POSE_UNAVAILABLE }, null, false);
    expect(u.overlay).toBeNull();
    expect(u.feedback!.message).toContain(NATIVE_POSE_UNAVAILABLE);
  });

  it('loading, searching, paused and interrupted states', () => {
    expect(cameraScreenModel(LIVE, { kind: 'loading' }, null, false).feedback!.message).toMatch(/Getting your camera coach ready/);
    expect(cameraScreenModel(LIVE, READY, null, false).feedback!.message).toBe('Looking for you…');
    expect(cameraScreenModel(LIVE, READY, readout(null), true).feedback!.message).toMatch(/^Paused/);
    expect(cameraScreenModel({ kind: 'interrupted' }, READY, null, false).feedback).toMatchObject({ tone: 'adjust' });
  });

  it('rep cues: framing problems first, then the latest rep cue, then where you are in the movement', () => {
    const good = repState([88]);
    expect(good.feedback).toMatchObject({ headline: 'CORRECT FORM' });
    expect(cameraScreenModel(LIVE, READY, readout(null, 172, good), false).feedback).toMatchObject({ headline: 'CORRECT FORM', tone: 'ready' });
    // Can't see you → that wins over the cue.
    expect(cameraScreenModel(LIVE, READY, readout('too_close', null, good), false).feedback).toEqual({ message: 'Move farther away so your full body is visible.', tone: 'adjust' });
    const partial = repState([130]);
    expect(cameraScreenModel(LIVE, READY, readout(null, 172, partial), false).feedback).toMatchObject({ headline: 'REP NOT VERIFIED', message: 'Go slightly deeper', tone: 'adjust' });
    const fresh = LiveRepVerifier.for('bodyweight_squat')!.state(0);
    expect(cameraScreenModel(LIVE, READY, readout(null, 150, fresh), false).feedback).toEqual({ message: 'Stand tall to start', tone: 'info' });
    expect(cameraScreenModel(LIVE, READY, { ...readout(null, 150, fresh), traceFull: true }, false).feedback!.message).toMatch(/log it to keep counting/);
  });

  it('framing guidance comes straight from the domain assessment', () => {
    expect(cameraScreenModel(LIVE, READY, readout('too_close'), false).feedback).toEqual({ message: 'Move farther away so your full body is visible.', tone: 'adjust' });
    expect(cameraScreenModel(LIVE, READY, readout('multiple_people'), false).feedback!.message).toBe(FRAMING_MESSAGES.multiple_people);
    expect(cameraScreenModel(LIVE, READY, readout(null), false).feedback!.tone).toBe('ready');
  });

  it('maps browser camera errors', () => {
    expect(cameraErrorStatus({ name: 'NotAllowedError' })).toEqual({ kind: 'denied', canAskAgain: true });
    expect(cameraErrorStatus({ name: 'NotFoundError' })).toEqual({ kind: 'unavailable', reason: 'no_camera' });
    expect(cameraErrorStatus({ name: 'NotReadableError' })).toEqual({ kind: 'unavailable', reason: 'in_use' });
    expect(cameraErrorStatus(new Error('?'))).toEqual({ kind: 'unavailable', reason: 'unsupported' });
  });
});

function props(over: Partial<LiveCameraViewProps> = {}): LiveCameraViewProps {
  return {
    exerciseName: 'Bodyweight Squat',
    setLabel: 'Set 2 of 3',
    targetLabel: '10–15 reps',
    setupText: 'Place the phone 2–3 m away.',
    model: cameraScreenModel(LIVE, READY, readout(null, 92), false),
    readout: readout(null, 92),
    paused: false,
    feed: <Text>FEED</Text>,
    onAction: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onEnd: jest.fn(),
    ...over,
  };
}

describe('LiveCameraView', () => {
  it('shows exercise, set and target in plain words — no technical readouts — and no form or ROM before a verified rep', async () => {
    await render(<LiveCameraView {...props()} />);
    expect(screen.getByText('Bodyweight Squat')).toBeTruthy();
    expect(screen.getByText('Set 2 of 3 · 10–15 reps')).toBeTruthy();
    expect(screen.getByText('Full body detected')).toBeTruthy();
    expect(screen.queryByText('92°')).toBeNull(); // joint angles stay behind the scenes
    expect(screen.queryByText(/fps|ms\b|angle|confidence/i)).toBeNull();
    expect(screen.getByLabelText(/^Verified reps: 0/)).toBeTruthy();
    expect(screen.getByText('After your first rep')).toBeTruthy();
    expect(screen.getByLabelText('Range of motion: none yet')).toBeTruthy();
    expect(screen.getByText('Private · not recorded')).toBeTruthy();
    expect(screen.getByText('FEED')).toBeTruthy();
  });

  it('verified reps, form, ROM bar, phase and the set quality line come from the rep engine', async () => {
    const rep = repState([88, 90, 99, 130]);
    expect(rep.verifiedReps).toBe(3);
    const r = readout(null, 172, rep);
    await render(<LiveCameraView {...props({ readout: r, model: cameraScreenModel(LIVE, READY, r, false), onLogSet: jest.fn() })} />);
    expect(screen.getByLabelText(/^Verified reps: 3/)).toBeTruthy();
    expect(screen.getByLabelText('3 verified reps')).toBeTruthy(); // the counter on the feed
    expect(screen.queryByText(/standing|lowering|rising/i)).toBeNull(); // no movement-state labels
    expect(screen.getByLabelText(new RegExp(`^Form: ${formWord(rep.lastRep!.formScore)}`))).toBeTruthy();
    expect(screen.getByLabelText(`Range of motion: ${rep.lastRep!.romPercent} percent`)).toBeTruthy();
    expect(screen.getByText(/3 verified reps · 2 perfect · average range \d+%/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log set · 3 verified reps' })).toBeTruthy();
  });

  it('with nothing verified, a workout offers manual logging instead of saving an empty set', async () => {
    const onEnd = jest.fn();
    const r = readout(null, 172, repState([130]));
    await render(<LiveCameraView {...props({ readout: r, model: cameraScreenModel(LIVE, READY, r, false), onLogSet: jest.fn(), onEnd })} />);
    expect(screen.queryByRole('button', { name: /^Log set/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Log reps manually' }));
    expect(onEnd).toHaveBeenCalled();
  });

  it('logging a set shows the server verdict; practice mode offers a reset', async () => {
    const onLogSet = jest.fn();
    const r = readout(null, 172, repState([88]));
    const { rerender } = await render(<LiveCameraView {...props({ readout: r, model: cameraScreenModel(LIVE, READY, r, false), onLogSet })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Log set · 1 verified rep' }));
    expect(onLogSet).toHaveBeenCalled();
    await rerender(<LiveCameraView {...props({ readout: r, model: cameraScreenModel(LIVE, READY, r, false), onLogSet, logMessage: { tone: 'success', text: 'Set saved — 1 verified rep, form 100.' } })} />);
    expect(screen.getByText('Set saved — 1 verified rep, form 100.')).toBeTruthy();
    const onResetCount = jest.fn();
    await rerender(<LiveCameraView {...props({ setLabel: null, readout: r, model: cameraScreenModel(LIVE, READY, r, false), onResetCount })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Reset count' }));
    expect(onResetCount).toHaveBeenCalled();
  });

  it('feedback region announces framing problems', async () => {
    const r = readout('too_close');
    await render(<LiveCameraView {...props({ readout: r, model: cameraScreenModel(LIVE, READY, r, false) })} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Move farther away so your full body is visible.')).toBeTruthy();
    expect(screen.queryByText('Full body detected')).toBeNull();
    expect(screen.getByText('Not counting yet')).toBeTruthy();
  });

  it('turning the camera on is an explicit action, with the setup shown first', async () => {
    const onAction = jest.fn();
    await render(<LiveCameraView {...props({ model: cameraScreenModel({ kind: 'off' }, { kind: 'idle' }, null, false), readout: null, onAction })} />);
    expect(screen.getByText(/Setup: Place the phone/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Turn on camera' }));
    expect(onAction).toHaveBeenCalledWith('start');
  });

  it('permission denied offers a retry', async () => {
    const onAction = jest.fn();
    await render(<LiveCameraView {...props({ model: cameraScreenModel({ kind: 'denied', canAskAgain: true }, READY, null, false), readout: null, onAction })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(onAction).toHaveBeenCalledWith('retry');
  });

  it('pause, resume and end', async () => {
    const p = props();
    const { rerender } = await render(<LiveCameraView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(p.onPause).toHaveBeenCalled();
    await fireEvent.press(screen.getAllByRole('button', { name: 'End camera' })[0]!);
    expect(p.onEnd).toHaveBeenCalled();
    await rerender(<LiveCameraView {...p} paused model={cameraScreenModel(LIVE, READY, p.readout, true)} />);
    expect(screen.getByText(/The camera is off while paused/)).toBeTruthy();
    expect(screen.queryByText('Full body detected')).toBeNull(); // nothing stale while paused
    await fireEvent.press(screen.getAllByRole('button', { name: 'Resume' })[0]!);
    expect(p.onResume).toHaveBeenCalled();
  });

  it('practice mode says nothing is logged', async () => {
    await render(<LiveCameraView {...props({ setLabel: null })} />);
    expect(screen.getByText('Practice — nothing is logged')).toBeTruthy();
  });
});

describe('native camera feed', () => {
  const mocked = useCameraPermissions as jest.Mock;
  const session = LivePoseSession.for('bodyweight_squat')!;
  const handlers = () => ({ onCamera: jest.fn(), onPose: jest.fn(), onReadout: jest.fn() });

  it('runs pose on the phone: engine frames feed the shared session and produce readouts', async () => {
    mocked.mockReturnValue([{ granted: true, canAskAgain: true }, jest.fn()]);
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    await engine({ t: 'pose', kind: 'loading' });
    await engine({ t: 'camera', kind: 'live' });
    await engine({ t: 'pose', kind: 'ready', backend: 'GPU' });
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'loading' });
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'ready', backend: 'GPU' });
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'live' });
    await engine({ t: 'frame', ts: 1000, w: 640, h: 480, ms: 18, b: 120, people: [standing()] });
    expect(h.onReadout).toHaveBeenCalledWith(expect.objectContaining({ people: 1, latencyMs: 18 }));
    // The skeleton colour follows tracking quality.
    expect(mockWeb.inject).toHaveBeenCalledWith(expect.stringContaining('window.__skeletonColor'));
  });

  it('real MediaPipe output for a person doing a squat (side-on) is tracked, with a knee angle', async () => {
    // Captured from the engine's exact MediaPipe build and model, run on a photo of a mini squat.
    const real: [number, number, number][] = [[0.4703,0.2144,0.9989],[0.4771,0.2007,0.9984],[0.4791,0.2005,0.9983],[0.4813,0.2003,0.9986],[0.4757,0.2009,0.9975],[0.4766,0.2006,0.997],[0.4779,0.2003,0.9976],[0.498,0.2084,0.9966],[0.4938,0.207,0.9946],[0.4749,0.2288,0.9976],[0.4733,0.2285,0.9966],[0.513,0.298,0.9999],[0.5024,0.2941,0.9993],[0.5151,0.4211,0.9925],[0.5087,0.4205,0.0582],[0.5119,0.5413,0.9561],[0.5091,0.5293,0.1045],[0.5131,0.5717,0.9166],[0.5071,0.5604,0.1146],[0.5108,0.5717,0.9167],[0.5089,0.5615,0.1178],[0.5102,0.5636,0.8926],[0.5087,0.5481,0.1184],[0.505,0.5151,0.9997],[0.5003,0.5073,0.9996],[0.4735,0.6567,0.9135],[0.4771,0.6463,0.4294],[0.5058,0.8123,0.9041],[0.5012,0.7913,0.6192],[0.5197,0.8412,0.8229],[0.5166,0.82,0.6584],[0.4559,0.8447,0.8808],[0.4566,0.8199,0.6863]];
    mocked.mockReturnValue([{ granted: true, canAskAgain: true }, jest.fn()]);
    const h = handlers();
    await render(<PoseCameraFeed active session={LivePoseSession.for('bodyweight_squat')!} retryToken={0} {...h} />);
    await engine({ t: 'camera', kind: 'live' });
    await engine({ t: 'pose', kind: 'ready', backend: 'GPU' });
    for (let i = 0; i < 12; i++) await engine({ t: 'frame', ts: 1000 + i * 33, w: 640, h: 480, ms: 30, b: 150, people: [real] });
    const last = h.onReadout.mock.calls.map((c) => c[0]).filter(Boolean).at(-1) as LiveReadout;
    expect(last.people).toBe(1);
    expect(last.framing.issue).toBeNull();
    expect(last.trackable).toBe(true);
    expect(last.angleDeg).toBeGreaterThan(120);
    expect(last.angleDeg).toBeLessThan(175);
  });

  it('maps engine camera errors and offline model failures to honest states', async () => {
    mocked.mockReturnValue([{ granted: true, canAskAgain: true }, jest.fn()]);
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    await engine({ t: 'camera', kind: 'error', name: 'NotAllowedError' });
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'denied', canAskAgain: true });
    await engine({ t: 'camera', kind: 'error', name: 'NotReadableError' });
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'unavailable', reason: 'in_use' });
    await engine({ t: 'pose', kind: 'failed', offline: true });
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'failed', message: 'Camera coaching needs an internet connection the first time it loads.', retryable: true });
  });

  it('requests permission when active and reports a denial', async () => {
    const request = jest.fn().mockResolvedValue({ granted: false, canAskAgain: false });
    mocked.mockReturnValue([{ granted: false, canAskAgain: true }, request]);
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    await act(async () => {});
    expect(request).toHaveBeenCalled();
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'requesting' });
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'denied', canAskAgain: false });
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('a permanently denied permission goes straight to settings guidance', async () => {
    const request = jest.fn();
    mocked.mockReturnValue([{ granted: false, canAskAgain: false }, request]);
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    expect(request).not.toHaveBeenCalled();
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'denied', canAskAgain: false });
  });

  it('stops the camera when inactive (paused/ended)', async () => {
    mocked.mockReturnValue([{ granted: true, canAskAgain: true }, jest.fn()]);
    const h = handlers();
    const { rerender } = await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    expect(screen.getByTestId('camera-view')).toBeTruthy();
    await rerender(<PoseCameraFeed active={false} session={session} retryToken={0} {...h} />);
    expect(screen.queryByTestId('camera-view')).toBeNull();
  });

  it('pose tracking is available on phones, through the camera view’s engine', async () => {
    expect(livePoseSupport().available).toBe(true);
    // The provider interface isn't how phones track; it says so rather than pretending.
    const provider = createPoseProvider();
    expect((await provider.load()).ok).toBe(false);
  });

  it('the engine page loads the same MediaPipe version and model, and knows the skeleton', () => {
    const html = poseEngineHtml({ modelUrl: 'https://example.test/pose.task', colors: { good: '#0f0', warn: '#ff0', other: '#f00' } });
    expect(html).toContain(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`);
    expect(html).toContain("/vision_bundle.js");
    expect(html).toContain("/wasm");
    expect(html).toContain('https://example.test/pose.task');
    expect(html).toContain("facingMode: 'user'");
    expect(skeletonIndexEdges().length).toBeGreaterThan(8);
    // Kept in step with the package the web build bundles.
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../../node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')) as { version: string };
    expect(MEDIAPIPE_VERSION).toBe(pkg.version);
    expect(skeletonIndexEdges().every(([a, b]) => a >= 0 && a < 33 && b >= 0 && b < 33)).toBe(true);
  });
});
