import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Animated, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { STATE_ART_KINDS, type StateArtKind } from '@/components/art/StateArt';
import { StaticArtContext } from './staticArt';
import { CountUp, ErrorState, ProgressRing, StateView, stateArtFor, type StateKind } from './index';

// Records the art kind each StateView asks for (the real art is an SVG with no readable kind), then draws the real art.
const mockArtKinds: string[] = [];
jest.mock('@/components/art/StateArt', () => {
  const actual = jest.requireActual('@/components/art/StateArt');
  const { createElement } = jest.requireActual('react');
  return {
    ...actual,
    StateArt: (p: { kind: string; size: number }) => {
      mockArtKinds.push(`${p.kind}@${p.size}`);
      return createElement(actual.StateArt, p);
    },
  };
});

// Mutable so one test can switch the loop on; jest-mock factories may only touch `mock`-prefixed names.
let mockLoopActive = false;
jest.mock('@/lib/useActiveLoop', () => ({
  useActiveLoop: (enabled?: boolean) => mockLoopActive && enabled !== false,
  useAppActive: () => true,
}));

interface Json {
  type: string;
  props: Record<string, unknown>;
  children: (Json | string)[] | null;
}

/** Every host node of the rendered tree matching `pred`. */
function findAll(pred: (props: Record<string, unknown>) => boolean): Json[] {
  const out: Json[] = [];
  const walk = (n: Json | string | (Json | string)[] | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (pred(n.props)) out.push(n);
    n.children?.forEach(walk);
  };
  walk(screen.toJSON() as never);
  return out;
}
const isHiddenArt = (p: Record<string, unknown>) => p.importantForAccessibility === 'no-hide-descendants' && p['aria-hidden'] === true;

// @testing-library/react-native v14: render and events are async.
beforeEach(() => {
  mockLoopActive = false;
  mockArtKinds.length = 0;
});

