import fs from 'fs';
import path from 'path';

/**
 * The UI takes every colour from theme/tokens.ts (colors, gradients, palettes, scrim, edge). No hex
 * or rgba() literals in these sources, except on a line that says why with an `art-exception` comment.
 * The token-plus-alpha-suffix pattern (`${tint}1F`) is not a literal and is allowed. Art has its own
 * rule in test-utils/artRules.test.ts.
 */
const SRC = path.join(__dirname, '..');
const DIRS = ['components/ui', 'components/recognition', 'components/welcome', 'components/home'];
const FILES = ['app/(tabs)/profile/settings.tsx'];

/** Files that may keep literals. Keep this empty: use an `art-exception` comment on the line instead. */
const ALLOWLIST: string[] = [];

const isSource = (f: string) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f);
const sources = [
  ...DIRS.flatMap((d) => fs.readdirSync(path.join(SRC, d)).filter(isSource).map((f) => `${d}/${f}`)),
  ...FILES,
].filter((f) => !ALLOWLIST.includes(f));

// A '#' followed by 3 to 8 hex digits and then a non-word character. `}1F` and `#RRGGBB` do not match.
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGBA = /rgba?\(/;

/** The lines of `text` (1-based) that carry a colour literal and no art-exception comment. */
function literalLines(text: string): { line: number; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((t, i) => ({ line: i + 1, text: t.trim() }))
    .filter(({ text: t }) => (HEX.test(t) || RGBA.test(t)) && !t.includes('art-exception'));
}

describe('no ad-hoc colours in the UI', () => {
  it('finds the sources', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources).toContain('components/ui/feedback.tsx');
    expect(sources).toContain('components/welcome/PhonePreview.tsx');
  });

  it.each(sources)('%s has no hex or rgba literals', (file) => {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8');
    expect({ file, literals: literalLines(text) }).toEqual({ file, literals: [] });
  });

  it('keeps the allowlist honest: every entry exists', () => {
    for (const file of ALLOWLIST) expect(fs.existsSync(path.join(SRC, file))).toBe(true);
  });

  describe('the detector', () => {
    it('flags hex and rgba literals', () => {
      expect(literalLines("const a = '#E0553E';")).toHaveLength(1);
      expect(literalLines("const a = '#fff';")).toHaveLength(1);
      expect(literalLines('const a = "rgba(0,0,0,0.5)";')).toHaveLength(1);
      expect(literalLines('const a = `rgb(1,2,3)`;')).toHaveLength(1);
    });
    it('allows token-plus-alpha suffixes and prose', () => {
      expect(literalLines('const bg = `${tint}1F`;')).toHaveLength(0);
      expect(literalLines('borderColor: `${colors.danger}${pressed ? "66" : "40"}`')).toHaveLength(0);
      expect(literalLines('// tint is a #RRGGBB token colour')).toHaveLength(0);
    });
    it('allows a literal that says why', () => {
      expect(literalLines("const a = '#E0553E'; // art-exception: sample-app colour")).toHaveLength(0);
    });
  });
});
