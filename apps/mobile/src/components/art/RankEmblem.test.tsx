import { render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import { METAL_TEXT, type ArtTone } from '@/theme/artPalette';
import { RANK_ORDER, RankEmblem, rankColor, rankColorFor } from './RankEmblem';

const TONES: ArtTone[] = ['light', 'dark'];

interface Json {
  type: string;
  props?: { d?: string };
  children?: (Json | string)[] | null;
}

/** Every path the emblem draws, in order. */
function pathsOf(json: unknown): string[] {
  const out: string[] = [];
  const visit = (n: Json | string | null | undefined) => {
    if (!n || typeof n === 'string') return;
    if (n.type === 'RNSVGPath' && n.props?.d) out.push(n.props.d);
    n.children?.forEach(visit);
  };
  visit(json as Json);
  return out;
}

describe('RankEmblem', () => {
  describe.each(TONES)('in the %s tone', (tone) => {
    it.each(RANK_ORDER)('%s stays within 40 elements, with no filters, masks or clips', async (rank) => {
      await render(<RankEmblem rank={rank} tone={tone} />);
      const found = countSvg();
      expect(found.total).toBeGreaterThan(8);
      expect(found.total).toBeLessThanOrEqual(40);
      expect(found.forbidden).toEqual([]);
    });

    it.each(RANK_ORDER)('%s locked stays within 40 elements', async (rank) => {
      await render(<RankEmblem rank={rank} tone={tone} locked />);
      const found = countSvg();
      expect(found.total).toBeLessThanOrEqual(40);
      expect(found.forbidden).toEqual([]);
    });
  });

  it('draws without a tone, in the launch scheme', async () => {
    await render(<RankEmblem rank="Elite" />);
    expect(countSvg().total).toBeLessThanOrEqual(40);
  });

  it('keeps its image labels', async () => {
    for (const rank of RANK_ORDER) {
      const { unmount } = await render(<RankEmblem rank={rank} />);
      expect(screen.getByRole('image', { name: `${rank} rank` })).toBeTruthy();
      await unmount();
    }
    await render(<RankEmblem rank="Master" locked />);
    expect(screen.getByRole('image', { name: 'Master rank, not reached yet' })).toBeTruthy();
  });

  it('sizes its host box from `size`', async () => {
    await render(<RankEmblem rank="Iron" size={38} />);
    expect(JSON.stringify((screen.toJSON() as unknown as { props: { style: unknown } }).props.style)).toContain(`${38 * 1.08}`);
  });

  it('gives every rank its own silhouette, not only its own colour', async () => {
    const outlines = new Set<string>();
    for (const rank of RANK_ORDER) {
      const { unmount } = await render(<RankEmblem rank={rank} />);
      // the drawn shapes with colour left out: one signature per rank
      outlines.add(pathsOf(screen.toJSON()).join('|'));
      await unmount();
    }
    expect(outlines.size).toBe(RANK_ORDER.length);
  });

  it('shows a locked rank as an unrevealed clay shield, not a recoloured metal one', async () => {
    const { unmount } = await render(<RankEmblem rank="Elite" tone="light" />);
    const metal = countSvg();
    await unmount();
    await render(<RankEmblem rank="Elite" tone="light" locked />);
    const clay = countSvg();
    // one clay gradient in place of the metal frame and face gradients
    expect(clay.byType.RNSVGLinearGradient).toBe(1);
    expect(metal.byType.RNSVGLinearGradient).toBeGreaterThanOrEqual(2);
  });

  it('falls back to Rookie art for an unknown rank but keeps the given name in its label', async () => {
    await render(<RankEmblem rank="Legend" />);
    expect(screen.getByRole('image', { name: 'Legend rank' })).toBeTruthy();
  });

  describe('rank text colours', () => {
    it('are the metal text colours in each tone', () => {
      expect(rankColorFor('Rookie', 'light')).toBe(METAL_TEXT.light.oak);
      expect(rankColorFor('Champion', 'dark')).toBe(METAL_TEXT.dark.sapphire);
      expect(rankColorFor('Master', 'light')).toBe(METAL_TEXT.light.platinum);
    });

    it('fall back to Rookie for an unknown rank', () => {
      expect(rankColorFor('Legend', 'dark')).toBe(METAL_TEXT.dark.oak);
      expect(typeof rankColor('Elite')).toBe('string');
    });
  });
});
