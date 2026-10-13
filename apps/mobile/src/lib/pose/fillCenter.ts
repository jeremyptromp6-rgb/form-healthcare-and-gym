/**
 * A TypeScript mirror of the native overlay's FillCenter (core/FillCenter.kt): where a landmark,
 * normalized over the analysed region, lands in a view that shows that region scaled to fill and
 * centred (the preview's FILL_CENTER). Both read the same vectors (fill_center_vectors.csv), so the
 * two cannot drift apart.
 */
export interface FillCenter {
  scale: number;
  /** Where the scaled region's top-left corner sits in the view (negative when it overflows). */
  ox: number;
  oy: number;
  /** The scaled region's size. */
  dw: number;
  dh: number;
  viewW: number;
  mirrorX: boolean;
  x(nx: number): number;
  y(ny: number): number;
}

export function fillCenter(imgW: number, imgH: number, viewW: number, viewH: number, mirrorX: boolean): FillCenter {
  const scale = Math.max(viewW / imgW, viewH / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  const ox = (viewW - dw) / 2;
  const oy = (viewH - dh) / 2;
  return {
    scale,
    ox,
    oy,
    dw,
    dh,
    viewW,
    mirrorX,
    x: (nx) => (mirrorX ? viewW - (ox + nx * dw) : ox + nx * dw),
    y: (ny) => oy + ny * dh,
  };
}
