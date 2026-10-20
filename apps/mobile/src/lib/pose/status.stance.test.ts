import { CAMERA_REQUIREMENTS, FRAMING_MESSAGES, type FramingAssessment, type LiveRepState } from '@form/domain';
import { cameraScreenModel, trackingLabel, type CameraStatus, type LiveReadout, type PoseStatus } from './status';

const LIVE: CameraStatus = { kind: 'live' };
const READY: PoseStatus = { kind: 'ready', backend: 'GPU' };
const HINT = 'Turn side-on — stand so the camera sees your side, not your front.';

const framing = (issue: FramingAssessment['issue']): FramingAssessment => ({
  issue,
  message: issue ? FRAMING_MESSAGES[issue] : "Tracking — you're in position.",
  trackable: issue === null,
  side: issue === null ? 'left' : null,
  missing: [],
});
const readout = (extra: Partial<LiveReadout> = {}, issue: FramingAssessment['issue'] = null): LiveReadout => ({
  framing: framing(issue),
  trackable: issue === null,
  angleDeg: null,
  people: 1,
  fps: 28,
  latencyMs: 19,
  rep: null,
  traceFull: false,
  ...extra,
});
/** A rep state that carries a coaching cue (the engine's real shape is irrelevant to the priority). */
const cueRep = (phase: string): LiveRepState =>
  ({ phase, phaseLabel: 'Hold still', feedback: { headline: 'CORRECT FORM', message: 'Nice depth.', tone: 'good' } }) as unknown as LiveRepState;

const model = (r: LiveReadout | null, paused = false) => cameraScreenModel(LIVE, READY, r, paused);

describe('cameraScreenModel stance hint', () => {
  it('shows the side-on hint as an adjust-tone line when the user is front-on', () => {
    expect(model(readout({ stance: 'front-on' })).feedback).toEqual({ message: HINT, tone: 'adjust' });
  });

  it('is absent when stance is missing, null or the readout has no stance field', () => {
    expect(model(readout()).feedback?.message).not.toBe(HINT);
    expect(model(readout({ stance: null })).feedback?.message).not.toBe(HINT);
    expect(model(readout({ stance: null })).feedback).toEqual({ message: "Tracking — you're in position.", tone: 'ready' });
  });

  it('loses to a framing issue', () => {
    const m = model(readout({ stance: 'front-on' }, 'partial_body'));
    expect(m.feedback).toEqual({ message: FRAMING_MESSAGES.partial_body, tone: 'adjust' });
  });

  it('loses to a full trace', () => {
    const m = model(readout({ stance: 'front-on', traceFull: true }));
    expect(m.feedback?.message).toMatch(/as long as one set can be/);
  });

  it('beats a rep cue and the phase line', () => {
    const withCue = model(readout({ stance: 'front-on', rep: cueRep('down') }));
    expect(withCue.feedback).toEqual({ message: HINT, tone: 'adjust' });
    const noStance = model(readout({ rep: cueRep('down') }));
    expect(noStance.feedback).toEqual({ headline: 'CORRECT FORM', message: 'Nice depth.', tone: 'ready' });
    const unknownPhase = model(readout({ stance: 'front-on', rep: { phase: 'unknown', phaseLabel: 'Get in position', feedback: null } as unknown as LiveRepState }));
    expect(unknownPhase.feedback?.message).toBe(HINT);
  });

  it('does not override pause, loading or a missing readout', () => {
    expect(model(readout({ stance: 'front-on' }), true).feedback?.message).toMatch(/^Paused/);
    expect(cameraScreenModel(LIVE, { kind: 'loading', stage: 'starting' }, readout({ stance: 'front-on' }), false).overlay?.title).toBe('Almost ready');
    expect(model(null).feedback?.message).toBe('Looking for you…');
  });
});

describe('trackingLabel', () => {
  it('names the parts each camera-ready exercise needs', () => {
    expect(trackingLabel('squat')).toBe('Shoulder, hip, knee and ankle in view');
    expect(trackingLabel('bodyweight_squat')).toBe('Shoulder, hip, knee and ankle in view');
    expect(trackingLabel('goblet_squat')).toBe('Shoulder, hip, knee and ankle in view');
    expect(trackingLabel('lunge')).toBe('Shoulder, hip, knee and ankle in view');
    expect(trackingLabel('push_up')).toBe('Shoulder to ankle in view');
    expect(trackingLabel('bicep_curl')).toBe('Arm, shoulder and hip in view');
  });

  it('has a specific label for every camera-ready exercise and never claims the full body', () => {
    for (const id of Object.keys(CAMERA_REQUIREMENTS)) {
      expect(trackingLabel(id)).not.toBe(trackingLabel('__unknown__'));
      expect(trackingLabel(id)).not.toMatch(/full body/i);
    }
  });

  it('falls back to a generic truthful label for an unknown exercise', () => {
    expect(trackingLabel('nope')).toBe('Your body in view');
  });
});
