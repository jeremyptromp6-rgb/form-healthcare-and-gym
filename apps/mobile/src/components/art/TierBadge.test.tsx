import { MUSCLE_TIERS } from '@form/domain';
import { render } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { BodyMap, MUSCLES } from './BodyMap';
import { chevrons, TierBadge } from './TierBadge';

const TONES: ArtTone[] = ['light', 'dark'];

describe('TierBadge', () => {
  it('draws one to three chevrons for the level', () => {
    expect(chevrons(0)).toBe('');
    expect(chevrons(1).split('M').length - 1).toBe(1);
    expect(chevrons(3).split('M').length - 1).toBe(3);
  });

  it.each(TONES)('stays within 20 elements for every tier and level in the %s tone', async (tone) => {
    for (const tier of MUSCLE_TIERS) {
      for (const level of tier === 'untrained' ? [0] : [1, 2, 3]) {
        const { unmount } = await render(<TierBadge tier={tier} level={level} tone={tone} />);
        const found = countSvg();
        expect(found.total).toBeGreaterThan(3);
        expect(found.total).toBeLessThanOrEqual(20);
        expect(found.forbidden).toEqual([]);
        await unmount();
      }
    }
  });
});

describe('BodyMap tiers', () => {
  it.each(TONES)('paints every muscle in its tier within 200 elements (%s tone)', async (tone) => {
    const tiers = Object.fromEntries(MUSCLES.map((m, i) => [m, MUSCLE_TIERS[i % MUSCLE_TIERS.length]]));
    await render(<BodyMap tiers={tiers} tone={tone} />);
    const found = countSvg();
    expect(found.total).toBeLessThanOrEqual(200);
    expect(found.forbidden).toEqual([]);
  });

  it('labels the map with each muscle and its tier', async () => {
    const { getByLabelText } = await render(<BodyMap tiers={{ chest: 'gold', quads: 'bronze' }} />);
    expect(getByLabelText(/Chest gold.*Glutes untrained.*Quads bronze/)).toBeTruthy();
  });
});
