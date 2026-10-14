import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Me, ProfileOptions } from '@/lib/types';
import { FocusSection } from './FocusSection';

const mockMutate = jest.fn();
jest.mock('@/lib/queries', () => ({ usePatchProfile: () => ({ mutate: mockMutate, isPending: false }) }));

const catalog = {
  focusAreas: [
    { key: 'full_body', label: 'Full body', description: 'A balanced mix.', group: 'broad' },
    { key: 'upper_body', label: 'Upper body', description: 'Chest, back, shoulders and arms.', group: 'broad' },
    { key: 'chest', label: 'Chest', description: 'Pressing.', group: 'specific' },
    { key: 'back', label: 'Back', description: 'Pulling.', group: 'specific' },
    { key: 'arms', label: 'Arms', description: 'Biceps and triceps.', group: 'specific' },
    { key: 'core', label: 'Core', description: 'Abs.', group: 'specific' },
  ],
  limits: { focusAreasMax: 3 },
} as unknown as ProfileOptions;

const me = (focusAreas?: string[] | null) => ({ profile: { focusAreas } }) as unknown as Me;
const tile = (name: string) => screen.getByRole('checkbox', { name });

beforeEach(() => jest.clearAllMocks());

describe('FocusSection', () => {
  it('lets you pick up to three areas and saves them', async () => {
    const onSaved = jest.fn();
    await render(<FocusSection me={me(null)} catalog={catalog} submitLabel="Continue" onSaved={onSaved} />);
    await fireEvent.press(tile('Chest'));
    await fireEvent.press(tile('Back'));
    await fireEvent.press(tile('Arms'));
    expect(screen.getByText(/3 of 3 chosen/)).toBeTruthy();
    // At the limit a fourth is disabled and ignored.
    expect(tile('Core').props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    await fireEvent.press(tile('Core'));
    expect(tile('Core').props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(mockMutate).toHaveBeenCalledWith({ focusAreas: ['chest', 'back', 'arms'] }, expect.any(Object));
  });

  it('keeps full body on its own', async () => {
    await render(<FocusSection me={me(null)} catalog={catalog} submitLabel="Continue" onSaved={jest.fn()} />);
    await fireEvent.press(tile('Chest'));
    await fireEvent.press(tile('Full body'));
    expect(tile('Full body').props.accessibilityState).toMatchObject({ checked: true });
    expect(tile('Chest').props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(tile('Back'));
    expect(tile('Full body').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('can be skipped in onboarding without saving anything', async () => {
    const onSaved = jest.fn();
    await render(<FocusSection me={me(null)} catalog={catalog} submitLabel="Continue" onSaved={onSaved} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip for now' }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('starts from the saved choice and clearing it falls back to full body', async () => {
    await render(<FocusSection me={me(['chest'])} catalog={catalog} submitLabel="Save" onSaved={jest.fn()} />);
    expect(tile('Chest').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(tile('Chest'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(mockMutate).toHaveBeenCalledWith({ focusAreas: ['full_body'] }, expect.any(Object));
  });
});
