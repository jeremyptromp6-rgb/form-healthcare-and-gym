import { act, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { ExerciseArt, EXERCISE_ART_COLORS, ILLUSTRATED_EXERCISES, lerpPose, poseAt, type Pose } from './ExerciseArt';

// test/setup.ts mocks reduced motion on; this flag lets the animation tests turn it off.
let mockReduce = true;
jest.mock('@/lib/a11y', () => ({
  ...jest.requireActual('@/lib/a11y'),
  useReducedMotion: () => mockReduce,
}));

let setIntervalSpy: jest.SpyInstance;
let clearIntervalSpy: jest.SpyInstance;
const snapshot = () => JSON.stringify(screen.toJSON());

/** Frame-loop intervals (the only setInterval the art creates) started and stopped so far. */
function frameLoops() {
  return {
    started: setIntervalSpy.mock.calls.filter(([, ms]) => typeof ms === 'number' && ms < 100).length,
    stopped: clearIntervalSpy.mock.calls.length,
  };
}

describe('lerpPose / poseAt', () => {
  const a: Pose = { head: [0, 0], neck: [0, 10], hip: [0, 20], knee: [0, 30], foot: [0, 40], elbow: [0, 50], hand: [10, 60], knee2: [0, 0], foot2: [10, 10] };
  const b: Pose = { head: [10, 20], neck: [10, 30], hip: [10, 40], knee: [10, 50], foot: [10, 60], elbow: [10, 70], hand: [30, 80], knee2: [20, 40], foot2: [30, 50] };

  it('interpolates every joint, including the optional second leg', () => {
    const m = lerpPose(a, b, 0.5);
    expect(m.head).toEqual([5, 10]);
    expect(m.hand).toEqual([20, 70]);
    expect(m.knee2).toEqual([10, 20]);
    expect(m.foot2).toEqual([20, 30]);
    expect(lerpPose(a, b, 0)).toEqual(a);
    expect(lerpPose(a, b, 1)).toEqual(b);
  });

  it('skips optional joints that only one pose has', () => {
    const { knee2: _k, foot2: _f, ...plain } = b;
    expect(lerpPose(a, plain, 0.5).knee2).toBeUndefined();
  });

  it('hits the start and end poses at the endpoints and the halfway pose in the middle', () => {
    const start = poseAt('lunge', 0)!;
    const end = poseAt('lunge', 1)!;
    const mid = poseAt('lunge', 0.5)!;
    expect(start.hip).toEqual([99, 76]);
    expect(start.knee2).toEqual([99, 102]);
    expect(end.hip).toEqual([100, 102]);
    expect(end.knee2).toEqual([84, 125]);
    expect(end.foot2).toEqual([62, 121]);
    expect(mid.hip[0]).toBeCloseTo(99.5);
    expect(mid.hip[1]).toBeCloseTo(89);
    expect(mid.knee2![0]).toBeCloseTo(91.5);
    expect(mid.knee2![1]).toBeCloseTo(113.5);
  });

  it('has a pose for every illustrated exercise and none for an unknown id', () => {
    for (const id of ILLUSTRATED_EXERCISES) expect(poseAt(id, 0.5)).not.toBeNull();
    expect(poseAt('unknown', 0.5)).toBeNull();
  });

  it('exposes the work and ghost colours', () => {
    expect(EXERCISE_ART_COLORS.work).toMatch(/^#[0-9A-F]{6}$/i);
    expect(EXERCISE_ART_COLORS.ghost).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('ExerciseArt rendering', () => {
  beforeEach(() => {
    mockReduce = true;
    jest.useFakeTimers();
    setIntervalSpy = jest.spyOn(globalThis, 'setInterval');
    clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('renders the same structure with animated off as with the prop omitted', async () => {
    const { unmount } = await render(<ExerciseArt exerciseId="lunge" name="Lunge" />);
    const omitted = snapshot();
    await unmount();
    await render(<ExerciseArt exerciseId="lunge" name="Lunge" animated={false} />);
    expect(snapshot()).toBe(omitted);
    expect(screen.getByLabelText('Lunge illustration')).toBeTruthy();
  });

  it('stays static, with no timers, under reduced motion', async () => {
    const { unmount } = await render(<ExerciseArt exerciseId="squat" name="Squat" />);
    const still = snapshot();
    await unmount();
    await render(<ExerciseArt exerciseId="squat" name="Squat" animated />);
    expect(frameLoops().started).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(snapshot()).toBe(still);
  });

  it('moves the figure when motion is allowed, and stops its timer on unmount', async () => {
    mockReduce = false;
    const { unmount } = await render(<ExerciseArt exerciseId="lunge" name="Lunge" animated loopMs={2400} />);
    expect(frameLoops()).toEqual({ started: 1, stopped: 0 });
    const first = snapshot();
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    const later = snapshot();
    expect(later).not.toBe(first);
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(snapshot()).not.toBe(later);
    await unmount();
    expect(frameLoops()).toEqual({ started: 1, stopped: 1 });
  });
  it('pauses the frame loop while the app is backgrounded and resumes when it is active again', async () => {
    mockReduce = false;
    let emit: (s: AppStateStatus) => void = () => {};
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      emit = fn as (s: AppStateStatus) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    const { unmount } = await render(<ExerciseArt exerciseId="lunge" name="Lunge" animated loopMs={2400} />);
    expect(frameLoops()).toEqual({ started: 1, stopped: 0 });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    const running = snapshot();

    await act(async () => {
      emit('background');
    });
    expect(frameLoops()).toEqual({ started: 1, stopped: 1 });
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(snapshot()).toBe(running); // no frames while backgrounded

    await act(async () => {
      emit('active');
    });
    expect(frameLoops()).toEqual({ started: 2, stopped: 1 });
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(snapshot()).not.toBe(running);

    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(frameLoops()).toEqual({ started: 2, stopped: 2 });
  });

  it('does not start the loop when the app is already in the background', async () => {
    mockReduce = false;
    // jest's AppState mock has no real currentState, so define one for this test and restore it after.
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true, writable: true });
    try {
      await render(<ExerciseArt exerciseId="lunge" name="Lunge" animated />);
      expect(frameLoops().started).toBe(0);
    } finally {
      Object.defineProperty(AppState, 'currentState', original);
    }
  });

  it('keeps the illustration accessible while animating', async () => {
    mockReduce = false;
    await render(<ExerciseArt exerciseId="bicep_curl" name="Curl" animated />);
    expect(screen.getByLabelText('Curl illustration')).toBeTruthy();
  });
});
