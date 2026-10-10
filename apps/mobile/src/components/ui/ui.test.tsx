import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Button, ErrorState, Screen, Segmented, StateView } from './index';
import { InTabsContext, TAB_BAR, tabBarBottomPadding } from './tabBar';

// @testing-library/react-native v14: render and events are async.
describe('design system', () => {
  it('ErrorState offers a retry for network failures', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState error={new ApiError('network', 'network', 'x', null, true)} onRetry={onRetry} />);
    expect(screen.getByText("Can't reach FORM")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState shows an honest unavailable state without a pointless retry', async () => {
    await render(<ErrorState error={new ApiError('unavailable', 'provider_unconfigured', 'AI coach is not configured', 503, false)} onRetry={jest.fn()} />);
    expect(screen.getByText('Temporarily unavailable')).toBeTruthy();
    expect(screen.getByText('AI coach is not configured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('StateView loading is announced to screen readers', async () => {
    await render(<StateView kind="loading" />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('Button does not fire while disabled, and exposes its state', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({ disabled: true });

    await render(<Button label="Save" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Segmented is an accessible radio group', async () => {
    const onChange = jest.fn();
    await render(
      <Segmented
        label="Goal"
        value="maintain"
        onChange={onChange}
        options={[
          { value: 'lose', label: 'Lose fat' },
          { value: 'maintain', label: 'Maintain' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Maintain' }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole('radio', { name: 'Lose fat' }));
    expect(onChange).toHaveBeenCalledWith('lose');
  });
});

describe('screen layout and the tab bar', () => {
  // A Screen's scroll content: the element carrying the bottom padding.
  const bottomPadding = () => {
    const flat = (s: unknown): Record<string, unknown> => (Array.isArray(s) ? Object.assign({}, ...s.map(flat)) : ((s as Record<string, unknown>) ?? {}));
    type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
    const find = (n: Node | Node[] | string | null): Node | null => {
      if (!n || typeof n === 'string') return null;
      if (Array.isArray(n)) return n.map(find).find(Boolean) ?? null;
      if (n.type === 'RCTScrollView') return { ...n, props: { style: n.props.contentContainerStyle } };
      return (n.children ?? []).map((c) => find(c)).find(Boolean) ?? null;
    };
    return flat(find(screen.toJSON() as Node | Node[])!.props.style).paddingBottom as number;
  };
  const insets = { top: 24, bottom: 34, left: 0, right: 0 };

  it('inside the tabs, content ends above the docked tab bar with breathing room (no system inset added twice)', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <InTabsContext.Provider value>
          <Screen title="Eat">
            <StateView kind="loading" />
          </Screen>
        </InTabsContext.Provider>
      </SafeAreaInsetsContext.Provider>,
    );
    expect(bottomPadding()).toBe(48);
  });

  it('outside the tabs, content also clears the system navigation bar', async () => {
    await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <Screen title="Settings">
          <StateView kind="loading" />
        </Screen>
      </SafeAreaInsetsContext.Provider>,
    );
    expect(bottomPadding()).toBe(48 + 34);
  });

  it('the docked bar always keeps its labels clear of the system bar', () => {
    expect(tabBarBottomPadding(0)).toBe(TAB_BAR.minBottomPadding);
    expect(tabBarBottomPadding(48)).toBe(48);
  });
});
