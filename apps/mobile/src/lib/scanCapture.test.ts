import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { discardTemp } from './privateFiles';
import { capturePhoto } from './scanCapture';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('./privateFiles', () => ({ discardTemp: jest.fn() }));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const manip = ImageManipulator as jest.Mocked<typeof ImageManipulator>;
const mockDiscard = discardTemp as jest.Mock;

function setup(asset: { width?: number; height?: number }, saved: Record<string, unknown>, rendered: Record<string, unknown> = {}) {
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as never);
  const result = { canceled: false, assets: [{ uri: 'file:///photo.jpg', ...asset }] } as never;
  picker.launchCameraAsync.mockResolvedValue(result);
  picker.launchImageLibraryAsync.mockResolvedValue(result);
  const saveAsync = jest.fn().mockResolvedValue({ uri: 'file:///out.jpg', ...saved });
  const ctx = { resize: jest.fn(), renderAsync: jest.fn().mockResolvedValue({ ...rendered, saveAsync }) };
  ctx.resize.mockReturnValue(ctx);
  manip.manipulate.mockReturnValue(ctx as never);
  return { ctx, saveAsync };
}

describe('capturePhoto dimensions', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['camera', 'library'] as const)('%s: returns the encoded photo size from the save result, not the picker asset', async (source) => {
    // A portrait photo the picker reports landscape (orientation ignored); the saved bitmap is upright.
    const { ctx, saveAsync } = setup({ width: 4000, height: 3000 }, { base64: 'QUJD', width: 960, height: 1280 });
    const r = await capturePhoto(source);
    expect(r).toEqual({ ok: true, image: { uri: 'data:image/jpeg;base64,QUJD', base64: 'QUJD', width: 960, height: 1280 } });
    expect(ctx.resize).toHaveBeenCalledWith({ width: 1280 });
    expect(saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.7, base64: true });
  });

  it('strips a data-URI prefix from the base64 and keeps the 1280 px / JPEG / no-EXIF contract', async () => {
    const { ctx } = setup({ width: 3000, height: 4000 }, { base64: 'data:image/jpeg;base64,QUJD', width: 960, height: 1280 });
    const r = await capturePhoto('camera');
    expect(r).toEqual({ ok: true, image: { uri: 'data:image/jpeg;base64,QUJD', base64: 'QUJD', width: 960, height: 1280 } });
    expect(ctx.resize).toHaveBeenCalledWith({ height: 1280 });
    expect(picker.launchCameraAsync).toHaveBeenCalledWith(expect.objectContaining({ exif: false, mediaTypes: ['images'] }));
  });

  it('does not resize a photo already within 1280 px', async () => {
    const { ctx } = setup({ width: 800, height: 600 }, { base64: 'QUJD', width: 800, height: 600 });
    await capturePhoto('library');
    expect(ctx.resize).not.toHaveBeenCalled();
  });

  it('falls back to the rendered image size when the save result has none', async () => {
    setup({ width: 800, height: 600 }, { base64: 'QUJD' }, { width: 800, height: 600 });
    const r = await capturePhoto('camera');
    expect(r).toEqual({ ok: true, image: { uri: 'data:image/jpeg;base64,QUJD', base64: 'QUJD', width: 800, height: 600 } });
  });

  it('leaves the size out when it is unknown or invalid (the UI then uses the image onLoad size)', async () => {
    setup({ width: 800, height: 600 }, { base64: 'QUJD', width: 0, height: Number.NaN });
    const r = await capturePhoto('camera');
    expect(r).toEqual({ ok: true, image: { uri: 'data:image/jpeg;base64,QUJD', base64: 'QUJD' } });
    expect(r.ok && 'width' in r.image).toBe(false);
  });

  it('removes the temporary files and fails cleanly when nothing was encoded', async () => {
    setup({ width: 800, height: 600 }, { width: 800, height: 600 });
    expect(await capturePhoto('camera')).toEqual({ ok: false, reason: 'failed' });
    expect(mockDiscard).toHaveBeenCalledWith('file:///photo.jpg');
    expect(mockDiscard).toHaveBeenCalledWith('file:///out.jpg');
  });
});
