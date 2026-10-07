import { StyleSheet } from 'react-native';

/**
 * Automated accessibility audit of a rendered tree (host components). Run after every component
 * test (see test/afterEach.ts), so every view any test renders — and every future one — is checked:
 *
 * - every control (anything pressable, a switch, a text field) has a role and an accessible name;
 * - text fields are labelled (a placeholder is not a label);
 * - icon-only controls have a 44 × 44 pt touch target (size or hitSlop).
 *
 * States (checked, selected, disabled) are guarded separately by ariaStates.test.ts: React Native
 * folds aria-* props into accessibilityState on the host, so only the source shows whether the web
 * build (which ignores accessibilityState) gets them.
 *
 * It can't judge wording, focus order or contrast (tokens are contrast-tested separately); those
 * are reviewed by hand. Elements hidden from accessibility are skipped.
 */
interface Node {
  type: string;
  props: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  children: (Node | string)[];
}

const hidden = (n: Node) => n.props.accessibilityElementsHidden === true || n.props.importantForAccessibility === 'no-hide-descendants' || n.props['aria-hidden'] === true;

function textOf(n: Node | string): string {
  if (typeof n === 'string') return n;
  if (hidden(n)) return '';
  return n.children.map(textOf).join('');
}

const pressable = (p: Node['props']) => typeof p.onPress === 'function' || typeof p.onClick === 'function' || typeof p.onResponderRelease === 'function';
const name = (n: Node) => String(n.props.accessibilityLabel ?? n.props['aria-label'] ?? textOf(n)).trim();
const role = (n: Node) => n.props.accessibilityRole ?? n.props.role;
const describe = (n: Node) => `<${n.type}${name(n) ? ` "${name(n).slice(0, 40)}"` : ''}${n.props.testID ? ` testID=${n.props.testID}` : ''}>`;

function targetOk(n: Node): boolean {
  if (n.props.hitSlop) return true;
  const s = StyleSheet.flatten(n.props.style) ?? {};
  const size = (a: unknown, b: unknown) => Math.max(typeof a === 'number' ? a : 0, typeof b === 'number' ? b : 0);
  return size(s.minHeight, s.height) >= 44 && size(s.minWidth, s.width) >= 44;
}

export function a11yIssues(root: Node | null): string[] {
  const issues: string[] = [];
  const walk = (n: Node | string, insideControl: boolean) => {
    if (typeof n === 'string' || hidden(n)) return;
    const p = n.props;
    const isField = n.type === 'TextInput';
    const isSwitch = n.type === 'RCTSwitch' || n.type === 'AndroidSwitch' || typeof p.onValueChange === 'function';
    const isControl = !insideControl && (pressable(p) || isField || isSwitch) && p.accessible !== false && p.disabled !== true;
    if (isControl) {
      if (!isField && !isSwitch && !role(n)) issues.push(`${describe(n)} is pressable but has no accessibilityRole`);
      if (!name(n)) issues.push(`${describe(n)} has no accessible name`);
      if (isField && !(p.accessibilityLabel ?? p['aria-label'])) issues.push(`${describe(n)} text field has no label (placeholder ${JSON.stringify(p.placeholder ?? null)} isn't one)`);
      if (!isField && !isSwitch && !textOf(n).trim() && !targetOk(n)) issues.push(`${describe(n)} is icon-only with a touch target under 44×44 and no hitSlop`);
    }
    for (const c of n.children) walk(c, insideControl || (isControl && !isField));
  };
  if (root) walk(root, false);
  return issues;
}
