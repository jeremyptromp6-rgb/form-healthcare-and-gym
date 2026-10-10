import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { colors } from '@/theme/tokens';
import { FuelSummary, IconBubble, InlineMessage, MacroTile, SectionAction, StatStrip, WaterLine } from './index';

// @testing-library/react-native v14: render and events are async.
describe('IconBubble', () => {
  // The bubble is the root host view, so its props come straight from the rendered tree.
  const bubble = () => screen.toJSON() as { props: Record<string, unknown> };

  it('is decorative: hidden from screen readers, with a neutral fill by default', async () => {
    await render(<IconBubble icon="flame" />);
    const props = bubble().props;
    expect(props.importantForAccessibility).toBe('no-hide-descendants');
    expect(props.accessibilityElementsHidden).toBe(true);
    const style = StyleSheet.flatten(props.style as ViewStyle);
    expect(style.backgroundColor).toBe(colors.cardRaised);
    expect(style.width).toBe(40);
  });

  it('tints a token colour, or fills solid with it', async () => {
    const { rerender } = await render(<IconBubble icon="flame" tint={colors.accent} size={50} />);
    expect(StyleSheet.flatten(bubble().props.style as ViewStyle).backgroundColor).toBe(`${colors.accent}1F`);
    expect(StyleSheet.flatten(bubble().props.style as ViewStyle).width).toBe(50);
    await rerender(<IconBubble icon="flame" tint={colors.accent} solid />);
    expect(StyleSheet.flatten(bubble().props.style as ViewStyle).backgroundColor).toBe(colors.accent);
  });
});

describe('StatStrip', () => {
  const items = [
    { label: 'Time', value: '42', unit: 'min' },
    { label: 'Sets', value: '12' },
  ];

  it('flat keeps the labels and drops the border and background', async () => {
    await render(<StatStrip variant="flat" items={items} />);
    expect(screen.getByLabelText('Time: 42 min')).toBeTruthy();
    expect(screen.getByLabelText('Sets: 12')).toBeTruthy();
    const strip = screen.getByLabelText('Time: 42 min').parent!;
    const style = StyleSheet.flatten(strip.props.style);
    expect(style.borderWidth).toBeUndefined();
    expect(style.backgroundColor).toBeUndefined();
    const second = StyleSheet.flatten(screen.getByLabelText('Sets: 12').props.style);
    expect(second.borderLeftColor).toBe(colors.hairline);
    const first = StyleSheet.flatten(screen.getByLabelText('Time: 42 min').props.style);
    expect(first.paddingLeft).toBe(0);
  });

  it('boxed (default) keeps its border', async () => {
    await render(<StatStrip items={items} />);
    const style = StyleSheet.flatten(screen.getByLabelText('Time: 42 min').parent!.props.style);
    expect(style.borderWidth).toBe(1);
  });
});

describe('MacroTile', () => {
  // The bar sits inside the tile's single accessible element, so look for it in the tree.
  const bars = () => JSON.stringify(screen.toJSON()).match(/"accessibilityRole":"progressbar"/g) ?? [];

  it('shows grams over the target with a bar', async () => {
    await render(<MacroTile label="Protein" value={131.6} target={180} color={colors.protein} />);
    expect(screen.getByLabelText('Protein: 132 of 180 grams')).toBeTruthy();
    expect(screen.getByText('/ 180 g')).toBeTruthy();
    expect(bars()).toHaveLength(1);
  });

  it('with no target shows just the grams and no bar', async () => {
    await render(<MacroTile label="Fat" value={20.2} target={null} color={colors.fat} />);
    expect(screen.getByLabelText('Fat: 20 grams')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.getByText('g')).toBeTruthy();
    expect(bars()).toHaveLength(0);
  });
});

describe('SectionAction', () => {
  it('is a button by default, named by its label, with a generous touch target', async () => {
    const onPress = jest.fn();
    await render(<SectionAction label="See all" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'See all' });
    expect(btn.props.hitSlop.top).toBeGreaterThanOrEqual(8);
    expect(btn.props.hitSlop.left).toBeGreaterThanOrEqual(12);
    await fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('can be a link with its own accessible name', async () => {
    await render(<SectionAction label="Edit" role="link" accessibilityLabel="Edit meal plan" tone="muted" onPress={jest.fn()} />);
    expect(screen.getByRole('link', { name: 'Edit meal plan' })).toBeTruthy();
  });

  it('reports a disabled state and does not fire', async () => {
    const onPress = jest.fn();
    await render(<SectionAction label="Undo" disabled onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Undo' });
    expect(btn.props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('FuelSummary', () => {
  it('shows the numeral, unit, caption, macros and the caller notes', async () => {
    const { Text } = jest.requireActual('react-native');
    await render(
      <FuelSummary
        title="Today's fuel"
        numeral="1,420"
        unitLabel="/ 2,200 kcal"
        caption="780 left"
        ring={{ value: 0.65, color: colors.accent, label: 'Calories eaten of target' }}
        macros={[
          { label: 'Protein', value: 80, target: 150, color: colors.protein },
          { label: 'Carbs', value: 120, target: null, color: colors.carbs },
        ]}>
        <Text>Extra note</Text>
      </FuelSummary>,
    );
    expect(screen.getByRole('header', { name: "Today's fuel" })).toBeTruthy();
    expect(screen.getByText('1,420')).toBeTruthy();
    expect(screen.getByText('/ 2,200 kcal')).toBeTruthy();
    expect(screen.getByText('780 left')).toBeTruthy();
    expect(screen.getByLabelText('Calories eaten of target')).toBeTruthy();
    expect(screen.getByLabelText('Protein: 80 of 150 grams')).toBeTruthy();
    expect(screen.getByLabelText('Carbs: 120 grams')).toBeTruthy();
    expect(screen.getByText('Extra note')).toBeTruthy();
  });

  it('has no header without a title, and omits the optional parts', async () => {
    await render(<FuelSummary numeral="0" />);
    expect(screen.queryByRole('header')).toBeNull();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('WaterLine', () => {
  it('is one accessible element with a bar', async () => {
    await render(<WaterLine totalText="0.8 L" targetText="2.4 L" fraction={0.33} accessibilityLabel="Water: 0.8 L of 2.4 L" hint="A general guide." />);
    expect(screen.getByLabelText('Water: 0.8 L of 2.4 L')).toBeTruthy();
    expect(screen.getByText('0.8 L')).toBeTruthy();
    expect(screen.getByText('/ 2.4 L')).toBeTruthy();
    expect(screen.getByText('A general guide.')).toBeTruthy();
    expect(screen.getByLabelText('Water of daily guide')).toBeTruthy();
  });
});

describe('InlineMessage flat', () => {
  it('renders its text without a panel', async () => {
    await render(<InlineMessage tone="info" flat>Add your body details</InlineMessage>);
    expect(screen.getByText('Add your body details')).toBeTruthy();
    const style = StyleSheet.flatten(screen.getByText('Add your body details').parent!.parent!.props.style);
    expect(style.backgroundColor).toBeUndefined();
    expect(style.padding).toBeUndefined();
  });

  it('keeps the panel by default', async () => {
    await render(<InlineMessage tone="warning">Careful</InlineMessage>);
    const style = StyleSheet.flatten(screen.getByText('Careful').parent!.parent!.props.style);
    expect(style.backgroundColor).toBe(colors.warningSoft);
  });
});
