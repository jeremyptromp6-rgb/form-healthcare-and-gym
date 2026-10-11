import { screen } from '@testing-library/react-native';

/**
 * Counts the SVG elements in a rendered tree, to hold art to its element budgets (docs/art-style.md).
 *
 * Host type names, as react-native-svg renders them under jest-expo (checked by rendering and
 * printing `toJSON()`): every `<Svg>` is `RNSVGSvgView` (`RNSVGSvgViewAndroid` on Android builds)
 * wrapping ONE extra `RNSVGGroup` that holds everything; then `RNSVGCircle`, `RNSVGPath`,
 * `RNSVGRect`, `RNSVGEllipse`, `RNSVGLine`, `RNSVGGroup` (for `<G>`), `RNSVGDefs`,
 * `RNSVGLinearGradient`, `RNSVGRadialGradient`, `RNSVGClipPath`, `RNSVGMask`, `RNSVGFilter`, and
 * for `<Text>` an `RNSVGText` holding an `RNSVGTSpan` (so a label counts as 2).
 * `<Stop>` renders no node (it is data on its gradient).
 *
 * The count skips the svg root, `RNSVGDefs` and that wrapper group, so `total` is the elements an
 * artist drew, gradients included. `forbidden` lists any filter, mask or clip path, wherever it sits.
 */
interface SvgJson {
  type: string;
  children?: (SvgJson | string)[] | null;
}

const ROOTS = new Set(['RNSVGSvgView', 'RNSVGSvgViewAndroid']);
const NOT_COUNTED = new Set([...ROOTS, 'RNSVGDefs']);
const FORBIDDEN = new Set(['RNSVGFilter', 'RNSVGMask', 'RNSVGClipPath']);

export interface SvgCount {
  total: number;
  byType: Record<string, number>;
  forbidden: string[];
}

export function countSvg(json: unknown = screen.toJSON()): SvgCount {
  const out: SvgCount = { total: 0, byType: {}, forbidden: [] };
  const visit = (node: SvgJson | string | null | undefined, parentIsRoot: boolean) => {
    if (!node || typeof node === 'string') return;
    const type = node.type;
    const isSvg = type.startsWith('RNSVG');
    // The group react-native-svg puts directly under each svg root is plumbing, not drawing.
    const wrapper = isSvg && parentIsRoot && type === 'RNSVGGroup';
    if (isSvg && !NOT_COUNTED.has(type) && !wrapper) {
      out.total++;
      out.byType[type] = (out.byType[type] ?? 0) + 1;
    }
    if (FORBIDDEN.has(type)) out.forbidden.push(type);
    for (const child of node.children ?? []) visit(child, ROOTS.has(type));
  };
  const list = Array.isArray(json) ? json : [json];
  for (const root of list) visit(root as SvgJson | null, false);
  return out;
}
