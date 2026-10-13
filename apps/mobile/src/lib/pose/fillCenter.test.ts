/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
import { fillCenter } from './fillCenter';

// The vectors are shared with the native overlay's JVM test (FillCenterTest), so the two
// implementations of the preview's fill-and-centre mapping cannot drift apart.
const CSV = join(__dirname, '../../../modules/form-pose-camera/android/src/test/resources/fill_center_vectors.csv');
const TOLERANCE = 1e-3;

interface Row {
  imgW: number;
  imgH: number;
  viewW: number;
  viewH: number;
  mirror: boolean;
  nx: number;
  ny: number;
  expX: number;
  expY: number;
}

function rows(): Row[] {
  const lines = readFileSync(CSV, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  expect(lines[0]).toBe('imgW,imgH,viewW,viewH,mirror,nx,ny,expX,expY');
  return lines.slice(1).map((line) => {
    const [imgW, imgH, viewW, viewH, mirror, nx, ny, expX, expY] = line.split(',').map(Number) as [number, number, number, number, number, number, number, number, number];
    return { imgW, imgH, viewW, viewH, mirror: mirror === 1, nx, ny, expX, expY };
  });
}

describe('fillCenter', () => {
  it('reproduces every shared vector within 1e-3', () => {
    const all = rows();
    expect(all.length).toBeGreaterThan(100);
    for (const r of all) {
      const fc = fillCenter(r.imgW, r.imgH, r.viewW, r.viewH, r.mirror);
      const label = `${r.imgW}x${r.imgH} in ${r.viewW}x${r.viewH} mirror ${r.mirror} at (${r.nx}, ${r.ny})`;
      expect({ label, x: Math.abs(fc.x(r.nx) - r.expX) <= TOLERANCE }).toEqual({ label, x: true });
      expect({ label, y: Math.abs(fc.y(r.ny) - r.expY) <= TOLERANCE }).toEqual({ label, y: true });
    }
  });

  it('fills the view and centres the overflow', () => {
    const fc = fillCenter(480, 640, 320, 568, false);
    expect(fc.scale).toBeCloseTo(568 / 640);
    expect(fc.dw).toBeCloseTo(426);
    expect(fc.dh).toBeCloseTo(568);
    expect(fc.ox).toBeCloseTo(-53);
    expect(fc.oy).toBeCloseTo(0);
    expect(fc.x(0)).toBeCloseTo(-53);
    expect(fc.x(1)).toBeCloseTo(373);
  });

  it('mirrors about the view, not the image', () => {
    const plain = fillCenter(480, 640, 360, 800, false);
    const mirrored = fillCenter(480, 640, 360, 800, true);
    for (const nx of [0, 0.25, 0.5, 1]) expect(mirrored.x(nx)).toBeCloseTo(360 - plain.x(nx));
    expect(mirrored.y(0.3)).toBeCloseTo(plain.y(0.3));
  });
});
