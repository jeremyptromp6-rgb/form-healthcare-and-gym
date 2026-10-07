import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { Button, ErrorState, Segmented, StateView } from './index';

// @testing-library/react-native v14: render and events are async.
describe('design system', () => {
  it('ErrorState offers a retry for network failures', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState error={new ApiError('network', 'network', 'x', null, true)} onRetry={onRetry} />);
    expect(screen.getByText("Can't reach FORM")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState shows an honest unavailable state without a pointless retry', async () => {
    await render(<ErrorState error={new ApiError('unavailable', 'provider_unconfigured', 'AI coach is not configured', 503, false)} onRetry={jest.fn()} />);
    expect(screen.getByText('Temporarily unavailable')).toBeTruthy();
    expect(screen.getByText('AI coach is not configured')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('StateView loading is announced to screen readers', async () => {
    await render(<StateView kind="loading" />);
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('Button does not fire while disabled, and exposes its state', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toMatchObject({ disabled: true });

    await render(<Button label="Save" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Segmented is an accessible radio group', async () => {
    const onChange = jest.fn();
    await render(
      <Segmented
        label="Goal"
        value="maintain"
        onChange={onChange}
        options={[
          { value: 'lose', label: 'Lose fat' },
          { value: 'maintain', label: 'Maintain' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Maintain' }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole('radio', { name: 'Lose fat' }));
    expect(onChange).toHaveBeenCalledWith('lose');
  });
});
