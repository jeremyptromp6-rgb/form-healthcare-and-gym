import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, ChipGroup, ChoiceCard, Field, InlineMessage, Row, Segmented, TagInput, type IconName } from '@/components/ui';
import { toggle, toggleDiet, validateBodyForm, validateTrainingForm } from '@/lib/profileForm';
import { usePatchPreferences, usePatchProfile, useUpdateSettings } from '@/lib/queries';
import type { Experience, Me, PrimaryGoal, ProfileOptions, Sex, TrainingLocation } from '@/lib/types';
import { heightInputToCm, heightToInput, weightInputToKg, weightToInput, type Units } from '@/lib/units';
import { colors, space } from '@/theme/tokens';

/**
 * Profile section editors. Onboarding and Profile use the same components, so a section
 * always validates and saves the same way wherever it is edited.
 */

export interface SectionProps {
  me: Me;
  catalog: ProfileOptions;
  submitLabel: string;
  onSaved: () => void;
}

export const GOAL_ICONS: Record<PrimaryGoal, IconName> = {
  build_muscle: 'barbell',
  get_stronger: 'trophy',
  lose_fat: 'flame',
  get_lean: 'body',
  improve_fitness: 'pulse',
  improve_health: 'heart',
};

const EXPERIENCE_ICONS: Record<Experience, IconName> = { beginner: 'leaf', intermediate: 'trending-up', advanced: 'flash' };

function SaveError({ message }: { message: string | null }) {
  return message ? <InlineMessage tone="danger">{message}</InlineMessage> : null;
}

const apiMessage = (e: { kind: string; message: string }) => (e.kind === 'network' ? "Couldn't save. Check your connection and try again." : e.message);

// ---- Goal ---------------------------------------------------------------------------

export function GoalSection({ me, catalog, submitLabel, onSaved }: SectionProps) {
  const save = usePatchProfile();
  const [goal, setGoal] = useState<PrimaryGoal | null>(me.profile?.primaryGoal ?? null);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!goal) return setError('Choose the goal that matters most right now.');
    if (goal === me.profile?.primaryGoal) return onSaved();
    save.mutate({ primaryGoal: goal }, { onSuccess: onSaved, onError: (e) => setError(apiMessage(e)) });
  };
  return (
    <View style={{ gap: space.md }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Primary goal" style={{ gap: space.sm }}>
        {catalog.goals.map((g) => (
          <ChoiceCard key={g.key} title={g.label} description={g.description} icon={GOAL_ICONS[g.key]} selected={goal === g.key} onPress={() => setGoal(g.key)} />
        ))}
      </View>
      {me.profile?.onboardingCompletedAt && goal !== me.profile.primaryGoal ? (
        <InlineMessage tone="info">A new goal shapes your plan from today. Your past workouts, targets and XP stay as they were.</InlineMessage>
      ) : null}
      <SaveError message={error} />
      <Button label={submitLabel} onPress={submit} loading={save.isPending} disabled={!goal} />
    </View>
  );
}

// ---- About you ------------------------------------------------------------------------

