import { render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { Screen } from './layout';

let mounts = 0;
function Page() {
  const [id] = useState(() => ++mounts);
  return <Text>{`page mounted ${id}`}</Text>;
}

describe('Screen', () => {
  beforeEach(() => {
    mounts = 0;
  });

  it('keeps the page below alive when a banner appears above it (children keyed, not indexed)', async () => {
    const { rerender } = await render(
      <Screen title="T">
        {false ? <Text>banner</Text> : null}
        <Page />
      </Screen>,
    );
    expect(screen.getByText('page mounted 1')).toBeTruthy();
    await rerender(
      <Screen title="T">
        {true ? <Text>banner</Text> : null}
        <Page />
      </Screen>,
    );
    expect(screen.getByText('banner')).toBeTruthy();
    // Index keys would have remounted the page here (a new mount id, its state and scroll reset).
    expect(screen.getByText('page mounted 1')).toBeTruthy();
    expect(mounts).toBe(1);
  });
});
