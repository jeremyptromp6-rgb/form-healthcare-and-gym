import { bodyOrientationRatio, CLEAR_READINGS, FRONT_ON_RATIO, FRONT_ON_READINGS, StanceTracker, type Landmark } from './stance';

/** Captured from the real MediaPipe model on a photo of a mini squat, side-on (the camera test's vector). */
const SIDE_ON: Landmark[] = [[0.4703,0.2144,0.9989],[0.4771,0.2007,0.9984],[0.4791,0.2005,0.9983],[0.4813,0.2003,0.9986],[0.4757,0.2009,0.9975],[0.4766,0.2006,0.997],[0.4779,0.2003,0.9976],[0.498,0.2084,0.9966],[0.4938,0.207,0.9946],[0.4749,0.2288,0.9976],[0.4733,0.2285,0.9966],[0.513,0.298,0.9999],[0.5024,0.2941,0.9993],[0.5151,0.4211,0.9925],[0.5087,0.4205,0.0582],[0.5119,0.5413,0.9561],[0.5091,0.5293,0.1045],[0.5131,0.5717,0.9166],[0.5071,0.5604,0.1146],[0.5108,0.5717,0.9167],[0.5089,0.5615,0.1178],[0.5102,0.5636,0.8926],[0.5087,0.5481,0.1184],[0.505,0.5151,0.9997],[0.5003,0.5073,0.9996],[0.4735,0.6567,0.9135],[0.4771,0.6463,0.4294],[0.5058,0.8123,0.9041],[0.5012,0.7913,0.6192],[0.5197,0.8412,0.8229],[0.5166,0.82,0.6584],[0.4559,0.8447,0.8808],[0.4566,0.8199,0.6863]];

const W = 640;
const H = 480;

/** A person facing the camera: shoulders as wide as the torso is long (ratio about 1). */
function frontOn(vis = 0.95): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => [0.5, 0.5, vis]);
  lm[11] = [0.4, 0.3, vis];
  lm[12] = [0.6, 0.3, vis];
  lm[23] = [0.43, 0.6, vis];
  lm[24] = [0.57, 0.6, vis];
  return lm;
}

describe('bodyOrientationRatio', () => {
  it('is large front-on and about 0.07 for the real side-on squat', () => {
    expect(bodyOrientationRatio(frontOn(), W, H)).toBeGreaterThanOrEqual(FRONT_ON_RATIO);
    const side = bodyOrientationRatio(SIDE_ON, W, H)!;
    expect(side).toBeGreaterThan(0.05);
    expect(side).toBeLessThan(0.1);
  });

  it('measures in pixels, so the frame shape matters', () => {
    const lm = frontOn();
    // Shoulder width 0.2 of the width, torso 0.3 of the height.
    expect(bodyOrientationRatio(lm, 100, 100)).toBeCloseTo(0.2 / 0.3, 5);
    expect(bodyOrientationRatio(lm, 200, 100)).toBeCloseTo(0.4 / 0.3, 5);
  });

  it('is null when a torso joint is unclear or missing, or the torso has no length', () => {
    for (const i of [11, 12, 23, 24]) {
      const lm = frontOn();
      lm[i] = [lm[i]![0], lm[i]![1], 0.49];
      expect(bodyOrientationRatio(lm, W, H)).toBeNull();
    }
    expect(bodyOrientationRatio(undefined, W, H)).toBeNull();
    expect(bodyOrientationRatio(frontOn().slice(0, 20), W, H)).toBeNull();
    expect(bodyOrientationRatio(frontOn(), 0, H)).toBeNull();
    const flat = frontOn();
    flat[23] = [0.4, 0.3, 0.95];
    flat[24] = [0.6, 0.3, 0.95];
    expect(bodyOrientationRatio(flat, W, H)).toBeNull();
    const nan = frontOn();
    nan[11] = [Number.NaN, 0.3, 0.95];
    expect(bodyOrientationRatio(nan, W, H)).toBeNull();
  });
});

describe('StanceTracker', () => {
  const feed = (t: StanceTracker, lm: Landmark[] | undefined, n: number) => {
    let last: ReturnType<StanceTracker['update']> = null;
    for (let i = 0; i < n; i++) last = t.update(lm, W, H);
    return last;
  };

  it('raises front-on after 20 consecutive front-on readings, not before', () => {
    const t = new StanceTracker('bodyweight_squat');
    expect(feed(t, frontOn(), FRONT_ON_READINGS - 1)).toBeNull();
    expect(t.update(frontOn(), W, H)).toBe('front-on');
    expect(t.current()).toBe('front-on');
  });

  it('an interruption below the ratio restarts the count', () => {
    const t = new StanceTracker('bodyweight_squat');
    feed(t, frontOn(), FRONT_ON_READINGS - 1);
    feed(t, SIDE_ON, 1);
    expect(feed(t, frontOn(), FRONT_ON_READINGS - 1)).toBeNull();
    expect(t.update(frontOn(), W, H)).toBe('front-on');
  });

  it('clears after 10 consecutive readings below the ratio, and a front-on reading in between restarts that count', () => {
    const t = new StanceTracker('bodyweight_squat');
    feed(t, frontOn(), FRONT_ON_READINGS);
    expect(feed(t, SIDE_ON, CLEAR_READINGS - 1)).toBe('front-on');
    t.update(frontOn(), W, H);
    expect(feed(t, SIDE_ON, CLEAR_READINGS - 1)).toBe('front-on');
    expect(t.update(SIDE_ON, W, H)).toBeNull();
  });

  it('frames with no usable reading neither raise nor clear', () => {
    const t = new StanceTracker('bodyweight_squat');
    feed(t, frontOn(), FRONT_ON_READINGS - 1);
    feed(t, undefined, 50); // nobody in view
    feed(t, frontOn(0.2), 50); // torso unclear
    expect(t.update(frontOn(), W, H)).toBe('front-on');
    feed(t, undefined, 50);
    expect(feed(t, frontOn(0.2), 50)).toBe('front-on');
    expect(feed(t, SIDE_ON, CLEAR_READINGS)).toBeNull();
  });

  it('only watches exercises that are measured side-on', () => {
    for (const id of ['bodyweight_squat', 'push_up', 'bicep_curl', 'lunge']) {
      expect(feed(new StanceTracker(id), frontOn(), 40)).toBe('front-on');
    }
    expect(feed(new StanceTracker('not_an_exercise'), frontOn(), 40)).toBeNull();
    expect(feed(new StanceTracker('bench_press'), frontOn(), 40)).toBeNull();
  });

  it('reset forgets everything', () => {
    const t = new StanceTracker('bodyweight_squat');
    feed(t, frontOn(), FRONT_ON_READINGS);
    t.reset();
    expect(t.current()).toBeNull();
    expect(feed(t, frontOn(), FRONT_ON_READINGS - 1)).toBeNull();
  });
});