describe('StateView', () => {
  it('loading is a progressbar named Loading, also under reduced motion', async () => {
    await render(<StateView kind="loading" />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(findAll((p) => p.accessibilityRole === 'progressbar' && p.accessibilityLabel === 'Loading')).toHaveLength(1);
  });

  it('loading with the loop running still renders (and unmounts cleanly)', async () => {
    mockLoopActive = true;
    const { unmount } = await render(<StateView kind="loading" compact />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    await unmount();
  });

  it('shares one pulse loop between any number of skeletons, and stops it with the last one', async () => {
    mockLoopActive = true;
    const stop = jest.fn();
    const loop = jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: jest.fn(), stop, reset: jest.fn() }) as unknown as Animated.CompositeAnimation);
    try {
      const a = await render(
        <View>
          <StateView kind="loading" compact />
          <StateView kind="loading" compact />
          <StateView kind="loading" compact />
        </View>,
      );
      expect(loop).toHaveBeenCalledTimes(1);
      const b = await render(<StateView kind="loading" compact />);
      expect(loop).toHaveBeenCalledTimes(1);
      await a.unmount();
      expect(stop).not.toHaveBeenCalled();
      await b.unmount();
      expect(stop).toHaveBeenCalledTimes(1);
      // A later skeleton starts a fresh loop.
      const c = await render(<StateView kind="loading" compact />);
      expect(loop).toHaveBeenCalledTimes(2);
      await c.unmount();
    } finally {
      loop.mockRestore();
    }
  });

  it('the full-size loading state keeps Pip still: no bob loop, no blink timer', async () => {
    mockLoopActive = true;
    const loop = jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }) as unknown as Animated.CompositeAnimation);
    const interval = jest.spyOn(globalThis, 'setInterval');
    try {
      const { unmount } = await render(<StateView kind="loading" />);
      expect(loop).toHaveBeenCalledTimes(1); // the shared skeleton pulse, nothing from Pip
      expect(interval).not.toHaveBeenCalled();
      await unmount();
    } finally {
      loop.mockRestore();
      interval.mockRestore();
    }
  });

  it('starts no loop at all when motion is off', async () => {
    const loop = jest.spyOn(Animated, 'loop');
    try {
      await render(<StateView kind="loading" compact />);
      expect(loop).not.toHaveBeenCalled();
    } finally {
      loop.mockRestore();
    }
  });

  it('error is a polite live region', async () => {
    await render(<StateView kind="error" title="Something went wrong" />);
    expect(findAll((p) => p.accessibilityLiveRegion === 'polite')).toHaveLength(1);
  });

  it('renders title, message and an action that fires', async () => {
    const onAction = jest.fn();
    await render(<StateView kind="empty" title="No workouts yet" message="Your finished workouts appear here." actionLabel="Go to Train" onAction={onAction} />);
    expect(screen.getByText('No workouts yet')).toBeTruthy();
    expect(screen.getByText('Your finished workouts appear here.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Go to Train' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('keeps the decorative art hidden from screen readers', async () => {
    await render(<StateView kind="empty" title="Nothing to buy yet" />);
    expect(findAll((p) => isHiddenArt(p) && p.accessible === false).length).toBeGreaterThan(0);
  });

  it('sizes the art 64 when compact and 88 otherwise', async () => {
    await render(<StateView kind="empty" title="Plain" compact />);
    await render(<StateView kind="empty" title="Plain" />);
    expect(mockArtKinds).toEqual(['generic@64', 'generic@88']);
  });

  describe('stateArtFor', () => {
    const cases: [StateKind, string | undefined, StateArtKind][] = [
      ['empty', 'No workouts yet', 'noWorkouts'],
      ['empty', 'No records yet', 'noRecords'],
      ['empty', 'Nothing to buy yet', 'groceryEmpty'],
      ['empty', 'Workout not found', 'notFound'],
      ['empty', 'Recipe not found', 'notFound'],
      ['empty', 'Exercise not found', 'notFound'],
      ['empty', 'Entry not found', 'notFound'],
      ['error', "Can't reach FORM", 'offline'],
      ['error', "Couldn't reach FORM's server", 'offline'],
      ['permission', 'Use your camera to scan', 'cameraPermission'],
      ['unavailable', "Food scanning isn't available yet", 'unavailable'],
      ['error', 'Something went wrong', 'serverError'],
      ['error', "Couldn't load Meals", 'serverError'],
      ['empty', 'No close swaps', 'generic'],
      ['empty', 'Paused', 'generic'],
      ['empty', undefined, 'generic'],
    ];
    it.each(cases)('%s "%s" gives %s', (kind, title, expected) => {
      expect(stateArtFor(kind, title)).toBe(expected);
    });

    it('lets an explicit art win', () => {
      expect(stateArtFor('empty', 'No workouts yet', 'offline')).toBe('offline');
    });

    it('only ever returns a kind StateArt can draw', () => {
      for (const [kind, title] of cases) expect(STATE_ART_KINDS).toContain(stateArtFor(kind, title));
    });
  });
});

describe('ErrorState art', () => {
  it('uses the offline art for a network failure', async () => {
    await render(<ErrorState error={new ApiError('network', 'network', 'x', null, true)} />);
    expect(screen.getByText("Can't reach FORM")).toBeTruthy();
    expect(mockArtKinds).toEqual(['offline@88']);
  });

  it.each(['server', 'rate_limited', 'forbidden'] as const)('uses serverError art for %s failures, whatever the title says', async (kind) => {
    await render(<ErrorState error={new ApiError(kind, 'c', 'm', null, false)} compact />);
    expect(mockArtKinds).toEqual(['serverError@64']);
  });

  // Changed deliberately (fix list item 2): an unavailable service gets the hourglass, not the wrench.
  it('uses the unavailable (hourglass) art for an unavailable service', async () => {
    await render(<ErrorState error={new ApiError('unavailable', 'c', 'm', null, false)} compact />);
    expect(mockArtKinds).toEqual(['unavailable@64']);
  });
});

describe('CountUp', () => {
  it('shows the final value at once under reduced motion', async () => {
    await render(<CountUp value={1250} format={(n) => `${Math.round(n)} kcal`} />);
    expect(screen.getByText('1250 kcal')).toBeTruthy();
  });

  it('exposes the final formatted value as its accessible text', async () => {
    await render(<CountUp value={42} />);
    expect(screen.getByLabelText('42')).toBeTruthy();
  });

  it('counts up while the loop is active but is announced as the final value', async () => {
    mockLoopActive = true;
    jest.useFakeTimers();
    try {
      await render(<CountUp value={100} duration={600} />);
      expect(screen.getByLabelText('100')).toBeTruthy();
      expect(screen.getByLabelText('100').props.children).toBe('0');
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByLabelText('100').props.children).toBe('100');
    } finally {
      jest.useRealTimers();
      mockLoopActive = false;
    }
  });
});

describe('CountUp after a pause', () => {
  it('shows the new value, not the old one, when the loop comes back after the value changed', async () => {
    jest.useFakeTimers();
    try {
      mockLoopActive = true;
      const { rerender } = await render(<CountUp value={50} duration={600} />);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByLabelText('50').props.children).toBe('50');
      // The loop pauses (reduced motion, or the app in the background) and the figure changes meanwhile.
      mockLoopActive = false;
      await rerender(<CountUp value={80} duration={600} />);
      expect(screen.getByLabelText('80').props.children).toBe('80');
      // It comes back with the value unchanged since: it must show 80, not the stale 50.
      mockLoopActive = true;
      await rerender(<CountUp value={80} duration={600} />);
      expect(screen.getByLabelText('80').props.children).toBe('80');
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByLabelText('80').props.children).toBe('80');
    } finally {
      jest.useRealTimers();
      mockLoopActive = false;
    }
  });

  it('stands still inside a picture of a screen (StaticArtContext), even with motion on', async () => {
    mockLoopActive = true;
    await render(
      <StaticArtContext.Provider value>
        <CountUp value={100} />
      </StaticArtContext.Provider>,
    );
    expect(screen.getByLabelText('100').props.children).toBe('100');
  });
});

describe('ProgressRing', () => {
  it('shows its final value under reduced motion', async () => {
    await render(<ProgressRing value={0.4} label="Protein" />);
    expect(screen.getByLabelText('Protein').props.accessibilityValue).toMatchObject({ now: 40 });
  });

  it('clamps out-of-range values', async () => {
    await render(<ProgressRing value={3} label="Water" />);
    expect(screen.getByLabelText('Water').props.accessibilityValue).toMatchObject({ now: 100 });
  });
});
