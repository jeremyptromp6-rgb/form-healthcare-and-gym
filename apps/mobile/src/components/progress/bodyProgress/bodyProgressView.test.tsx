import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ProgressPhoto } from '@/lib/progressPhotos';
import { BodyProgressView } from './BodyProgressView';
import { CompareView } from './CompareView';
import { DeleteAllPhotosControl } from './DeleteAllPhotos';

jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
  },
  Directory: class {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
    }
  },
  Paths: { document: 'file:///docs', cache: 'file:///cache' },
}));

const photo = (id: string, pose: ProgressPhoto['pose'], date: string, weightKg: number | null = null): ProgressPhoto => ({ id, pose, date, file: `${id}.jpg`, weightKg });
const PHOTOS = [photo('a', 'front', '2026-08-02', 84), photo('b', 'front', '2026-09-10', 82.5), photo('c', 'side', '2026-10-01'), photo('d', 'front', '2026-10-20', 81.2)];

async function renderHome(over: Partial<React.ComponentProps<typeof BodyProgressView>> = {}) {
  const props = { photos: PHOTOS, units: 'metric' as const, onCapture: jest.fn(), onCompare: jest.fn(), onDeleteOne: jest.fn().mockResolvedValue(undefined), onDeleteAll: jest.fn().mockResolvedValue(undefined), ...over };
  await render(<BodyProgressView {...props} />);
  return { props };
}

describe('Body progress home', () => {
  it('states the privacy promise and offers the two actions', async () => {
    const { props } = await renderHome();
    expect(screen.getByText('Your photos stay on this phone. FORM never uploads them.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Take a photo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Compare two photos' }));
    expect(props.onCapture).toHaveBeenCalledTimes(1);
    expect(props.onCompare).toHaveBeenCalledTimes(1);
  });

  it('shows the timeline by month, newest first, with date and weight under each photo', async () => {
    await renderHome();
    const months = screen.getAllByRole('header').map((h) => h.props.children);
    expect(months).toEqual(expect.arrayContaining(['October 2026', 'September 2026', 'August 2026']));
    expect(months.indexOf('October 2026')).toBeLessThan(months.indexOf('September 2026'));
    expect(screen.getByRole('button', { name: 'Front photo, 20 Oct 2026, 81.2 kg' })).toBeTruthy();
    expect(screen.getByText('81.2 kg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Side photo, 1 Oct 2026' })).toBeTruthy();
  });

  it('filters by pose', async () => {
    await renderHome();
    await fireEvent.press(screen.getByRole('radio', { name: 'Side' }));
    expect(screen.queryByRole('button', { name: /^Front photo/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Side photo/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Back' }));
    expect(screen.getByText('No back photos yet.')).toBeTruthy();
  });

  it('an empty timeline invites the first photo, and comparing is not offered yet', async () => {
    await renderHome({ photos: [] });
    expect(screen.getByText('No photos yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compare two photos' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete all progress photos' })).toBeNull();
  });

  it('deleting one photo asks first, then deletes only that photo', async () => {
    const { props } = await renderHome();
    await fireEvent.press(screen.getByRole('button', { name: 'Front photo, 20 Oct 2026, 81.2 kg' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete this photo' }));
    expect(props.onDeleteOne).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete photo' }));
    await waitFor(() => expect(props.onDeleteOne).toHaveBeenCalledWith('d'));
  });

  it('delete all is two steps and can be backed out of', async () => {
    const { props } = await renderHome();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete all progress photos' }));
    expect(screen.getByText('Delete 4 progress photos from this phone?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep them' }));
    expect(props.onDeleteAll).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete all progress photos' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(props.onDeleteAll).toHaveBeenCalledTimes(1));
  });
});

describe('Delete all control', () => {
  it('says so when the delete fails, and keeps the choice open', async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error('nope'));
    await render(<DeleteAllPhotosControl count={1} onConfirm={onConfirm} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete all progress photos' }));
    expect(screen.getByText('Delete 1 progress photo from this phone?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete forever' }));
    expect(await screen.findByText(/couldn.t be deleted/)).toBeTruthy();
  });

  it('renders nothing when there is nothing to delete', async () => {
    await render(<DeleteAllPhotosControl count={0} onConfirm={jest.fn()} />);
    expect(screen.toJSON()).toBeNull();
  });
});

describe('Compare', () => {
  it('needs two photos of one pose', async () => {
    await render(<CompareView photos={[photo('a', 'front', '2026-08-02'), photo('c', 'side', '2026-10-01')]} units="metric" />);
    expect(screen.getByText('Two photos needed')).toBeTruthy();
  });

  it('starts on the oldest against the newest, with dates and weights as labels', async () => {
    await render(<CompareView photos={PHOTOS} units="metric" />);
    expect(screen.getByText('2 Aug 2026 · 84 kg')).toBeTruthy();
    expect(screen.getByText('20 Oct 2026 · 81.2 kg')).toBeTruthy();
    expect(screen.getByRole('radio', { name: '2 Aug 2026', checked: true })).toBeTruthy();
  });

  it('the slider can be moved by a screen reader', async () => {
    await render(<CompareView photos={PHOTOS} units="metric" />);
    const handle = screen.getByTestId('compare-handle');
    expect(handle.props.accessibilityValue).toEqual({ text: '50 percent before' });
    await fireEvent(handle, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('compare-handle').props.accessibilityValue).toEqual({ text: '60 percent before' });
    await fireEvent(handle, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await fireEvent(handle, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByTestId('compare-handle').props.accessibilityValue).toEqual({ text: '40 percent before' });
  });

  it('switches to side by side and picks a different pair', async () => {
    await render(<CompareView photos={PHOTOS} units="metric" />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Side by side' }));
    expect(screen.queryByTestId('compare-handle')).toBeNull();
    expect(screen.getByLabelText('Before: Front photo, 2 Aug 2026, 84 kg')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('radio', { name: '10 Sep 2026' })[0]!);
    expect(screen.getByLabelText('Before: Front photo, 10 Sep 2026, 82.5 kg')).toBeTruthy();
  });
});
