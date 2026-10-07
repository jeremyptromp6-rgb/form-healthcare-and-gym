import { fireEvent, render, screen } from '@testing-library/react-native';
import { WelcomeView } from './WelcomeView';

describe('WelcomeView', () => {
  it('welcomes a visitor before asking for an account, with both ways in', async () => {
    const onGetStarted = jest.fn();
    const onSignIn = jest.fn();
    await render(<WelcomeView onGetStarted={onGetStarted} onSignIn={onSignIn} />);
    expect(screen.getByText('Get stronger, eat well, and enjoy every step.')).toBeTruthy();
    expect(screen.getByText('Seven ranks to climb')).toBeTruthy();
    expect(screen.getByText('Home — your day at a glance')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: "Get started — it's free" }));
    expect(onGetStarted).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'I already have an account' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the phone previews out of the screen reader's way", async () => {
    await render(<WelcomeView onGetStarted={jest.fn()} onSignIn={jest.fn()} />);
    // The sample Home inside a preview has its own "Start workout" button; it must not be reachable.
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
  });
});
