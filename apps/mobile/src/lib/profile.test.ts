import { labelOf, toggle, toggleDiet, validateBodyForm, validateTrainingForm } from './profileForm';
import type { ProfileOptions } from './types';
import { cmToFtIn, formatHeight, formatWeight, ftInToCm, heightInputToCm, heightToInput, kgToLb, lbToKg, parseNumber, weightInputToKg, weightToInput } from './units';

const limits: ProfileOptions['limits'] = {
  ageYears: { min: 13, max: 100 },
  heightCm: { min: 120, max: 240 },
  weightKg: { min: 30, max: 300 },
  trainingDaysPerWeek: { min: 1, max: 7 },
  displayNameLength: 40,
  foodListMax: 30,
  customAllergyMax: 10,
  foodItemLength: 40,
};

describe('units', () => {
  it('converts kg ↔ lb exactly', () => {
    expect(kgToLb(1)).toBeCloseTo(2.20462, 5);
    expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 10);
  });

  it('converts cm ↔ ft/in with inch carry', () => {
    expect(cmToFtIn(180)).toEqual({ ft: 5, inches: 11 });
    expect(cmToFtIn(182.8)).toEqual({ ft: 6, inches: 0 }); // 71.97 in rounds to 72 → 6′0″, not 5′12″
    expect(ftInToCm(5, 9)).toBeCloseTo(175.26, 2);
  });

  it('formats in the chosen units', () => {
    expect(formatWeight(80, 'metric')).toBe('80 kg');
    expect(formatWeight(80, 'imperial')).toBe('176.4 lb');
    expect(formatHeight(180, 'metric')).toBe('180 cm');
    expect(formatHeight(180, 'imperial')).toBe('5′ 11″');
  });

  it('parses user input into stored metric values', () => {
    expect(weightInputToKg('176.4', 'imperial')).toBe(80.01);
    expect(weightInputToKg('80,5', 'metric')).toBe(80.5);
    expect(heightInputToCm({ ft: '5', inches: '9' }, 'imperial')).toBe(175.26);
    expect(heightInputToCm({ ft: '6', inches: '' }, 'imperial')).toBe(182.88);
    expect(heightInputToCm({ ft: '5', inches: '12' }, 'imperial')).toBeNaN();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
  });

  it('keeps whole imperial entries exact through storage (regression: 150 lb showed as 149.9 lb)', () => {
    expect(formatWeight(weightInputToKg('150', 'imperial'), 'imperial')).toBe('150 lb');
    expect(formatHeight(heightInputToCm({ ft: '5', inches: '8' }, 'imperial'), 'imperial')).toBe('5′ 8″');
  });

  it('round-trips stored values through the edit fields', () => {
    expect(weightInputToKg(weightToInput(81.6, 'imperial'), 'imperial')).toBeCloseTo(81.6, 1);
    expect(heightToInput(177.8, 'imperial')).toEqual({ cm: '177.8', ft: '5', inches: '10' });
    expect(weightToInput(null, 'metric')).toBe('');
  });
});

describe('body form validation', () => {
  const valid = { sex: 'female' as const, age: '27', height: { cm: '165' }, weight: '60' };

  it('accepts a valid metric entry', () => {
    expect(validateBodyForm(valid, 'metric', limits)).toEqual({ ok: true, errors: {}, value: { sex: 'female', ageYears: 27, heightCm: 165, weightKg: 60 } });
  });

  it('accepts imperial entry and stores metric', () => {
    const r = validateBodyForm({ ...valid, height: { ft: '5', inches: '5' }, weight: '132' }, 'imperial', limits);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ heightCm: 165.1, weightKg: 59.87 });
  });

  it('reports each problem with the limits in the user’s units', () => {
    const r = validateBodyForm({ sex: null, age: '12', height: { ft: '9' }, weight: '20' }, 'imperial', limits);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['age', 'height', 'sex', 'weight']);
    expect(r.errors.weight).toMatch(/lb/);
    expect(r.errors.height).toMatch(/′/);
  });

  it('rejects fractional ages', () => {
    expect(validateBodyForm({ ...valid, age: '27.5' }, 'metric', limits).errors.age).toBeDefined();
  });
});

describe('training form and choice helpers', () => {
  it('requires every training answer, including at least one piece of equipment', () => {
    expect(validateTrainingForm({ experience: null, days: null, location: null, equipment: [] }).errors).toEqual({
      experience: expect.any(String),
      days: expect.any(String),
      location: expect.any(String),
      equipment: expect.any(String),
    });
    expect(validateTrainingForm({ experience: 'beginner', days: 3, location: 'home', equipment: ['bodyweight'] }).ok).toBe(true);
  });

  it('keeps only one base diet when switching between vegan / vegetarian / pescatarian', () => {
    const exclusive = ['vegetarian', 'vegan', 'pescatarian'];
    expect(toggleDiet(['vegetarian', 'halal'], 'vegan', exclusive)).toEqual(['halal', 'vegan']);
    expect(toggleDiet(['vegan'], 'vegan', exclusive)).toEqual([]);
    expect(toggleDiet(['vegan'], 'high_protein', exclusive)).toEqual(['vegan', 'high_protein']);
  });

  it('toggles and labels', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
    expect(labelOf([{ key: 'gym', label: 'Gym' }], 'gym')).toBe('Gym');
    expect(labelOf([], null)).toBe('—');
  });
});
