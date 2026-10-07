import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChipGroup, ChoiceCard, TagInput } from '@/components/ui';
import type { Me, ProfileOptions } from '@/lib/types';
import { ProfileSummary } from './ProfileSummary';

const catalog = {
  goals: [
    { key: 'build_muscle', label: 'Build Muscle', description: '', energyGoal: 'gain' },
    { key: 'lose_fat', label: 'Lose Fat', description: '', energyGoal: 'lose' },
  ],
  experienceLevels: [{ key: 'beginner', label: 'Beginner', description: '' }],
  trainingLocations: [{ key: 'home', label: 'Home' }],
  equipment: [{ key: 'bodyweight', label: 'Bodyweight only' }],
  defaultEquipment: { home: ['bodyweight'], gym: [], both: [] },
  dietaryPreferences: [{ key: 'vegetarian', label: 'Vegetarian', kind: 'restriction' }],
  exclusiveDietPatterns: ['vegetarian'],
  allergens: [{ key: 'peanuts', label: 'Peanuts' }],
  cookingTimes: [{ key: 'under_15', label: 'Under 15 min', maxMinutes: 15 }],
  foodBudgets: [{ key: 'low', label: 'Budget-friendly' }],
  limits: { ageYears: { min: 13, max: 100 }, heightCm: { min: 120, max: 240 }, weightKg: { min: 30, max: 300 }, trainingDaysPerWeek: { min: 1, max: 7 }, displayNameLength: 40, foodListMax: 30, customAllergyMax: 10, foodItemLength: 40 },
} as ProfileOptions;

function me(overrides: Partial<Me> = {}): Me {
  return {
    user: { id: 'u', email: 'sam@example.com', createdAt: '' },
    profile: {
      displayName: 'Sam',
      primaryGoal: 'build_muscle',
      sex: 'female',
      ageYears: 27,
      heightCm: 165,
      weightKg: 60,
      experience: 'beginner',
      trainingDaysPerWeek: 3,
      trainingLocation: 'home',
      equipment: ['bodyweight'],
      activity: 'moderate',
      energyGoal: 'gain',
      onboardingCompletedAt: null,
    },
    preferences: { dietaryPreferences: ['vegetarian'], allergens: ['peanuts'], customAllergies: ['kiwi'], dislikedFoods: ['olives'], cookingTime: 'under_15', foodBudget: 'low' },
    targets: null,
    onboarding: { completed: false, remaining: [], nextStep: 'review' },
    settings: { units: 'metric', timezone: null, timezoneAuto: true, dateFormat: 'system', personalizedAdsConsent: false, analyticsConsent: false, aiCoachEnabled: true, aiCoachConsent: false, coachKeepHistory: true, foodScanConsent: false },
    hasPhoto: false,
    ...overrides,
  };
}

describe('choice controls', () => {
  it('ChoiceCard exposes single-choice radio semantics', async () => {
    const onPress = jest.fn();
    await render(<ChoiceCard title="Lose Fat" description="Lose fat steadily" selected={false} onPress={onPress} />);
    const radio = screen.getByRole('radio', { name: 'Lose Fat' });
    expect(radio.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(radio);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ChipGroup exposes multi-select checkbox semantics', async () => {
    const onToggle = jest.fn();
    await render(
      <ChipGroup
        options={[
          { key: 'peanuts', label: 'Peanuts' },
          { key: 'soy', label: 'Soy' },
        ]}
        selected={['peanuts']}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Peanuts' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('checkbox', { name: 'Soy' }).props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Soy' }));
    expect(onToggle).toHaveBeenCalledWith('soy');
  });

  it('TagInput adds, de-duplicates case-insensitively, enforces limits and removes', async () => {
    const onChange = jest.fn();
    await render(<TagInput label="Foods you dislike" items={['olives']} onChange={onChange} max={2} maxLength={10} />);
    const input = screen.getByLabelText('Foods you dislike');

    await fireEvent.changeText(input, 'OLIVES');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to Foods you dislike' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Already added.')).toBeTruthy();

    await fireEvent.changeText(input, 'a very long food name');
    await fireEvent(input, 'submitEditing');
    expect(screen.getByText('Keep each item under 10 characters.')).toBeTruthy();

    await fireEvent.changeText(input, '  tofu ');
    await fireEvent(input, 'submitEditing');
    expect(onChange).toHaveBeenLastCalledWith(['olives', 'tofu']);

    await fireEvent.press(screen.getByRole('button', { name: 'Remove olives' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('ProfileSummary', () => {
  it('shows allergies and dislikes as separate things', async () => {
    await render(<ProfileSummary me={me()} catalog={catalog} />);
    expect(screen.getByText('Allergies — never suggested')).toBeTruthy();
    expect(screen.getByText('Peanuts, kiwi')).toBeTruthy();
    expect(screen.getByText('Dislikes — suggested less')).toBeTruthy();
    expect(screen.getByText('olives')).toBeTruthy();
  });

  it('shows measurements in the user’s units', async () => {
    await render(<ProfileSummary me={me({ settings: { units: 'imperial', timezone: null, timezoneAuto: true, dateFormat: 'system', personalizedAdsConsent: false, analyticsConsent: false, aiCoachEnabled: true, aiCoachConsent: false, coachKeepHistory: true, foodScanConsent: false } })} catalog={catalog} />);
    expect(screen.getByText('132.3 lb')).toBeTruthy();
    expect(screen.getByText('5′ 5″')).toBeTruthy();
  });

  it('marks unanswered sections and offers edit links', async () => {
    const onEdit = jest.fn();
    await render(<ProfileSummary me={me({ onboarding: { completed: false, remaining: ['habits'], nextStep: 'habits' } })} catalog={catalog} onEdit={onEdit} />);
    expect(screen.getAllByText('TO DO')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Edit Food habits' }));
    expect(onEdit).toHaveBeenCalledWith('habits');
  });
});
