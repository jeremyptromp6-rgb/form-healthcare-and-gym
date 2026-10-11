import { render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { MealArt, type MealKind } from './MealArt';

const TONES: ArtTone[] = ['light', 'dark'];
const KINDS: MealKind[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const CASES = KINDS.flatMap((kind) => [0, 1].map((variant) => ({ kind, variant })));

describe('MealArt', () => {
  describe.each(TONES)('in the %s tone', (tone) => {
    it.each(CASES)('$kind variant $variant stays within 60 elements at 120px', async ({ kind, variant }) => {
      await render(<MealArt kind={kind} variant={variant} size={120} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(10);
      expect(found.total).toBeLessThanOrEqual(60);
      expect(found.forbidden).toEqual([]);
    });

    it.each(CASES)('$kind variant $variant stays within 30 elements at 32px', async ({ kind, variant }) => {
      await render(<MealArt kind={kind} variant={variant} size={32} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(8);
      expect(found.total).toBeLessThanOrEqual(30);
      expect(found.forbidden).toEqual([]);
    });
  });

  it('drops the detail layers below 48px, and keeps them from 48px up', async () => {
    for (const { kind, variant } of CASES) {
      const small = await render(<MealArt kind={kind} variant={variant} size={47} />);
      const lite = countSvg().total;
      await small.unmount();
      const big = await render(<MealArt kind={kind} variant={variant} size={48} />);
      expect(countSvg().total).toBeGreaterThan(lite);
      await big.unmount();
    }
  });

  it('has two distinct dishes per slot, and the variant wraps modulo 2', async () => {
    for (const kind of KINDS) {
      const shape = async (variant: number) => {
        const { unmount } = await render(<MealArt kind={kind} variant={variant} size={80} />);
        const found = countSvg();
        const sig = JSON.stringify([found.total, found.byType]);
        await unmount();
        return sig;
      };
      const [v0, v1, v2, v3] = [await shape(0), await shape(1), await shape(2), await shape(3)];
      expect(v0).not.toEqual(v1);
      expect(v2).toEqual(v0);
      expect(v3).toEqual(v1);
    }
  });

  it('renders variant 0 when no variant is given, and copes with odd variants', async () => {
    const a = await render(<MealArt kind="lunch" size={80} />);
    const plain = countSvg();
    await a.unmount();
    const b = await render(<MealArt kind="lunch" size={80} variant={0} />);
    expect(countSvg()).toEqual(plain);
    await b.unmount();
    await render(<MealArt kind="lunch" size={80} variant={Number.NaN} />);
    expect(countSvg().total).toBe(plain.total);
  });

  it('is decorative and hidden from accessibility', async () => {
    await render(<MealArt kind="dinner" />);
    const root = screen.toJSON() as { props: Record<string, unknown> };
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props['aria-hidden']).toBe(true);
  });

  it('keeps the 4:3 host box', async () => {
    await render(<MealArt kind="snack" size={60} />);
    expect(JSON.stringify((screen.toJSON() as unknown as { props: { style: unknown } }).props.style)).toContain('"width":80');
  });
});
