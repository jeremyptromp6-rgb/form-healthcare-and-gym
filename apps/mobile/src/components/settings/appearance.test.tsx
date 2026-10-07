import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppearancePicker } from './AppearancePicker';

const mockWrite = jest.fn();
const mockApply = jest.fn();
jest.mock('@/theme/appearance', () => ({
  readThemePreference: () => 'system',
  writeThemePreference: (p: string) => mockWrite(p),
  applyThemeNow: () => mockApply(),
  appliesImmediately: false,
}));

describe('AppearancePicker', () => {
  it('offers Morning, Evening and the device setting, saves the choice and says when it applies', async () => {
    await render(<AppearancePicker />);
    expect(screen.getByLabelText('Device').props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(screen.getByLabelText('Evening'));
    expect(mockWrite).toHaveBeenCalledWith('dark');
    expect(mockApply).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Evening').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByText(/close and reopen FORM/)).toBeTruthy();
  });
});
