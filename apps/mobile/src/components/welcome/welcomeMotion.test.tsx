import { act, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { HomeView } from '@/components/home/HomeView';
import { LevelHero } from '@/components/progress/ProgressionViews';
import { PhonePreview } from './PhonePreview';
import { SAMPLE_HOME, SAMPLE_NOW, SAMPLE_PROGRESS } from './sampleData';
import { WelcomeView } from './WelcomeView';

// Motion on (jest otherwise runs with reduced motion): the gate is the only thing mocked, and it
// honours the `enabled` argument the way the real one does.
jest.mock('@/lib/useActiveLoop', () => ({
  useActiveLoop: (enabled?: boolean) => enabled !== false,
  useAppActive: () => true,
}));

const noop = () => {};
const home = <HomeView vm={SAMPLE_HOME} now={SAMPLE_NOW} onNavigate={noop} onAddWater={noop} onUndoWater={noop} />;

let loops: jest.SpyInstance;
let intervals: jest.SpyInstance;
beforeEach(() => {
  loops = jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }) as unknown as Animated.CompositeAnimation);
  intervals = jest.spyOn(globalThis, 'setInterval');
});
afterEach(() => {
  loops.mockRestore();
  intervals.mockRestore();
});

// @testing-library/react-native v14: render is async.
describe('motion budget', () => {
  it('a real Home screen runs a glow loop and a Pip bob loop, and one blink timer (its calorie count-up is a one-shot)', async () => {
    jest.useFakeTimers();
    intervals = jest.spyOn(globalThis, 'setInterval'); // the fake clock replaced the one spied on in beforeEach
    try {
      await render(home);
      expect(loops).toHaveBeenCalledTimes(2);
      expect(intervals).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000); // let the count-up finish inside act
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('the same Home inside a phone preview stands still', async () => {
    await render(<PhonePreview caption="Home">{home}</PhonePreview>);
    expect(loops).not.toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();
  });

  it('the Level hero inside a phone preview stands still', async () => {
    await render(
      <PhonePreview caption="Progress">
        <LevelHero progress={SAMPLE_PROGRESS} />
      </PhonePreview>,
    );
    expect(loops).not.toHaveBeenCalled();
  });

  it('the Welcome screen runs one hero glow and one Pip bob (at most 3 loops, 1 setState animation)', async () => {
    await render(<WelcomeView onGetStarted={noop} onSignIn={noop} />);
    expect(loops.mock.calls.length).toBeLessThanOrEqual(3);
    expect(loops).toHaveBeenCalledTimes(2);
    expect(intervals).toHaveBeenCalledTimes(1);
  });
});
