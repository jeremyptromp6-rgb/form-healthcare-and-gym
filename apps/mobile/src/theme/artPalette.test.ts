import { ACCENTS, ANATOMY, art, artPalettes, FOOD_EXTRA, FOODS, METALS, METAL_SYMBOL, METAL_TEXT, STROKE, VIEWBOX, type ArtTone } from './artPalette';
import { contrastRatio } from './contrast';
import { palettes } from './tokens';

const TONES: ArtTone[] = ['light', 'dark'];
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Every leaf of a nested object, as [path, value]. */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [[path, value]];
}

describe('artPalettes', () => {
  it('has the same keys in both tones', () => {
    const keys = (t: ArtTone) => leaves(artPalettes[t]).map(([p]) => p);
    expect(keys('dark')).toEqual(keys('light'));
    expect(keys('light').length).toBeGreaterThan(50);
  });

  it.each(TONES)('%s: every leaf is a #RRGGBB colour or a finite number', (tone) => {
    for (const [path, v] of leaves(artPalettes[tone])) {
      if (typeof v === 'number') expect({ path, ok: Number.isFinite(v) }).toEqual({ path, ok: true });
      else expect({ path, ok: HEX.test(String(v)) }).toEqual({ path, ok: true });
    }
  });

  it.each(TONES)('%s: opacities are within 0..1 and the highlight is subtle', (tone) => {
    const p = artPalettes[tone];
    for (const o of [p.shadowOpacity, p.highlightOpacity, p.rimOpacity, p.scene.glowOpacity, p.locked.shine]) {
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
    expect(p.highlightOpacity).toBeGreaterThanOrEqual(0.2);
    expect(p.highlightOpacity).toBeLessThanOrEqual(0.35);
  });

  it.each(TONES)('%s: the sky is three stops and the surfaces come from the tokens', (tone) => {
    const p = artPalettes[tone];
    expect(p.scene.sky).toHaveLength(3);
    expect(p.surface).toBe(palettes[tone].cardRaised);
    expect(p.floorLine).toBe(palettes[tone].borderStrong);
  });

  it.each(TONES)('%s: state colours have 3:1 contrast on the card (graphics, not text)', (tone) => {
    for (const [name, color] of Object.entries(artPalettes[tone].state)) {
      expect({ name, ok: contrastRatio(color, palettes[tone].card) >= 3 }).toEqual({ name, ok: true });
    }
  });

  it('keeps Pip peach in both tones (a character does not take the brand colour)', () => {
    expect(artPalettes.dark.peach.bottom).toBe('#E5825A');
    expect(artPalettes.dark.shadow).toBe('#000000');
    expect(artPalettes.light.peach.top).toBe('#FFC29B');
    expect(artPalettes.light.ink).toBe(palettes.light.text);
  });

  it('exposes the launch palette as `art`', () => {
    expect([artPalettes.light, artPalettes.dark]).toContain(art);
  });
});

describe('STROKE and VIEWBOX', () => {
  it('uses exactly the 1 / 2 / 3 / 6 stroke widths', () => {
    expect(STROKE).toEqual({ hair: 1, line: 2, bold: 3, heavy: 6 });
  });

  it('keeps each art family viewBox', () => {
    expect(VIEWBOX.pip).toEqual([120, 120]);
    expect(VIEWBOX.meal).toEqual([120, 90]);
    expect(VIEWBOX.figure).toEqual([200, 140]);
    expect(VIEWBOX.emblem).toEqual([100, 108]);
    expect(VIEWBOX.state).toEqual([120, 120]);
  });
});

describe('METALS, FOODS and accents', () => {
  it('has the twelve metals, each with hi, mid, lo and rim colours', () => {
    expect(Object.keys(METALS).sort()).toEqual(['brass', 'bronze', 'chrome', 'gold', 'iron', 'oak', 'platinum', 'rubber', 'sapphire', 'silver', 'steel', 'wood']);
    for (const [name, m] of Object.entries(METALS)) {
      expect(Object.keys(m).sort()).toEqual(['hi', 'lo', 'mid', 'rim']);
      for (const c of Object.values(m)) expect({ name, ok: HEX.test(c) }).toEqual({ name, ok: true });
    }
  });

  it('keeps the original rank metals and equipment colours', () => {
    expect(METALS.oak.mid).toBe('#8A5A33');
    expect(METALS.gold.mid).toBe('#F2B829');
    expect(METALS.sapphire.rim).toBe('#FFD66B');
    expect(METALS.iron.mid).toBe('#8C705C'); // the old equipment colour
    expect(METALS.iron.lo).toBe('#5E4838'); // the old equipment edge
  });

  it('has hex food colours with descriptive keys', () => {
    const entries = Object.entries(FOODS);
    expect(entries.length).toBeGreaterThanOrEqual(50);
    for (const [name, c] of entries) expect({ name, ok: HEX.test(c) }).toEqual({ name, ok: true });
  });

  it('has the rank symbol and text colours for the seven rank metals', () => {
    expect(Object.keys(METAL_SYMBOL)).toHaveLength(7);
    for (const t of TONES) for (const c of Object.values(METAL_TEXT[t])) expect(c).toMatch(HEX);
    expect(Object.keys(METAL_TEXT.dark)).toEqual(Object.keys(METAL_TEXT.light));
  });

  it('has hex food extras and an anatomy palette with the same keys in both tones', () => {
    for (const [name, c] of Object.entries(FOOD_EXTRA)) expect({ name, ok: HEX.test(c) }).toEqual({ name, ok: true });
    expect(Object.keys(ANATOMY.dark)).toEqual(Object.keys(ANATOMY.light));
  });

  it('has the same accent keys in both tones', () => {
    expect(Object.keys(ACCENTS.dark)).toEqual(Object.keys(ACCENTS.light));
  });
});