export function BodySection({ me, catalog, submitLabel, onSaved }: SectionProps) {
  const save = usePatchProfile();
  const settings = useUpdateSettings();
  const p = me.profile;
  const [units, setUnits] = useState<Units>(me.settings.units);
  const [name, setName] = useState(p?.displayName ?? '');
  const [sex, setSex] = useState<Sex | null>(p?.sex ?? null);
  const [age, setAge] = useState(p?.ageYears != null ? String(p.ageYears) : '');
  const [height, setHeight] = useState(heightToInput(p?.heightCm ?? null, units));
  const [weight, setWeight] = useState(weightToInput(p?.weightKg ?? null, units));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);

  const switchUnits = (next: Units) => {
    // Re-express what's typed in the new units so nothing is lost when switching.
    const h = heightInputToCm(height, units);
    const w = weightInputToKg(weight, units);
    setHeight(Number.isFinite(h) ? heightToInput(h, next) : { cm: '', ft: '', inches: '' });
    setWeight(Number.isFinite(w) ? weightToInput(w, next) : '');
    setUnits(next);
    settings.mutate({ units: next });
  };

  const submit = () => {
    const r = validateBodyForm({ sex, age, height, weight }, units, catalog.limits);
    setErrors(r.errors);
    if (!r.ok || !r.value) return;
    const displayName = name.trim() || null;
    save.mutate({ ...r.value, displayName }, { onSuccess: onSaved, onError: (e) => setError(apiMessage(e)) });
  };

  return (
    <View style={{ gap: space.md }}>
      <Field label="Name (optional)" value={name} onChangeText={setName} placeholder="What should FORM call you?" maxLength={catalog.limits.displayNameLength} autoComplete="name" />
      <Segmented
        label="Units"
        options={[
          { value: 'metric', label: 'kg · cm' },
          { value: 'imperial', label: 'lb · ft/in' },
        ]}
        value={units}
        onChange={switchUnits}
      />
      <Segmented
        label="Sex (used only for energy estimates)"
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
          { value: 'unspecified', label: 'Prefer not' },
        ]}
        value={(sex ?? '') as Sex}
        onChange={setSex}
      />
      {errors.sex ? <AppText variant="caption" color={colors.danger}>{errors.sex}</AppText> : null}
      <Field label="Age" value={age} onChangeText={setAge} keyboardType="number-pad" placeholder="30" error={errors.age} />
      {units === 'metric' ? (
        <Field label="Height (cm)" value={height.cm ?? ''} onChangeText={(cm) => setHeight({ ...height, cm })} keyboardType="decimal-pad" placeholder="175" error={errors.height} />
      ) : (
        <View style={{ gap: space.xs }}>
          <Row gap={space.md}>
            <Field label="Height (ft)" value={height.ft ?? ''} onChangeText={(ft) => setHeight({ ...height, ft })} keyboardType="number-pad" placeholder="5" style={{ flex: 1 }} />
            <Field label="Height (in)" value={height.inches ?? ''} onChangeText={(inches) => setHeight({ ...height, inches })} keyboardType="number-pad" placeholder="9" style={{ flex: 1 }} />
          </Row>
          {errors.height ? <AppText variant="caption" color={colors.danger}>{errors.height}</AppText> : null}
        </View>
      )}
      <Field
        label={units === 'metric' ? 'Weight (kg)' : 'Weight (lb)'}
        value={weight}
        onChangeText={setWeight}
        keyboardType="decimal-pad"
        placeholder={units === 'metric' ? '70' : '155'}
        error={errors.weight}
        hint="Your starting point for weight history. Private to you."
      />
      <SaveError message={error} />
      <Button label={submitLabel} onPress={submit} loading={save.isPending} />
    </View>
  );
}

// ---- Training -------------------------------------------------------------------------

