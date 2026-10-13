import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import BarcodeScreen from '@/app/(tabs)/eat/barcode';

/** The barcode route with camera access blocked: "Open Settings" exists on phones only (the web has no such page). */

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: false }, jest.fn()],
}));

afterEach(() => jest.restoreAllMocks());

describe('Barcode screen, camera blocked', () => {
  it('on a phone, opens the device settings', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    open.mockClear();
    await render(<BarcodeScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('on the web, offers no settings button and never calls openSettings', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    open.mockClear();
    await render(<BarcodeScreen />);
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(open).not.toHaveBeenCalled();
    // Typing the number is still there.
    expect(screen.getByText('Or type the barcode number')).toBeTruthy();
  });
});
