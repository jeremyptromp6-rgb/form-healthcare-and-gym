import { render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { CHEST_TIERS, ChestArt, FlameArt } from './StreakArt';

const TONES: ArtTone[] = ['light', 'dark'];

describe('StreakArt', () => {
  describe.each(TONES)('in the %s tone', (tone) => {
    it.each([true, false])('the flame (lit: %s) stays within 30 elements, with no filters, masks or clips', async (lit) => {
      await render(<FlameArt lit={lit} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(0);
      expect(found.total).toBeLessThanOrEqual(30);
      expect(found.forbidden).toEqual([]);
    });

    it.each(CHEST_TIERS.flatMap((_, tier) => [true, false].map((open) => [tier, open] as const)))('chest %i (open: %s) stays within 30 elements, with no filters, masks or clips', async (tier, open) => {
      await render(<ChestArt tier={tier} open={open} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(0);
      expect(found.total).toBeLessThanOrEqual(30);
      expect(found.forbidden).toEqual([]);
    });
  });

  it('an open chest draws more than a locked one (glow and lid)', async () => {
    await render(<ChestArt tier={2} open={false} />);
    const closed = countSvg().total;
    screen.unmount();
    await render(<ChestArt tier={2} open />);
    expect(countSvg().total).toBeGreaterThan(closed);
  });

  it('is hidden from the accessibility tree (the card around it carries the label)', async () => {
    await render(<FlameArt />);
    expect(screen.queryByRole('image')).toBeNull();
  });
});
