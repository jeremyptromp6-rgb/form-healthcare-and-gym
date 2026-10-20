import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { discardTemp } from '@/lib/privateFiles';
import { prepareProgressPhoto } from '@/lib/progressPhotoImage';
import { addProgressPhoto, type ProgressPhoto } from '@/lib/progressPhotos';
import { CaptureView, GHOST_OPACITY } from './CaptureView';

const mockTake = jest.fn();
const mockRequest = jest.fn();
let mockPermission: { granted: boolean; canAskAgain: boolean } | null = { granted: true, canAskAgain: true };
jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { forwardRef, useEffect, useImperativeHandle } = require('react');
  return {
    useCameraPermissions: () => [mockPermission, mockRequest],
    CameraView: forwardRef(function MockCameraView(props: { onCameraReady?: () => void }, ref: unknown) {
      useImperativeHandle(ref, () => ({ takePictureAsync: (...a: unknown[]) => mockTake(...a) }));
      useEffect(() => props.onCameraReady?.(), [props]);
      return null;
    }),
  };
});
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
  },
  Directory: class {
    uri = 'dir';
  },
  Paths: { document: 'file:///docs', cache: 'file:///cache' },
}));
jest.mock('@/lib/privateFiles', () => ({ discardTemp: jest.fn() }));
jest.mock('@/lib/progressPhotoImage', () => ({ prepareProgressPhoto: jest.fn() }));
jest.mock('@/lib/progressPhotos', () => ({ ...jest.requireActual('@/lib/progressPhotos'), addProgressPhoto: jest.fn() }));

const mockPrepare = prepareProgressPhoto as jest.Mock;
const mockAdd = addProgressPhoto as jest.Mock;
const mockDiscard = discardTemp as jest.Mock;

const prev: ProgressPhoto = { id: 'p1', pose: 'front', date: '2026-09-10', file: 'p1.jpg', weightKg: 82 };

const view = (over: Partial<React.ComponentProps<typeof CaptureView>> = {}) => {
  const onDone = jest.fn();
  return { onDone, ui: <CaptureView photos={[prev]} date="2026-10-20" weightKg={81.2} onDone={onDone} {...over} /> };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = { granted: true, canAskAgain: true };
  mockTake.mockResolvedValue({ uri: 'file:///cache/shot.jpg', width: 3000, height: 4000 });
  mockPrepare.mockResolvedValue({ uri: 'file:///cache/small.jpg', width: 810, height: 1080 });
  mockAdd.mockResolvedValue({ id: 'new' });
});

describe('Capture: camera permission', () => {
  it('asks before using the camera, and says what happens to the photo', async () => {
    mockPermission = { granted: false, canAskAgain: true };
    await render(view().ui);
    expect(screen.getAllByText('Your photos stay on this phone. FORM never uploads them.').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockTake).not.toHaveBeenCalled();
  });

  it('when denied for good, points to Settings and offers no shutter', async () => {
    mockPermission = { granted: false, canAskAgain: false };
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(view().ui);
    expect(screen.getByText('Camera access is off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Settings' }));
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});

describe('Capture: ghost guide', () => {
  it('shows the last photo of the same pose faintly, and the switch turns it off', async () => {
    await render(view().ui);
    expect(screen.getByTestId('ghost-overlay', { includeHiddenElements: true }).props.style.opacity).toBe(GHOST_OPACITY);
    expect(GHOST_OPACITY).toBe(0.3);
    await fireEvent(screen.getByRole('switch', { name: 'Ghost guide' }), 'valueChange', false);
    expect(screen.queryByTestId('ghost-overlay', { includeHiddenElements: true })).toBeNull();
  });

  it('follows the chosen pose: no earlier side photo, no ghost', async () => {
    await render(view().ui);
    await fireEvent.press(screen.getByRole('radio', { name: 'Side' }));
    expect(screen.queryByTestId('ghost-overlay', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText(/No earlier side photo yet/)).toBeTruthy();
  });
});

describe('Capture: save and retake', () => {
  it('takes a photo, previews it, and Save stores the resized photo privately with the day and weight', async () => {
    const { onDone, ui } = view();
    await render(ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
    expect(mockTake).toHaveBeenCalledWith(expect.objectContaining({ exif: false }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved: Front photo, 20 Oct 2026/)).toBeTruthy();
    expect(mockPrepare).toHaveBeenCalledWith({ uri: 'file:///cache/shot.jpg', width: 3000, height: 4000 });
    expect(mockAdd).toHaveBeenCalledWith({ sourceUri: 'file:///cache/small.jpg', pose: 'front', date: '2026-10-20', weightKg: 81.2 });
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Retake throws the shot away and returns to the camera without saving', async () => {
    await render(view().ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Retake' }));
    expect(mockDiscard).toHaveBeenCalledWith('file:///cache/shot.jpg');
    expect(mockAdd).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeTruthy();
  });

  it('uses the chosen pose when saving', async () => {
    await render(view().ui);
    await fireEvent.press(screen.getByRole('radio', { name: 'Back' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved: Back photo/);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ pose: 'back' }));
  });

  it('a failed save says so and goes back to the camera', async () => {
    mockAdd.mockRejectedValue(new Error('disk full'));
    await render(view().ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/couldn.t be saved/)).toBeTruthy();
    expect(screen.queryByText(/^Saved:/)).toBeNull();
  });

  it('a camera that fails to shoot says so and stays live', async () => {
    mockTake.mockRejectedValue(new Error('busy'));
    await render(view().ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByText(/couldn.t take that photo/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy();
  });
});

describe('Capture: self-timer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const tick = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  };

  it('counts down three seconds, then takes the photo', async () => {
    await render(view().ui);
    await fireEvent(screen.getByRole('switch', { name: '3-second timer' }), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Start 3-second timer' }));
    expect(screen.getByText('Taking the photo in 3…')).toBeTruthy();
    await tick(1000);
    expect(screen.getByText('Taking the photo in 2…')).toBeTruthy();
    expect(mockTake).not.toHaveBeenCalled();
    await tick(1000);
    await tick(1000);
    expect(mockTake).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('can be cancelled before the shot', async () => {
    await render(view().ui);
    await fireEvent(screen.getByRole('switch', { name: '3-second timer' }), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Start 3-second timer' }));
    await tick(1000);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel timer' }));
    await tick(5000);
    expect(mockTake).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start 3-second timer' })).toBeTruthy();
  });
});
