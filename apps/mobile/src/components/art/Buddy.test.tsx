import { act, render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { Buddy, BUDDY_MOODS } from './Buddy';

// Jest runs with reduced motion on (test/setup.ts), so useActiveLoop is false by default. The
// blink tests flip it on through this mock.
let mockActive = false;
jest.mock('@/lib/useActiveLoop', () => ({ useActiveLoop: (enabled?: boolean) => mockActive && enabled !== false }));

const TONES: ArtTone[] = ['light', 'dark'];

beforeEach(() => {
  mockActive = false;
});

describe('Buddy', () => {
  it('has the nine moods, the four original ones first', () => {
    expect(BUDDY_MOODS).toHaveLength(9);
    expect(BUDDY_MOODS.slice(0, 4)).toEqual(['happy', 'cheer', 'sleepy', 'proud']);
  });

  describe.each(TONES)('in the %s tone', (tone) => {
    it.each(BUDDY_MOODS)('%s renders within the 60 element budget and without filters, masks or clips', async (mood) => {
      await render(<Buddy mood={mood} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(20);
      expect(found.total).toBeLessThanOrEqual(60);
      expect(found.forbidden).toEqual([]);
    });
  });

  it('renders with no tone (the launch scheme) and with the default mood', async () => {
    await render(<Buddy />);
    expect(countSvg().total).toBeLessThanOrEqual(60);
  });

  it('is hidden from accessibility', async () => {
    await render(<Buddy mood="celebrate" />);
    const root = screen.toJSON() as { props: Record<string, unknown> };
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props['aria-hidden']).toBe(true);
  });

  it('is fully static under reduced motion: no timers are scheduled even with float on', async () => {
    const every = jest.spyOn(globalThis, 'setInterval');
    const after = jest.spyOn(globalThis, 'setTimeout');
    await render(<Buddy float />);
    expect(every).not.toHaveBeenCalled();
    expect(after.mock.calls.filter(([, ms]) => ms === 120 || ms === 4000)).toEqual([]);
    every.mockRestore();
    after.mockRestore();
  });

  describe('with motion on', () => {
    beforeEach(() => {
      mockActive = true;
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('blinks about every 4 s, shut for 120 ms, then clears its timer on unmount', async () => {
      const every = jest.spyOn(globalThis, 'setInterval');
      const clear = jest.spyOn(globalThis, 'clearInterval');
      const { unmount } = await render(<Buddy mood="happy" />);
      const open = countSvg().total;
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(countSvg().total).toBeLessThan(open);
      await act(async () => {
        jest.advanceTimersByTime(119);
      });
      expect(countSvg().total).toBeLessThan(open);
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(countSvg().total).toBe(open);
      await unmount();
      expect(every).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledWith(every.mock.results[0]!.value);
      every.mockRestore();
      clear.mockRestore();
    });

    it.each(['sleepy', 'rest'] as const)('schedules no blink timer for the closed-eyed %s mood', async (mood) => {
      const every = jest.spyOn(globalThis, 'setInterval');
      await render(<Buddy mood={mood} />);
      const shut = countSvg().total;
      await act(async () => {
        jest.advanceTimersByTime(8000);
      });
      expect(every).not.toHaveBeenCalled();
      expect(countSvg().total).toBe(shut);
      every.mockRestore();
    });

    it('never leaves the eyes shut when the loop stops mid-blink and starts again', async () => {
      const { rerender } = await render(<Buddy mood="happy" float />);
      const open = countSvg().total;
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(countSvg().total).toBeLessThan(open);
      await act(async () => {
        jest.advanceTimersByTime(50);
      });
      await rerender(<Buddy mood="happy" float={false} />);
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await rerender(<Buddy mood="happy" float />);
      expect(countSvg().total).toBe(open);
      await act(async () => {
        jest.advanceTimersByTime(3999);
      });
      expect(countSvg().total).toBe(open);
    });

    it('does not blink when float is off', async () => {
      await render(<Buddy float={false} />);
      const open = countSvg().total;
      await act(async () => {
        jest.advanceTimersByTime(8000);
      });
      expect(countSvg().total).toBe(open);
    });
  });
});
