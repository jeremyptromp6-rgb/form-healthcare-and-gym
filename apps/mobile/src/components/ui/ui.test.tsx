import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, elevation, glow, scheme } from '@/theme/tokens';
import { Button, ChipGroup, ErrorState, ICON_BUBBLE, IconBubble, ListRow, Screen, Segmented, StateView, stateIcon } from './index';
import { InTabsContext, TAB_BAR, tabBarBottomPadding } from './tabBar';

// @testing-library/react-native v14: render and events are async.
describe('design system', () => {
  it('ErrorState offers a retry for network failures', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState error={new ApiError('network', 'network', 'x', null, true)} onRetry={onRetry} />);
    expect(screen.getByText('No internet connection')).toBeTruthy();
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

describe('the icon rule', () => {
  const glyph = (name: string) => String.fromCodePoint(Ionicons.glyphMap[name as keyof typeof Ionicons.glyphMap] as number);
  const hasIcon = (name: string) => screen.queryAllByText(glyph(name), { includeHiddenElements: true }).length > 0;

  it('stateIcon maps outline and filled both ways', () => {
    expect(stateIcon('home', false)).toBe('home-outline');
    expect(stateIcon('home-outline', true)).toBe('home');
    expect(stateIcon('home', true)).toBe('home');
    expect(stateIcon('home-outline', false)).toBe('home-outline');
  });

  it('stateIcon keeps the given name when a variant does not exist, so it never becomes a missing glyph', () => {
    expect(stateIcon('logo-github', false)).toBe('logo-github');
    expect(stateIcon('not-an-icon', true)).toBe('not-an-icon');
    expect(stateIcon('not-an-icon', false)).toBe('not-an-icon');
  });

  it('IconBubble is outline at rest and filled when solid or told to be, on the 32/40/48 scale', async () => {
    expect(ICON_BUBBLE).toEqual({ sm: 32, md: 40, lg: 48 });
    const { rerender } = await render(<IconBubble icon="flame" />);
    expect(hasIcon('flame-outline')).toBe(true);
    await rerender(<IconBubble icon="flame" solid />);
    expect(hasIcon('flame')).toBe(true);
    expect(hasIcon('flame-outline')).toBe(false);
    await rerender(<IconBubble icon="flame-outline" filled />);
    expect(hasIcon('flame')).toBe(true);
  });

  it('Segmented icons are outline, and filled on the selected segment', async () => {
    await render(
      <Segmented
        value="a"
        onChange={jest.fn()}
        options={[
          { value: 'a', label: 'One', icon: 'flame' },
          { value: 'b', label: 'Two', icon: 'heart' },
        ]}
      />,
    );
    expect(hasIcon('flame')).toBe(true);
    expect(hasIcon('heart-outline')).toBe(true);
    expect(hasIcon('heart')).toBe(false);
  });

  it('chips show an outline tick circle off and a filled one on, so selecting never changes their width', async () => {
    const { rerender } = await render(<ChipGroup options={[{ key: 'a', label: 'Nuts' }]} selected={[]} onToggle={jest.fn()} />);
    expect(hasIcon('checkmark-circle-outline')).toBe(true);
    await rerender(<ChipGroup options={[{ key: 'a', label: 'Nuts' }]} selected={['a']} onToggle={jest.fn()} />);
    expect(hasIcon('checkmark-circle')).toBe(true);
    expect(hasIcon('checkmark-circle-outline')).toBe(false);
  });
});

describe('button states', () => {
  // The visible surface is the pressable's first child; its style carries the variant's look.
  const look = (label: string) => {
    const surface = screen.getByRole('button', { name: label }).children[0] as unknown as { props: { style: StyleProp<ViewStyle> } };
    return StyleSheet.flatten(surface.props.style) as Record<string, unknown>;
  };

  it('a disabled button goes quiet without fading', async () => {
    await render(<Button label="Save" disabled />);
    const s = look('Save');
    expect(s.backgroundColor).toBe(colors.cardRaised);
    expect(s.shadowOpacity).toBeUndefined();
  });

  it('the primary button is lifted at rest', async () => {
    await render(<Button label="Save" />);
    const s = look('Save');
    expect(s.backgroundColor).toBe(colors.primary);
    // Dark mode adds the primary glow on top of the lift.
    expect(s.shadowOpacity).toBe(scheme === 'dark' ? glow(colors.primary).shadowOpacity : elevation.lifted.shadowOpacity);
  });

  it('every variant keeps a 1px border so pressing never shifts the layout', async () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      await render(<Button label={variant} variant={variant} />);
      expect(look(variant).borderWidth).toBe(1);
    }
  });

  // Deliberately replaced: the old wash used a negative margin cancelled by padding. The wash is now
  // the row's own rounded fill (only its colour changes when pressed), so no margin goes negative.
  it('a pressable ListRow has no negative margin and keeps a 44pt target', async () => {
    await render(<ListRow title="Units" accessibilityLabel="Units" onPress={jest.fn()} />);
    const row = StyleSheet.flatten(screen.getByRole('button', { name: 'Units' }).props.style) as Record<string, number | string>;
    for (const key of ['margin', 'marginHorizontal', 'marginVertical', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom']) {
      expect(row[key] === undefined || (row[key] as number) >= 0).toBe(true);
    }
    expect(row.minHeight as number).toBeGreaterThanOrEqual(44);
    expect(row.borderRadius).toBeGreaterThan(0);
    expect(row.backgroundColor).toBeUndefined();
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
