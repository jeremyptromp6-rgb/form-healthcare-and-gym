import { presentAmount, unitSymbol, type ScaleProvider } from '@form/domain';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card, Field, InlineMessage, Row, Segmented } from '@/components/ui';
import type { WeightSource } from '@/lib/api';
import { allowedMethods, defaultMethod, MEAL_LABEL, MEALS, METHOD_LABEL, previewPortion, readAmount, unitOptions, type UnitGroup, type UnitOption } from '@/lib/eat';
import { defaultScaleProvider } from '@/lib/scale';
import type { AmountMethod, FoodItem, FoodUnit, MealType } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import { ScalePanel } from './ScalePanel';

export interface PortionChoice {
  quantity: number;
  unit: FoodUnit;
  servingId: string | null;
  amountMethod: AmountMethod;
  mealType: MealType;
  /** Measured entries only: typed from a scale's display, or read from a connected scale. */
  weightSource?: WeightSource;
}

export interface PortionEditorProps {
  food: FoodItem;
  initial?: Partial<PortionChoice>;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (choice: PortionChoice) => void;
  /** Scan estimates stay estimates: only the "Estimate" method is offered. */
  lockEstimated?: boolean;
  /** Replacing a scan estimate: only amounts more reliable than an estimate (measured, label). */
  replacing?: boolean;
  /** Replaces the "Verified database / Your food" line. */
  sourceLabel?: string;
  /** The meal is chosen elsewhere (e.g. for a whole weighed meal). */
  hideMeal?: boolean;
  scale?: ScaleProvider;
}

const METHOD_HINT: Record<AmountMethod, string> = {
  measured: 'Read off a scale or measuring jug — counted as MEASURED.',
  label: 'From the package or a standard serving.',
  estimated: 'A guess — shown as an estimate.',
};

const GROUP_LABEL: Record<UnitGroup, string> = {
  weight: 'Weight',
  volume: 'Volume',
  serving: 'Servings',
};

