import { render, screen } from '@testing-library/react-native';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { a11yIssues } from '../../../test/a11yAudit';

describe('the accessibility audit itself', () => {
  it('catches unnamed, role-less and tiny controls and unlabelled fields', async () => {
    await render(
      <View>
        <Pressable onPress={() => {}}>
          <Text>Save</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => {}} style={{ width: 20, height: 20 }} />
        <TextInput placeholder="Email" />
        <Switch value={false} onValueChange={() => {}} />
      </View>,
    );
    const issues = a11yIssues(screen.root as never);
    expect(issues).toEqual([
      expect.stringContaining('"Save"> is pressable but has no accessibilityRole'),
      expect.stringContaining('has no accessible name'),
      expect.stringContaining('icon-only with a touch target under 44×44'),
      expect.stringContaining('has no accessible name'),
      expect.stringContaining('text field has no label (placeholder "Email"'),
      expect.stringContaining('has no accessible name'),
    ]);
    await screen.unmount(); // don't leave the bad tree for the global audit
  });

  it('passes labelled controls with a role and a real touch target', async () => {
    await render(
      <View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => {}} hitSlop={12} />
        <TextInput accessibilityLabel="Email" />
        <Switch accessibilityLabel="Weekly summary" value={false} onValueChange={() => {}} />
      </View>,
    );
    expect(a11yIssues(screen.root as never)).toEqual([]);
  });

  it('runs after every component test', () => {
    expect(globalThis.__a11yAudits).toBeGreaterThan(0);
  });
});
