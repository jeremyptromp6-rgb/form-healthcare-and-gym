import { createElement } from 'react';
import { render } from '@testing-library/react-native';
import Svg, { Circle, ClipPath, Defs, Path, Rect } from 'react-native-svg';
import { countSvg } from './svgNodes';

describe('countSvg', () => {
  it('counts a circle and a path as 2 elements, not the svg root or its wrapper group', async () => {
    await render(createElement(Svg, { width: 10, height: 10 }, createElement(Circle, { cx: 1, cy: 1, r: 1 }), createElement(Path, { d: 'M0 0 L1 1' })));
    const found = countSvg();
    expect(found.total).toBe(2);
    expect(found.byType).toEqual({ RNSVGCircle: 1, RNSVGPath: 1 });
    expect(found.forbidden).toEqual([]);
  });

  it('flags a clip path inside defs as forbidden', async () => {
    await render(createElement(Svg, { width: 10, height: 10 }, createElement(Defs, null, createElement(ClipPath, { id: 'c' }, createElement(Rect, { width: 1, height: 1 }))), createElement(Circle, { cx: 1, cy: 1, r: 1 })));
    const found = countSvg();
    expect(found.forbidden).toEqual(['RNSVGClipPath']);
    expect(found.byType.RNSVGDefs).toBeUndefined();
  });
});