const STEP: Partial<Record<FoodUnit, number>> = {
  g: 10,
  kg: 0.05,
  oz: 0.5,
  lb: 0.1,
  ml: 10,
  l: 0.1,
  fl_oz: 1,
  cup: 0.25,
  tbsp: 0.5,
  tsp: 0.5,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * How much, in what unit, and how you know. Weights (g, kg, oz, lb), volumes (ml, L, fl oz, cups,
 * spoons) and the food's own servings/pieces/items; decimals with "." or ",". The result is the
 * domain NutritionCalculator's, shown with how it was calculated; the server recomputes it.
 */
export function PortionEditor({ food, initial, submitLabel, busy, error, onSubmit, lockEstimated, replacing, sourceLabel, hideMeal, scale }: PortionEditorProps) {
  const options = unitOptions(food);
  const initialKey = initial?.servingId ? `serving:${initial.servingId}` : initial?.unit;
  const [option, setOption] = useState<UnitOption>(options.find((o) => o.key === initialKey) ?? options[0]!);
  const [text, setText] = useState(String(initial?.quantity ?? (option.group === 'serving' ? 1 : 100)));
  const methodsFor = (o: UnitOption): AmountMethod[] => {
    if (lockEstimated) return ['estimated'];
    const allowed = allowedMethods(o.unit, o.converted);
    return replacing ? allowed.filter((m) => m !== 'estimated') : allowed;
  };
  const pickMethod = (o: UnitOption, wanted?: AmountMethod): AmountMethod => {
    const ms = methodsFor(o);
    if (wanted && ms.includes(wanted)) return wanted;
    const d = defaultMethod(o.unit, o.converted);
    return ms.includes(d) ? d : ms[0]!;
  };
  const [method, setMethod] = useState<AmountMethod>(pickMethod(option, initial?.amountMethod));
  const [meal, setMeal] = useState<MealType>(initial?.mealType ?? 'snack');
  const [fromScale, setFromScale] = useState(initial?.weightSource === 'scale');
  const [scaleProvider] = useState(() => scale ?? defaultScaleProvider());

  const input = readAmount(text);
  const preview = input.ok ? previewPortion(food, input.value, option) : null;
  const inputError = !input.ok ? input.error : preview && !preview.ok ? preview.error : null;
  const methods = methodsFor(option);
  const canWeigh = options.some((o) => o.group === 'weight') && !lockEstimated;

  const pickUnit = (o: UnitOption) => {
    // Keep the same amount of food when switching units, where that's defined.
    if (preview?.ok) {
      const perUnit = previewPortion(food, 1, o);
      if (o.group === 'serving') setText('1');
      else if (perUnit.ok) setText(String(round2(preview.amount / perUnit.amount)));
    } else if (o.group === 'serving') setText('1');
    setOption(o);
    setMethod(pickMethod(o, method));
    setFromScale(false);
  };
  const type = (t: string) => {
    setText(t);
    setFromScale(false);
  };
  const step = (dir: number) => {
    const inc = STEP[option.unit] ?? 0.5;
    const base = input.ok ? input.value : 0;
    type(String(Math.max(inc, round2(base + dir * inc))));
  };
  const useScaleReading = (grams: number) => {
    const g = options.find((o) => o.unit === 'g')!;
    setOption(g);
    setText(String(grams));
    setMethod(pickMethod(g, 'measured'));
    setFromScale(true);
  };
  const submit = () => {
    if (!input.ok || !preview?.ok) return;
    onSubmit({
      quantity: input.value,
      unit: option.unit,
      servingId: option.servingId,
      amountMethod: method,
      mealType: meal,
      ...(method === 'measured' ? { weightSource: fromScale ? ('scale' as const) : ('typed' as const) } : {}),
    });
  };

  const groups = (['weight', 'volume', 'serving'] as const).filter((g) => options.some((o) => o.group === g));
  const unitWord = option.group === 'serving' ? (input.ok && input.value === 1 ? option.unit : `${option.unit}s`) : unitSymbol(option.unit, input.ok ? input.value : 2);

  return (
    <Card style={{ gap: space.lg }}>
      <View style={{ gap: 2 }}>
        <AppText variant="heading" header>
          {food.name}
        </AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {food.brand ? `${food.brand} · ` : ''}
          {sourceLabel ?? (food.origin === 'verified_database' ? 'Verified database' : 'Your food')} · {Math.round(food.per100.kcal)} kcal per 100 {food.basis}
        </AppText>
      </View>

      <View style={{ gap: space.sm }}>
        <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
          <Button label="−" variant="secondary" onPress={() => step(-1)} accessibilityHint="Decrease amount" style={{ width: 52 }} />
          <Field
            label={option.group === 'serving' ? `How many (${option.label})` : `Amount (${option.label})`}
            value={text}
            onChangeText={type}
            keyboardType="decimal-pad"
            inputMode="decimal"
            style={{ flex: 1 }}
            error={inputError ?? undefined}
          />
          <Button label="+" variant="secondary" onPress={() => step(1)} accessibilityHint="Increase amount" style={{ width: 52 }} />
        </Row>
        {groups.map((g) => (
          <View key={g} style={{ gap: space.xs }} accessibilityRole="radiogroup" accessibilityLabel={`${GROUP_LABEL[g]} units`}>
            <AppText variant="label" color={colors.textFaint}>
              {GROUP_LABEL[g]}
            </AppText>
            <View style={styles.chips}>
              {options
                .filter((o) => o.group === g)
                .map((o) => {
                  const on = o.key === option.key;
                  return (
                    <Pressable
                      key={o.key}
                      accessibilityRole="radio"
                      accessibilityLabel={o.label}
                      accessibilityState={{ checked: on }} aria-checked={on}
                      onPress={() => pickUnit(o)}
                      style={[styles.chip, on && styles.chipOn]}>
                      <AppText variant="caption" color={on ? colors.text : colors.textMuted}>
                        {o.label}
                      </AppText>
                    </Pressable>
                  );
                })}
            </View>
          </View>
        ))}
        {option.converted ? (
          <AppText variant="caption" color={colors.textFaint}>
            Cups and spoons convert to grams with the food’s typical density — handy, but not a measurement. Weigh it for MEASURED.
          </AppText>
        ) : null}
      </View>

      {canWeigh ? <ScalePanel provider={scaleProvider} onUse={useScaleReading} /> : null}

      <View style={{ gap: space.xs }}>
        {methods.length > 1 ? <Segmented label="How do you know the amount?" options={methods.map((m) => ({ value: m, label: METHOD_LABEL[m] }))} value={method} onChange={setMethod} /> : null}
        <AppText variant="caption" color={colors.textFaint}>
          {METHOD_HINT[method]}
          {method === 'measured' && fromScale ? ' Read from the scale.' : ''}
        </AppText>
      </View>

      {hideMeal ? null : <Segmented label="Meal" options={MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] }))} value={meal} onChange={setMeal} />}

      <View style={styles.result} accessible accessibilityLabel={preview?.ok ? `${method === 'estimated' ? 'About ' : ''}${preview.macros.kcal} calories, ${METHOD_LABEL[method]}` : 'No amount yet'}>
        {preview?.ok ? (
          <>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="display">
                {method === 'estimated' ? '≈ ' : ''}
                {preview.macros.kcal}
                <AppText variant="bodyStrong" color={colors.textMuted}>
                  {' '}
                  kcal
                </AppText>
              </AppText>
              <Badge
                label={method === 'measured' ? 'MEASURED' : method === 'label' ? 'LABEL' : 'ESTIMATED'}
                tone={method === 'measured' ? 'primary' : method === 'label' ? 'purple' : 'warning'}
                icon={method === 'measured' ? 'scale-outline' : undefined}
              />
            </Row>
            <AppText variant="caption" color={colors.textMuted}>
              P {preview.macros.proteinG} g · C {preview.macros.carbsG} g · F {preview.macros.fatG} g
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              {input.ok ? `${input.value} ${unitWord}` : ''}
              {option.group !== 'weight' || option.unit !== food.basis ? ` = ${presentAmount(preview.amount)} ${preview.amountUnit}` : ''}
              {` × ${Math.round(food.per100.kcal * 10) / 10} kcal/100 ${food.basis}`}
              {preview.portion.grams !== null && food.basis === 'ml' ? ` · ${presentAmount(preview.portion.grams)} g` : ''}
            </AppText>
          </>
        ) : (
          <AppText variant="caption" color={colors.textMuted}>
            Enter an amount to see calories and macros.
          </AppText>
        )}
      </View>

      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      <Button label={submitLabel} icon="checkmark" loading={busy} disabled={!preview?.ok} onPress={submit} />
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 40,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  result: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.wash,
    gap: 4,
  },
});
