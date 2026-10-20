import { render, screen, within } from '@testing-library/react-native';
import { LiveRepVerifier, type LiveRepState } from '@form/domain';
import { cameraScreenModel, WAITING_TIP, type GetReadyStep, type LiveReadout, type PoseStatus } from '@/lib/pose/status';
import { LiveCameraView, type LiveCameraViewProps } from './LiveCameraView';

// The first-run wait (a real progress card with the setup tip) and the "get into position" countdown,
// as the camera screen model describes them and as the view draws them.

const LIVE = { kind: 'live' } as const;
const READY: PoseStatus = { kind: 'ready', backend: 'GPU' };

/** Real rep engine state with two full squats (the same way camera.test builds it). */
function twoReps(): LiveRepState {
  const v = LiveRepVerifier.for('bodyweight_squat')!;
  let t = 0;
  const at = (a: number) => v.push({ tMs: (t += 50), angleDeg: a, confidence: 0.9, features: { torsoLeanDeg: 20 } });
  for (let i = 0; i < 5; i++) at(172);
  for (const bottom of [88, 90]) {
    for (let i = 0; i <= 40; i++) at(172 - (172 - bottom) * (i <= 20 ? i / 20 : (40 - i) / 20));
    for (let i = 0; i < 4; i++) at(172);
  }
  return v.state(t);
}
const readout = (rep: LiveRepState | null): LiveReadout => ({
  framing: { issue: null, message: "Tracking — you're in position.", trackable: true, side: 'left', missing: [] },
  trackable: true,
  angleDeg: 172,
  people: 1,
  fps: 28,
  latencyMs: 19,
  rep,
  traceFull: false,
});

function props(over: Partial<LiveCameraViewProps> = {}): LiveCameraViewProps {
  return {
    exerciseId: 'bodyweight_squat',
    exerciseName: 'Bodyweight Squat',
    setLabel: null,
    targetLabel: null,
    setupText: 'Place the phone 2–3 m away.',
    model: cameraScreenModel(LIVE, READY, null, false),
    readout: null,
    paused: false,
    feed: null,
    onAction: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onEnd: jest.fn(),
    ...over,
  };
}

describe('first-run loading card (model)', () => {
  it('while the model downloads: a friendly line, the real percentage and the setup tip', () => {
    const m = cameraScreenModel(LIVE, { kind: 'loading', stage: 'model', pct: 42 }, null, false);
    expect(m.overlay).toEqual({
      kind: 'loading',
      title: 'Getting your camera coach ready',
      message: 'First time only — about 10 MB. After this it starts in seconds.',
      action: null,
      actionLabel: null,
      progress: 0.42,
      tip: true,
    });
    expect(m.feedback).toBeNull();
  });

  it('shows progress while the camera is still opening, and clamps it below 100 until the file is really done', () => {
    const m = cameraScreenModel({ kind: 'requesting' }, { kind: 'loading', stage: 'model', pct: 10 }, null, false);
    expect(m.overlay).toMatchObject({ kind: 'loading', title: 'Getting your camera coach ready', progress: 0.1 });
    expect(cameraScreenModel(LIVE, { kind: 'loading', stage: 'model', pct: 99.6 }, null, false).overlay!.progress).toBe(0.99);
    expect(cameraScreenModel(LIVE, { kind: 'loading', stage: 'model' }, null, false).overlay!.progress).toBeNull(); // size unknown: no fake bar
  });

  it('with nothing to report yet the camera-opening card stays as it was', () => {
    const m = cameraScreenModel({ kind: 'requesting' }, { kind: 'idle' }, null, false);
    expect(m.overlay).toMatchObject({ kind: 'loading', title: '', message: '' });
    expect(m.feedback!.message).toMatch(/tap Allow/);
  });

  it('a model already on the phone goes straight to "almost ready" with no download copy or bar', () => {
    for (const pose of [{ kind: 'loading', stage: 'model', pct: 100 }, { kind: 'loading', stage: 'starting' }] as PoseStatus[]) {
      expect(cameraScreenModel(LIVE, pose, null, false).overlay).toMatchObject({ title: 'Almost ready', message: 'Starting your camera coach…', progress: null, tip: true });
    }
  });

  it('the WebView engine downloads its runtime too, and says so honestly', () => {
    expect(cameraScreenModel(LIVE, { kind: 'loading', stage: 'runtime', pct: 5 }, null, false).overlay!.message).toMatch(/about 20 MB/);
  });

  it('the view draws the card: title, message, percentage, an accessible bar and the tip', async () => {
    const model = cameraScreenModel(LIVE, { kind: 'loading', stage: 'model', pct: 42 }, null, false);
    await render(<LiveCameraView {...props({ model })} />);
    expect(screen.getByText('Getting your camera coach ready')).toBeTruthy();
    expect(screen.getByText('First time only — about 10 MB. After this it starts in seconds.')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByLabelText('Camera coach download').props.accessibilityValue).toMatchObject({ now: 42 });
    expect(screen.getByText(WAITING_TIP)).toBeTruthy();
    expect(WAITING_TIP).toMatch(/side-on.*whole body.*2–3 m.*light/);
    // The way out stays reachable while waiting.
    expect(screen.getByRole('button', { name: 'End camera' })).toBeTruthy();
  });

  it('without a known size there is no bar and no percentage, just the card', async () => {
    const model = cameraScreenModel(LIVE, { kind: 'loading' }, null, false);
    await render(<LiveCameraView {...props({ model })} />);
    expect(screen.getByText('Getting your camera coach ready')).toBeTruthy();
    expect(screen.getByText('Just a moment…')).toBeTruthy();
    expect(screen.queryByLabelText('Camera coach download')).toBeNull();
    expect(screen.getByText(WAITING_TIP)).toBeTruthy();
  });
});

