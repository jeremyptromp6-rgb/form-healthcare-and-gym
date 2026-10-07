import { FRAMING_MESSAGES, LivePoseSession, LiveRepVerifier, type FramingAssessment, type LiveRepState } from '@form/domain';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import { Text } from 'react-native';
import { createPoseProvider, NATIVE_POSE_UNAVAILABLE } from '@/lib/pose/mediapipe';
import { cameraErrorStatus, cameraScreenModel, type CameraStatus, type LiveReadout, type PoseStatus } from '@/lib/pose/status';
import { livePoseSupport } from '@/lib/pose/support';
import { formWord } from '@/lib/workoutSession';
import { LiveCameraView, type LiveCameraViewProps } from './LiveCameraView';
import { PoseCameraFeed } from './PoseCameraFeed';

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

  it('reports pose as unsupported in this build and never produces readouts', async () => {
    mocked.mockReturnValue([{ granted: true, canAskAgain: true }, jest.fn()]);
    const h = handlers();
    await render(<PoseCameraFeed active session={session} retryToken={0} {...h} />);
    expect(h.onPose).toHaveBeenCalledWith({ kind: 'unsupported', message: NATIVE_POSE_UNAVAILABLE });
    await fireEvent.press(screen.getByTestId('camera-view')); // camera ready
    expect(h.onCamera).toHaveBeenCalledWith({ kind: 'live' });
    expect(h.onReadout).not.toHaveBeenCalled();
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

  it('the native pose provider is honestly unconfigured', async () => {
    const provider = createPoseProvider();
    expect(provider.status().state).toBe('unconfigured');
    expect((await provider.load()).ok).toBe(false);
    expect((await provider.estimate({}, 0)).ok).toBe(false);
    expect(livePoseSupport().available).toBe(false);
  });
});
