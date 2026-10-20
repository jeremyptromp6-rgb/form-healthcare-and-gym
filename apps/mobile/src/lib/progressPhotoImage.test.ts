import { ImageManipulator } from 'expo-image-manipulator';
import { discardTemp } from './privateFiles';
import { prepareProgressPhoto } from './progressPhotoImage';

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('./privateFiles', () => ({ discardTemp: jest.fn() }));

const manip = ImageManipulator as jest.Mocked<typeof ImageManipulator>;

function setup(saved: Record<string, unknown> = { uri: 'file:///out.jpg', width: 810, height: 1080 }) {
  const saveAsync = jest.fn().mockResolvedValue(saved);
  const ctx = { resize: jest.fn(), renderAsync: jest.fn().mockResolvedValue({ width: 1, height: 1, saveAsync }) };
  ctx.resize.mockReturnValue(ctx);
  manip.manipulate.mockReturnValue(ctx as never);
  return { ctx, saveAsync };
}

describe('prepareProgressPhoto', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resizes a portrait shot to 1080 px tall, saves a JPEG at 0.8 with no base64, and removes the camera file', async () => {
    const { ctx, saveAsync } = setup();
    await expect(prepareProgressPhoto({ uri: 'file:///cam.jpg', width: 3000, height: 4000 })).resolves.toEqual({ uri: 'file:///out.jpg', width: 810, height: 1080 });
    expect(ctx.resize).toHaveBeenCalledWith({ height: 1080 });
    expect(saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
    expect(discardTemp).toHaveBeenCalledWith('file:///cam.jpg');
  });

  it('resizes a landscape shot by width, and leaves a small one alone', async () => {
    const wide = setup();
    await prepareProgressPhoto({ uri: 'file:///cam.jpg', width: 4000, height: 3000 });
    expect(wide.ctx.resize).toHaveBeenCalledWith({ width: 1080 });
    const small = setup();
    await prepareProgressPhoto({ uri: 'file:///cam.jpg', width: 800, height: 600 });
    expect(small.ctx.resize).not.toHaveBeenCalled();
  });

  it('removes the camera file even when encoding fails', async () => {
    const { saveAsync } = setup();
    saveAsync.mockRejectedValue(new Error('encode'));
    await expect(prepareProgressPhoto({ uri: 'file:///cam.jpg', width: 3000, height: 4000 })).rejects.toThrow('encode');
    expect(discardTemp).toHaveBeenCalledWith('file:///cam.jpg');
  });
});
