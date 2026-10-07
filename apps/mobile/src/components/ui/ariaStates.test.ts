/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * React Native Web ignores `accessibilityState`, so on the web a checked radio, a selected tab or a
 * disabled button is only announced if the matching aria-* prop is set too. Every accessibilityState
 * in the app must be mirrored (native reads either).
 */
const ROOT = join(__dirname, '..', '..');
const ARIA: Record<string, string> = { checked: 'aria-checked', selected: 'aria-selected', disabled: 'aria-disabled', busy: 'aria-busy' };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) ? [p] : [];
  });
}

describe('accessibility states reach the web build', () => {
  it('mirrors every accessibilityState key as its aria-* prop', () => {
    const missing: string[] = [];
    for (const file of sources(ROOT)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/accessibilityState=\{\{([^}]*)\}\}([^>]{0,200})/g)) {
        for (const key of Object.keys(ARIA)) {
          if (new RegExp(`\b${key}:`).test(m[1]!) && !m[2]!.includes(ARIA[key]!)) missing.push(`${relative(ROOT, file)}: ${key} without ${ARIA[key]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
