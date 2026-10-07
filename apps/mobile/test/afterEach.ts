// The `pure` entry shares Testing Library's `screen` but registers no hooks of its own, so this
// hook runs before the auto-cleanup a test file registers when it imports the library.
import { screen } from '@testing-library/react-native/pure';
import { a11yIssues } from './a11yAudit';

/**
 * After every test, audit whatever it left rendered. A failure names each control and what is
 * missing (see test/a11yAudit.ts).
 */
declare global {
  var __a11yAudits: number; // eslint-disable-line no-var
}
globalThis.__a11yAudits = 0;

afterEach(() => {
  let root;
  try {
    root = screen.root;
  } catch {
    return; // nothing rendered in this test
  }
  if (!root) return;
  globalThis.__a11yAudits++;
  const issues = a11yIssues(root as never);
  if (issues.length) throw new Error(`Accessibility audit failed:\n  - ${issues.join('\n  - ')}`);
});
