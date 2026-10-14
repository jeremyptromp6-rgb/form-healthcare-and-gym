import { FOOD_CATEGORIES } from '@form/domain';
import { render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { FoodArt } from './FoodArt';

const TONES: ArtTone[] = ['light', 'dark'];

describe('FoodArt', () => {
  describe.each(TONES)('in the %s tone', (tone) => {
    it.each(FOOD_CATEGORIES)('%s is a real sketch within 24 elements', async (category) => {
      await render(<FoodArt category={category} size={64} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThanOrEqual(3);
      expect(found.total).toBeLessThanOrEqual(24);
      expect(found.forbidden).toEqual([]);
    });
  });

  it('draws a different sketch for every category', async () => {
    const seen = new Set<string>();
    for (const category of FOOD_CATEGORIES) {
      const { unmount } = await render(<FoodArt category={category} />);
      const found = countSvg();
      seen.add(JSON.stringify([found.total, found.byType]));
      await unmount();
    }
    expect(seen.size).toBeGreaterThanOrEqual(FOOD_CATEGORIES.length - 3);
  });

  it('is decorative and hidden from accessibility', async () => {
    await render(<FoodArt category="fruit" />);
    const root = screen.toJSON() as { props: Record<string, unknown> };
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props['aria-hidden']).toBe(true);
  });

  it('falls back to the plate for an unknown category and keeps a square box', async () => {
    await render(<FoodArt category={'mystery' as never} size={50} />);
    expect(countSvg().total).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify((screen.toJSON() as unknown as { props: { style: unknown } }).props.style)).toContain('"width":50');
  });
});
