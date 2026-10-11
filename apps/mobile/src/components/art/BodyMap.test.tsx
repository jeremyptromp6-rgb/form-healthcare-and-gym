import { render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { BodyMap, MUSCLE_LABEL, MUSCLES, MuscleThumb, type Muscle } from './BodyMap';

const TONES: ArtTone[] = ['light', 'dark'];
const ALL_HEAT = Object.fromEntries(MUSCLES.map((m, i) => [m, 0.15 + (i % 3) * 0.4])) as Record<Muscle, number>;

interface Json {
  type: string;
  props?: { font?: { fontSize?: number } };
  children?: (Json | string)[] | null;
}

/** The font size of each label the map draws, in viewBox units. */
function labelSizes(json: unknown): number[] {
  const out: number[] = [];
  const visit = (n: Json | string | null | undefined) => {
    if (!n || typeof n === 'string') return;
    if (n.type === 'RNSVGText' && n.props?.font?.fontSize != null) out.push(n.props.font.fontSize);
    n.children?.forEach(visit);
  };
  visit(json as Json);
  return out;
}

describe('BodyMap', () => {
  describe.each(TONES)('in the %s tone', (tone) => {
    it('stays within 200 elements with every muscle lit, and has no filters, masks or clips', async () => {
      await render(<BodyMap heat={ALL_HEAT} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(40);
      expect(found.total).toBeLessThanOrEqual(200);
      expect(found.forbidden).toEqual([]);
    });

    it('stays within 200 elements as primary and secondary, and with nothing lit', async () => {
      await render(<BodyMap primary={['chest', 'quads']} secondary={['core', 'calves']} tone={tone} />);
      expect(countSvg().total).toBeLessThanOrEqual(200);
      await screen.unmount();
      await render(<BodyMap tone={tone} />);
      expect(countSvg().total).toBeLessThanOrEqual(200);
    });

    it.each(MUSCLES)('the %s thumb stays within 40 elements, lit or not', async (muscle) => {
      const lit = await render(<MuscleThumb muscle={muscle} tone={tone} />);
      const a = countSvg();
      expect(a.total).toBeGreaterThan(4);
      expect(a.total).toBeLessThanOrEqual(40);
      expect(a.forbidden).toEqual([]);
      await lit.unmount();
      await render(<MuscleThumb muscle={muscle} tone={tone} active={false} />);
      expect(countSvg().total).toBeLessThanOrEqual(40);
    });
  });

  it('draws a thumb with one muscle group, not a whole figure', async () => {
    await render(<MuscleThumb muscle="chest" />);
    const thumb = countSvg().total;
    await screen.unmount();
    await render(<BodyMap primary={['chest']} />);
    expect(thumb).toBeLessThan(countSvg().total / 2);
  });

  it('keeps its labels and exports', async () => {
    expect(MUSCLES).toHaveLength(11);
    expect(MUSCLE_LABEL.hamstrings).toBe('Hamstrings');
    await render(<BodyMap primary={['chest', 'triceps']} secondary={['shoulders']} />);
    expect(screen.getByRole('image', { name: 'Muscles worked: chest, triceps; also shoulders' })).toBeTruthy();
    await screen.unmount();
    await render(<BodyMap heat={{ chest: 1, quads: 0.5 }} />);
    expect(screen.getByRole('image', { name: 'Muscles trained: Chest, Quads' })).toBeTruthy();
    await screen.unmount();
    await render(<BodyMap heat={{}} />);
    expect(screen.getByRole('image', { name: 'Muscles trained: none yet' })).toBeTruthy();
    await screen.unmount();
    await render(<BodyMap accessibilityLabel="Custom" />);
    expect(screen.getByRole('image', { name: 'Custom' })).toBeTruthy();
  });

  it('keeps the 220x205 box', async () => {
    await render(<BodyMap height={205} />);
    const root = screen.toJSON() as unknown as { props: { style: unknown } };
    expect(JSON.stringify(root.props.style)).toContain(`${220 / 205}`);
  });

  describe('labels', () => {
    it.each([170, 200, 210, 120])('come out at 12px or more at a height of %s', async (height) => {
      await render(<BodyMap primary={['chest']} height={height} />);
      const sizes = labelSizes(screen.toJSON());
      expect(sizes.length).toBe(2);
      for (const s of sizes) expect((s * height) / 205).toBeGreaterThanOrEqual(12);
    });

    it('are left out with showLabels off', async () => {
      await render(<BodyMap showLabels={false} />);
      expect(labelSizes(screen.toJSON())).toEqual([]);
    });
  });

  it('hides the thumbs from accessibility', async () => {
    await render(<MuscleThumb muscle="quads" />);
    const root = screen.toJSON() as { props: Record<string, unknown> };
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
