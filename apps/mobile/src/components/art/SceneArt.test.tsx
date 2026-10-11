import { render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { processColor } from 'react-native';
import { countSvg } from '@/test-utils/svgNodes';
import { artPalettes, type ArtTone } from '@/theme/artPalette';
import { contrastRatio } from '@/theme/contrast';
import { palettes } from '@/theme/tokens';
import { FormMark, ProgressArt, ringsHills, RingsArt, TrophyArt, WelcomeArt } from './SceneArt';

const TONES: ArtTone[] = ['light', 'dark'];

const SCENES: Record<string, (tone?: ArtTone) => ReactElement> = {
  RingsArt: (tone) => <RingsArt tone={tone} />,
  ProgressArt: (tone) => <ProgressArt tone={tone} />,
  WelcomeArt: (tone) => <WelcomeArt tone={tone} />,
  TrophyArt: (tone) => <TrophyArt tone={tone} />,
  FormMark: (tone) => <FormMark tone={tone} />,
};

interface Json {
  type: string;
  props?: { fill?: { type: number; payload?: number } | null; gradient?: number[]; d?: string };
  children?: (Json | string)[] | null;
}

function walk(node: Json | string | null | undefined, visit: (n: Json) => void) {
  if (!node || typeof node === 'string') return;
  visit(node);
  node.children?.forEach((c) => walk(c, visit));
}

/** How many drawn nodes are filled with this plain colour. */
function filledWith(color: string): number {
  const want = (processColor(color) as number) >>> 0;
  let n = 0;
  const visit = (node: Json | string | null | undefined) => {
    if (!node || typeof node === 'string') return;
    const fill = node.props?.fill;
    if (fill && fill.type === 0 && typeof fill.payload === 'number' && fill.payload >>> 0 === want) n++;
    node.children?.forEach(visit);
  };
  visit(screen.toJSON() as Json | null);
  return n;
}

describe('SceneArt', () => {
  describe.each(TONES)('in the %s tone', (tone) => {
    it.each(Object.keys(SCENES))('%s stays within 60 elements and has no filters, masks or clips', async (name) => {
      await render(SCENES[name]!(tone));
      const found = countSvg();
      expect(found.total).toBeGreaterThan(0);
      expect(found.total).toBeLessThanOrEqual(60);
      expect(found.forbidden).toEqual([]);
    });
  });

  it('draws without a tone, in the launch scheme', async () => {
    for (const name of Object.keys(SCENES)) {
      const { unmount } = await render(SCENES[name]!());
      expect(countSvg().total).toBeLessThanOrEqual(60);
      await unmount();
    }
  });

  describe.each(['RingsArt', 'WelcomeArt'])('%s at night', (name) => {
    it('is a redrawn scene, not the day with other colours', async () => {
      const { unmount } = await render(SCENES[name]!('light'));
      const day = countSvg();
      const dayStars = filledWith(artPalettes.light.scene.star);
      await unmount();
      await render(SCENES[name]!('dark'));
      const night = countSvg();
      const nightStars = filledWith(artPalettes.dark.scene.star);
      expect(night.byType).not.toEqual(day.byType);
      expect(dayStars).toBe(0);
      expect(nightStars).toBeGreaterThanOrEqual(5);
    });
  });

  it('shows the Progress terraces at night with their own moon and stars', async () => {
    const { unmount } = await render(<ProgressArt tone="light" />);
    const day = countSvg();
    await unmount();
    await render(<ProgressArt tone="dark" />);
    expect(countSvg().byType).not.toEqual(day.byType);
    expect(filledWith(artPalettes.dark.scene.star)).toBeGreaterThanOrEqual(3);
  });

  describe.each(TONES)('Home hero text band in the %s tone', (tone) => {
    it('keeps the muted text colour at 4.5:1 or better on every hill behind the words', () => {
      const muted = palettes[tone].textMuted;
      const hills = ringsHills(tone);
      for (const [name, hill] of Object.entries(hills)) {
        expect({ name, side: 'crest', ratio: contrastRatio(muted, hill.from) >= 4.5 }).toEqual({ name, side: 'crest', ratio: true });
        expect({ name, side: 'fade', ratio: contrastRatio(muted, hill.to) >= 4.5 }).toEqual({ name, side: 'fade', ratio: true });
      }
    });

    it('draws those hills (their crest colours are gradient stops in the scene)', async () => {
      await render(<RingsArt tone={tone} />);
      const stopColors = new Set<number>();
      walk(screen.toJSON() as Json | null, (node) => {
        const gradient = node.props?.gradient;
        if (node.type === 'RNSVGLinearGradient' && gradient) for (let i = 1; i < gradient.length; i += 2) stopColors.add((gradient[i] as number) >>> 0);
      });
      for (const hill of Object.values(ringsHills(tone))) {
        expect(stopColors.has((processColor(hill.from) as number) >>> 0)).toBe(true);
      }
    });
  });

  it('keeps the Home trees out of the left and centre text band', async () => {
    await render(<RingsArt tone="light" />);
    // Trunks are the short vertical strokes "M<x> <y> V<y2>" standing on the mid hill's crest (y 158-165).
    const trunks: number[] = [];
    walk(screen.toJSON() as Json | null, (node) => {
      const m = /^M(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) V\d+(?:\.\d+)?$/.exec(node.props?.d ?? '');
      if (m && Number(m[2]) >= 158 && Number(m[2]) <= 165) trunks.push(Number(m[1]));
    });
    // They were at x 232-268, behind the caption; they now stand at the right edge.
    expect(trunks.length).toBeGreaterThanOrEqual(2);
    for (const x of trunks) expect(x).toBeGreaterThanOrEqual(280);
  });

  describe('accessibility', () => {
    it.each(['RingsArt', 'ProgressArt', 'WelcomeArt', 'TrophyArt'])('%s is decorative and hidden', async (name) => {
      await render(SCENES[name]!('light'));
      const root = screen.toJSON() as { props: Record<string, unknown> };
      expect(root.props.accessible).toBe(false);
      expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
      expect(root.props['aria-hidden']).toBe(true);
    });

    it('FormMark keeps its "FORM" image label', async () => {
      await render(<FormMark />);
      expect(screen.getByRole('image', { name: 'FORM' })).toBeTruthy();
    });
  });

  it('keeps the host box size of the sized pieces', async () => {
    await render(<TrophyArt size={64} />);
    expect(screen.toJSON()).toMatchObject({ props: { style: { width: 64, height: 64 } } });
  });
});
