import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { countSvg } from '@/test-utils/svgNodes';
import type { ArtTone } from '@/theme/artPalette';
import { Buddy, type BuddyMood } from './Buddy';
import { StateArt, STATE_ART_KINDS, type StateArtKind } from './StateArt';

const TONES: ArtTone[] = ['light', 'dark'];

// The mood Pip wears in each scene (docs/art-style.md, round 3 plan).
const MOOD: Record<StateArtKind, BuddyMood> = {
  generic: 'happy',
  noWorkouts: 'rest',
  noRecords: 'thinking',
  groceryEmpty: 'happy',
  notFound: 'thinking',
  offline: 'worried',
  serverError: 'worried',
  cameraPermission: 'thinking',
  unavailable: 'sleepy',
};

describe('StateArt', () => {
  it('has the nine kinds', () => {
    expect([...STATE_ART_KINDS].sort()).toEqual(Object.keys(MOOD).sort());
  });

  describe.each(TONES)('in the %s tone', (tone) => {
    it.each(STATE_ART_KINDS)('%s: prop within 40 elements, whole scene within 100, no filters, masks or clips', async (kind) => {
      const { unmount } = await render(<Buddy mood={MOOD[kind]} tone={tone} float={false} />);
      const pip = countSvg().total;
      await unmount();
      await render(<StateArt kind={kind} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeLessThanOrEqual(100);
      expect(found.total - pip).toBeGreaterThan(0);
      expect(found.total - pip).toBeLessThanOrEqual(40);
      expect(found.forbidden).toEqual([]);
    });
  });

  it.each(STATE_ART_KINDS)('%s is hidden from accessibility', async (kind) => {
    await render(<StateArt kind={kind} size={64} />);
    const root = screen.toJSON() as { props: Record<string, unknown> };
    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props['aria-hidden']).toBe(true);
  });

  it('sizes the square from the size prop', async () => {
    await render(<StateArt kind="generic" size={88} />);
    const root = screen.toJSON() as { props: Record<string, unknown> };
    expect(StyleSheet.flatten(root.props.style as never)).toMatchObject({ width: 88, height: 88 });
  });
});
