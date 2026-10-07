import { contrastRatio } from './contrast';
import { RANK_ORDER, rankColorFor } from '@/components/art/RankEmblem';
import { allGradients, palettes } from './tokens';

describe.each(['light', 'dark'] as const)('%s palette meets WCAG AA contrast', (scheme) => {
  const colors = palettes[scheme];
  const SURFACES = { bg: colors.bg, surface: colors.surface, card: colors.card, cardRaised: colors.cardRaised };

  it.each(['text', 'textMuted', 'textFaint'] as const)('%s is at least 4.5:1 on every surface', (token) => {
    for (const [name, bg] of Object.entries(SURFACES)) {
      expect({ on: name, ratio: contrastRatio(colors[token], bg) >= 4.5 }).toEqual({ on: name, ratio: true });
    }
  });

  it.each(['primary', 'accent', 'success', 'water', 'purple', 'warning', 'danger', 'protein', 'carbs', 'fat'] as const)('%s accent is at least 3:1 (large text / UI) on cards', (token) => {
    expect(contrastRatio(colors[token], colors.card)).toBeGreaterThanOrEqual(3);
  });

  it('text on the primary colour is readable', () => {
    expect(contrastRatio(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.onPrimary, colors.primaryDeep)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(RANK_ORDER)('%s rank text is at least 4.5:1 on cards, the page and the hero wash', (rank) => {
    for (const bg of [colors.card, colors.bg, allGradients[scheme].heroMedia[0]]) {
      expect(contrastRatio(rankColorFor(rank, scheme), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it('computes known reference ratios', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
});
