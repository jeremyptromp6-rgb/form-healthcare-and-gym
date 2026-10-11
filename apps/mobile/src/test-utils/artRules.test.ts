import fs from 'fs';
import path from 'path';

/**
 * Art components take every colour from theme/artPalette.ts (or tokens). No hex or rgba() in
 * src/components/art/*.tsx. Files not yet migrated are allowlisted here; each IMAGES task removes
 * its own file(s) from the list when it moves the colours out. Never add a file to the list.
 */
const ALLOWLIST: string[] = [];

const ART_DIR = path.join(__dirname, '..', 'components', 'art');
const isSource = (f: string) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f);
const sources = fs.readdirSync(ART_DIR).filter(isSource);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA = /rgba\(/g;

describe('art colour rules', () => {
  it('finds the art sources', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  // Empty once every file is migrated (or until a new art file is added: it must be clean).
  const checked = sources.filter((f) => !ALLOWLIST.includes(f));
  if (checked.length) {
    it.each(checked)('%s has no hex or rgba colours', (file) => {
      const text = fs.readFileSync(path.join(ART_DIR, file), 'utf8');
      expect({ file, hex: text.match(HEX) ?? [], rgba: text.match(RGBA) ?? [] }).toEqual({ file, hex: [], rgba: [] });
    });
  }

  it('keeps the allowlist honest: every entry still exists', () => {
    for (const file of ALLOWLIST) expect({ file, exists: sources.includes(file) }).toEqual({ file, exists: true });
  });
});
