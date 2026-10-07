import { useState } from 'react';
import { AppText, Button, Card, Field, InlineMessage, Row, Segmented } from '@/components/ui';
import { MEAL_LABEL, MEALS, parseAmount } from '@/lib/eat';
import type { AmountMethod, MealType } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

export interface ManualFood {
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  grams: number | null;
  amountMethod: AmountMethod;
  mealType: MealType;
}

/**
 * Quick add: calories and macros typed in by hand (a restaurant meal, a label you're holding).
 * "Measured" needs the weight; without one, the entry is an estimate or label numbers.
 */
export function ManualFoodForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
}: {
  initial?: Partial<ManualFood>;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (food: ManualFood) => void;
}) {
  const s = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  const [name, setName] = useState(initial?.name ?? '');
  const [kcal, setKcal] = useState(s(initial?.kcal));
  const [p, setP] = useState(s(initial?.proteinG));
  const [c, setC] = useState(s(initial?.carbsG));
  const [f, setF] = useState(s(initial?.fatG));
  const [grams, setGrams] = useState(s(initial?.grams));
  const [method, setMethod] = useState<AmountMethod>(initial?.amountMethod ?? 'estimated');
  const [meal, setMeal] = useState<MealType>(initial?.mealType ?? 'snack');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    setLocalError(null);
    if (!name.trim()) return setLocalError('Give this food a name.');
    const [k, pr, cb, ft] = [kcal, p, c, f].map((v) => (v.trim() === '' ? 0 : parseAmount(v)));
    if ([k, pr, cb, ft].some((v) => !Number.isFinite(v!) || v! < 0)) return setLocalError('Calories and macros must be zero or more.');
    const g = grams.trim() === '' ? null : parseAmount(grams);
    if (g !== null && (!Number.isFinite(g) || g <= 0)) return setLocalError('Weight must be a positive number.');
    if (method === 'measured' && g === null) return setLocalError('Enter the weight from your scale, or choose Label or Estimate.');
    onSubmit({ name: name.trim(), kcal: k!, proteinG: pr!, carbsG: cb!, fatG: ft!, grams: g, amountMethod: method, mealType: meal });
  };

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="heading" header>
        Quick add
      </AppText>
      <Field label="Food" value={name} onChangeText={setName} placeholder="e.g. Chicken curry (restaurant)" />
      <Row gap={space.md}>
        <Field label="Calories" value={kcal} onChangeText={setKcal} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
        <Field label="Weight g" value={grams} onChangeText={setGrams} keyboardType="decimal-pad" placeholder="Optional" style={{ flex: 1 }} />
      </Row>
      <Row gap={space.md}>
        <Field label="Protein g" value={p} onChangeText={setP} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
        <Field label="Carbs g" value={c} onChangeText={setC} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
        <Field label="Fat g" value={f} onChangeText={setF} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
      </Row>
      <Segmented
        label="Where are these numbers from?"
        options={[
          { value: 'estimated', label: 'Estimate' },
          { value: 'label', label: 'Label' },
          { value: 'measured', label: 'Measured' },
        ]}
        value={method}
        onChange={setMethod}
      />
      <Segmented label="Meal" options={MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] }))} value={meal} onChange={setMeal} />
      <AppText variant="caption" color={colors.textFaint}>
        Tip: searching the food database is more accurate than typing numbers.
      </AppText>
      {localError || error ? <InlineMessage tone="danger">{localError ?? error}</InlineMessage> : null}
      <Button label={submitLabel} icon="checkmark" onPress={submit} loading={busy} />
    </Card>
  );
}