describe('get-into-position countdown', () => {
  const step = (s: GetReadyStep | null, rep: LiveRepState | null = twoReps()) => {
    const r = readout(rep);
    return props({ readout: r, model: cameraScreenModel(LIVE, READY, r, false, s), getReady: s });
  };

  it('the model tells the user what is about to happen, only once the coach is ready', () => {
    expect(cameraScreenModel(LIVE, READY, null, false, 3).feedback).toMatchObject({ headline: 'GET INTO POSITION', tone: 'info' });
    expect(cameraScreenModel(LIVE, READY, null, false, 'ready').feedback).toEqual({ message: 'Ready — start when you like.', tone: 'ready' });
    expect(cameraScreenModel(LIVE, READY, null, false, null).feedback!.message).toBe('Looking for you…');
    // Not ready yet: the loading card wins, a stray countdown shows nothing.
    expect(cameraScreenModel(LIVE, { kind: 'loading' }, null, false, 3).overlay).toMatchObject({ kind: 'loading' });
  });

  it('shows the number over the video and counts nothing while the numbers run', async () => {
    await render(<LiveCameraView {...step(2)} />);
    expect(screen.getByTestId('get-ready')).toBeTruthy();
    const badge = within(screen.getByTestId('get-ready'));
    expect(badge.getByText('Get into position')).toBeTruthy();
    expect(badge.getByText('2')).toBeTruthy();
    expect(screen.queryByLabelText(/^\d+ verified reps?$/)).toBeNull(); // the counter chip
    expect(screen.getByText('Not counting yet')).toBeTruthy();
    expect(screen.queryByText('Shoulder, hip, knee and ankle in view')).toBeNull();
  });

  it('the brief ready state is just a label: no number, and the screen is otherwise normal', async () => {
    await render(<LiveCameraView {...step('ready')} />);
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.queryByText('Get into position')).toBeNull();
    expect(screen.getByLabelText('2 verified reps')).toBeTruthy();
  });

  it('no countdown, no badge', async () => {
    await render(<LiveCameraView {...step(null)} />);
    expect(screen.queryByTestId('get-ready')).toBeNull();
    expect(screen.getByLabelText('2 verified reps')).toBeTruthy();
  });
});
