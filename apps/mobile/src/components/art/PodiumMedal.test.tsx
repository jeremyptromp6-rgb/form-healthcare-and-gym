import { render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { PodiumMedal, type Podium } from './PodiumMedal';

const TONES: ArtTone[] = ['light', 'dark'];
const PLACES: Podium[] = [1, 2, 3];

describe('PodiumMedal', () => {
  it.each(TONES)('stays within 20 elements for every place in the %s tone', async (tone) => {
    for (const place of PLACES) {
      const { unmount } = await render(<PodiumMedal place={place} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(5);
      expect(found.total).toBeLessThanOrEqual(20);
      expect(found.forbidden).toEqual([]);
      await unmount();
    }
  });

  it('is announced by its place', async () => {
    await render(<PodiumMedal place={2} />);
    expect(screen.getByLabelText('Second place')).toBeTruthy();
  });
});
