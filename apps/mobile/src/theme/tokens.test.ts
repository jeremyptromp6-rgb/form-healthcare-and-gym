import { contrastRatio } from './contrast';
import { RANK_ORDER, rankColorFor } from '@/components/art/RankEmblem';
import { allElevations, allGradients, colors as launchColors, edgeLight, elevation, glow, palettes, scheme, shadow, type, type ElevationName } from './tokens';

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

describe.each(['light', 'dark'] as const)('%s depth tokens', (tone) => {
  it('has a scrim that dims without hiding the page (alpha 0.3 to 0.7)', () => {
    const match = /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/.exec(palettes[tone].scrim);
    expect(match).not.toBeNull();
    const alpha = Number(match![1]);
    expect(alpha).toBeGreaterThanOrEqual(0.3);
    expect(alpha).toBeLessThanOrEqual(0.7);
  });

  it('has every elevation step with numeric values that rise with the level', () => {
    const steps: ElevationName[] = ['flat', 'card', 'raised', 'lifted', 'modal'];
    let prev = -1;
    for (const name of steps) {
      const e = allElevations[tone][name];
      expect(typeof e.shadowOpacity).toBe('number');
      expect(typeof e.shadowRadius).toBe('number');
      expect(typeof e.elevation).toBe('number');
      expect(e.shadowOffset).toEqual({ width: 0, height: expect.any(Number) });
      expect(e.elevation!).toBeGreaterThanOrEqual(prev);
      prev = e.elevation!;
    }
    expect(allElevations[tone].flat.shadowOpacity).toBe(0);
  });

  it('casts a cool shadow in light mode and a black one in dark mode', () => {
    expect(allElevations[tone].card.shadowColor).toBe(tone === 'light' ? '#0B2A22' : '#000000');
  });
});

describe('launch-scheme depth tokens', () => {
  it('exports every elevation name and keeps the old shadow aliases', () => {
    expect(Object.keys(elevation).sort()).toEqual(['card', 'flat', 'lifted', 'modal', 'raised']);
    expect(shadow.card).toBe(elevation.card);
    expect(shadow.lifted).toBe(elevation.lifted);
  });

  it('has an edge light and a glow that only show in dark mode', () => {
    if (scheme === 'dark') {
      expect(edgeLight.borderTopColor).toBe(launchColors.edge);
      expect(glow('#10B981').shadowColor).toBe('#10B981');
    } else {
      expect(edgeLight).toEqual({});
      expect(glow('#10B981')).toEqual({});
    }
  });
});

describe('type tokens', () => {
  it('has no text under 12px', () => {
    for (const [name, style] of Object.entries(type)) {
      expect({ name, ok: (style.fontSize ?? 0) >= 12 }).toEqual({ name, ok: true });
    }
  });

  it.each(['screenTitle', 'sectionTitle', 'titleSm', 'stat', 'valueLg'] as const)('%s has a size and a line height that fits it', (name) => {
    expect(type[name].fontSize).toBeGreaterThanOrEqual(12);
    expect(type[name].lineHeight).toBeGreaterThan(type[name].fontSize);
  });

  it('sets numeric figures in tabular numbers', () => {
    expect(type.stat.fontVariant).toContain('tabular-nums');
    expect(type.valueLg.fontVariant).toContain('tabular-nums');
  });
});

it('computes known reference ratios', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
});