export function TrainingSection({ me, catalog, submitLabel, onSaved }: SectionProps) {
  const save = usePatchProfile();
  const p = me.profile;
  const [experience, setExperience] = useState<Experience | null>(p?.experience ?? null);
  const [days, setDays] = useState<number | null>(p?.trainingDaysPerWeek ?? null);
  const [location, setLocation] = useState<TrainingLocation | null>(p?.trainingLocation ?? null);
  const [equipment, setEquipment] = useState<string[]>(p?.equipment ?? []);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const { min, max } = catalog.limits.trainingDaysPerWeek;

  const chooseLocation = (loc: TrainingLocation) => {
    setLocation(loc);
    // Pre-fill a sensible kit list the first time; never overwrite the user's own choices.
    if (equipment.length === 0) setEquipment(catalog.defaultEquipment[loc]);
  };

  const submit = () => {
    const r = validateTrainingForm({ experience, days, location, equipment });
    setErrors(r.errors);
    if (!r.ok) return;
    save.mutate(
      { experience: experience!, trainingDaysPerWeek: days!, trainingLocation: location!, equipment },
      { onSuccess: onSaved, onError: (e) => setError(apiMessage(e)) },
    );
  };

  return (
    <View style={{ gap: space.lg }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Experience" style={{ gap: space.sm }}>
        <AppText variant="label" color={colors.textMuted}>
          Experience
        </AppText>
        {catalog.experienceLevels.map((x) => (
          <ChoiceCard key={x.key} title={x.label} description={x.description} icon={EXPERIENCE_ICONS[x.key]} selected={experience === x.key} onPress={() => setExperience(x.key)} />
        ))}
        {errors.experience ? <AppText variant="caption" color={colors.danger}>{errors.experience}</AppText> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Segmented
          label="Days per week you can train"
          options={Array.from({ length: max - min + 1 }, (_, i) => ({ value: String(min + i), label: String(min + i) }))}
          value={days === null ? '' : String(days)}
          onChange={(v) => setDays(Number(v))}
        />
        {days === 7 ? <InlineMessage tone="info">Rest days are where you get stronger. FORM will build in recovery, and XP stops after 2 hours a day.</InlineMessage> : null}
        {errors.days ? <AppText variant="caption" color={colors.danger}>{errors.days}</AppText> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Segmented label="Where you train" options={catalog.trainingLocations.map((l) => ({ value: l.key, label: l.label }))} value={(location ?? '') as TrainingLocation} onChange={chooseLocation} />
        {errors.location ? <AppText variant="caption" color={colors.danger}>{errors.location}</AppText> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <ChipGroup label="Equipment you can use" options={catalog.equipment} selected={equipment} onToggle={(k) => setEquipment(toggle(equipment, k))} />
        {errors.equipment ? <AppText variant="caption" color={colors.danger}>{errors.equipment}</AppText> : null}
      </View>

      <SaveError message={error} />
      <Button label={submitLabel} onPress={submit} loading={save.isPending} />
    </View>
  );
}

// ---- Nutrition: diet, allergies (hard), dislikes (soft) --------------------------------

export function NutritionSection({ me, catalog, submitLabel, onSaved }: SectionProps) {
  const save = usePatchPreferences();
  const n = me.preferences;
  const [diet, setDiet] = useState<string[]>(n?.dietaryPreferences ?? []);
  const [allergens, setAllergens] = useState<string[]>(n?.allergens ?? []);
  const [customAllergies, setCustomAllergies] = useState<string[]>(n?.customAllergies ?? []);
  const [dislikes, setDislikes] = useState<string[]>(n?.dislikedFoods ?? []);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<string[]>([]);
  const restrictions = catalog.dietaryPreferences.filter((d) => d.kind === 'restriction');
  const styles = catalog.dietaryPreferences.filter((d) => d.kind === 'style');

  const submit = () => {
    setError(null);
    save.mutate(
      { dietaryPreferences: diet, allergens, customAllergies, dislikedFoods: dislikes },
      {
        onSuccess: (res) => {
          if (res.movedToAllergies.length) {
            setMoved(res.movedToAllergies);
            setDislikes(res.preferences.dislikedFoods);
          } else onSaved();
        },
        onError: (e) => setError(apiMessage(e)),
      },
    );
  };

  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <AppText variant="heading" header>
          Diet
        </AppText>
        <ChipGroup label="Rules I follow" options={restrictions} selected={diet} onToggle={(k) => setDiet(toggleDiet(diet, k, catalog.exclusiveDietPatterns))} />
        <ChipGroup label="Styles I like" options={styles} selected={diet} onToggle={(k) => setDiet(toggle(diet, k))} />
      </Card>

      <Card style={{ gap: space.md, borderColor: 'rgba(255,93,110,0.35)' }}>
        <AppText variant="heading" header>
          Allergies
        </AppText>
        <AppText variant="caption" color={colors.textMuted}>
          FORM will never suggest foods containing these. It can&apos;t detect cross-contamination, so always check labels.
        </AppText>
        <ChipGroup options={catalog.allergens} selected={allergens} onToggle={(k) => setAllergens(toggle(allergens, k))} tone="danger" />
        <TagInput
          label="Other allergies"
          items={customAllergies}
          onChange={setCustomAllergies}
          placeholder="e.g. kiwi"
          max={catalog.limits.customAllergyMax}
          maxLength={catalog.limits.foodItemLength}
          tone="danger"
        />
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="heading" header>
          Dislikes
        </AppText>
        <AppText variant="caption" color={colors.textMuted}>
          Not an allergy — just not for you. FORM will suggest these less often.
        </AppText>
        <TagInput label="Foods you dislike" items={dislikes} onChange={setDislikes} placeholder="e.g. olives" max={catalog.limits.foodListMax} maxLength={catalog.limits.foodItemLength} />
      </Card>

      {moved.length ? (
        <InlineMessage tone="info">
          {`${moved.join(', ')} ${moved.length === 1 ? 'is' : 'are'} on your allergy list, so ${moved.length === 1 ? "it's" : "they're"} treated as an allergy, not a dislike.`}
        </InlineMessage>
      ) : null}
      <SaveError message={error} />
      {moved.length ? (
        <Button label={submitLabel} onPress={onSaved} />
      ) : (
        <Button label={submitLabel} onPress={submit} loading={save.isPending} accessibilityHint="No selections is fine — it means no restrictions" />
      )}
    </View>
  );
}

// ---- Food habits ----------------------------------------------------------------------

export function HabitsSection({ me, catalog, submitLabel, onSaved }: SectionProps) {
  const save = usePatchPreferences();
  const [cooking, setCooking] = useState<string | null>(me.preferences?.cookingTime ?? null);
  const [budget, setBudget] = useState<string | null>(me.preferences?.foodBudget ?? null);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!cooking || !budget) return setError('Choose a cooking time and a budget.');
    save.mutate({ cookingTime: cooking, foodBudget: budget }, { onSuccess: onSaved, onError: (e) => setError(apiMessage(e)) });
  };
  return (
    <View style={{ gap: space.lg }}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Cooking time per meal" style={{ gap: space.sm }}>
        <AppText variant="label" color={colors.textMuted}>
          Time to cook a typical meal
        </AppText>
        {catalog.cookingTimes.map((c) => (
          <ChoiceCard key={c.key} title={c.label} selected={cooking === c.key} onPress={() => setCooking(c.key)} />
        ))}
      </View>
      <Segmented label="Food budget" options={catalog.foodBudgets.map((b) => ({ value: b.key, label: b.label }))} value={budget ?? ''} onChange={setBudget} />
      <SaveError message={error} />
      <Button label={submitLabel} onPress={submit} loading={save.isPending} />
    </View>
  );
}
