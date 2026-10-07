import { calculatePortion, defaultMealType, MEAL_TYPES } from '@form/domain';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { FoodPicker } from '@/components/eat/FoodPicker';
import { PortionEditor, type PortionChoice } from '@/components/eat/PortionEditor';
import { AppText, Badge, Button, Card, Field, IconButton, InlineMessage, Row, Screen, Segmented, StateView } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { dayTitle, entryBadge, MEAL_LABEL, mealTotals, MEALS, portionLabel } from '@/lib/eat';
import { useAddMeal } from '@/lib/queries';
import type { FoodItem, MealType } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

interface Ingredient {
  key: string;
  food: FoodItem;
  choice: PortionChoice;
}

type Step = { kind: 'list' } | { kind: 'pick' } | { kind: 'weigh'; food: FoodItem } | { kind: 'edit'; key: string };

const MAX_INGREDIENTS = 20;

/**
 * Weigh a meal: add each ingredient with its own weight (or serving), see the meal total, log them
 * together once. The server recomputes everything and logs all ingredients or none.
 */
export default function WeighMeal() {
  const params = useLocalSearchParams<{ date?: string; meal?: string }>();
  const today = localDateKey();
  const date = params.date ?? today;
  const [meal, setMeal] = useState<MealType>((MEAL_TYPES as readonly string[]).includes(params.meal ?? '') ? (params.meal as MealType) : defaultMealType(new Date().getHours()));
  const [name, setName] = useState('');
  const [items, setItems] = useState<Ingredient[]>([]);
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [error, setError] = useState<string | null>(null);
  // One id per meal, kept across retries: the meal can only be logged once.
  const [clientMealId] = useState(uuid);
  const addMeal = useAddMeal();

  const back = <Button label="Back to meal" variant="ghost" onPress={() => setStep({ kind: 'list' })} />;

  if (step.kind === 'pick') {
    return (
      <Screen title="Add ingredient" subtitle={`${MEAL_LABEL[meal]} · ${dayTitle(date, today)}`}>
        <Stack.Screen options={{ title: 'Weigh a meal' }} />
        <FoodPicker label="Search ingredient" autoFocus onPick={(food) => setStep({ kind: 'weigh', food })} />
        {back}
      </Screen>
    );
  }
  if (step.kind === 'weigh' || step.kind === 'edit') {
    const editing = step.kind === 'edit' ? items.find((i) => i.key === step.key) : undefined;
    const food = editing?.food ?? (step.kind === 'weigh' ? step.food : undefined);
    if (!food) return null;
    return (
      <Screen title={editing ? 'Edit ingredient' : 'Weigh ingredient'} subtitle={`${MEAL_LABEL[meal]} · ${dayTitle(date, today)}`}>
        <Stack.Screen options={{ title: 'Weigh a meal' }} />
        <PortionEditor
          food={food}
          initial={
            editing?.choice ?? {
              unit: food.basis === 'ml' ? 'ml' : 'g',
              quantity: 100,
              amountMethod: 'measured',
              mealType: meal,
            }
          }
          submitLabel={editing ? 'Update ingredient' : 'Add to meal'}
          hideMeal
          onSubmit={(choice) => {
            setItems((list) => (editing ? list.map((i) => (i.key === editing.key ? { ...i, choice } : i)) : [...list, { key: uuid(), food, choice }]));
            setStep({ kind: 'list' });
          }}
        />
        {back}
      </Screen>
    );
  }

  const totals = mealTotals(items);
  const measured = items.filter((i) => i.choice.amountMethod === 'measured').length;
  const log = () => {
    setError(null);
    addMeal.mutate(
      {
        clientMealId,
        localDate: date,
        mealType: meal,
        mealName: name.trim() || null,
        items: items.map((i) => ({
          food: {
            foodId: i.food.id,
            quantity: i.choice.quantity,
            unit: i.choice.unit,
            servingId: i.choice.servingId,
          },
          amountMethod: i.choice.amountMethod,
          ...(i.choice.weightSource ? { weightSource: i.choice.weightSource } : {}),
        })),
      },
      {
        onSuccess: () => router.back(),
        onError: (e) => setError(e.kind === 'network' ? 'Not saved — no connection. Try again; it won’t be logged twice.' : e.message),
      },
    );
  };

  return (
    <Screen title="Weigh a meal" subtitle={`${MEAL_LABEL[meal]} · ${dayTitle(date, today)}`}>
      <Stack.Screen options={{ title: 'Weigh a meal' }} />
      {items.length === 0 ? (
        <Card>
          <StateView kind="empty" compact title="Add each ingredient" message="Weigh each food (or pick a serving) and FORM adds up the meal. Weighed amounts are logged as MEASURED." />
        </Card>
      ) : (
        <Card style={{ gap: 2, paddingVertical: space.sm }}>
          {items.map((i) => {
            const c = calculatePortion(i.food, {
              quantity: i.choice.quantity,
              unit: i.choice.unit,
              servingId: i.choice.servingId,
            });
            const badge = entryBadge({
              source: i.food.origin,
              amountMethod: i.choice.amountMethod,
            });
            return (
              <Row key={i.key} style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${i.food.name}, ${c.display.kcal} calories. Edit`}
                  onPress={() => setStep({ kind: 'edit', key: i.key })}
                  style={{ flex: 1, gap: 2 }}>
                  <Row gap={space.sm}>
                    <AppText variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {i.food.name}
                    </AppText>
                    <Badge label={badge.label} tone={badge.tone} />
                  </Row>
                  <AppText variant="caption" color={colors.textMuted}>
                    {portionLabel({
                      quantity: i.choice.quantity,
                      unit: i.choice.unit,
                      servingLabel: c.portion.servingLabel,
                    })}{' '}
                    · {c.display.kcal} kcal
                  </AppText>
                </Pressable>
                <IconButton icon="close" label={`Remove ${i.food.name}`} onPress={() => setItems((list) => list.filter((x) => x.key !== i.key))} />
              </Row>
            );
          })}
        </Card>
      )}
      <Button label="Add ingredient" icon="add" variant="secondary" disabled={items.length >= MAX_INGREDIENTS} onPress={() => setStep({ kind: 'pick' })} />

      {items.length > 0 ? (
        <Card style={{ gap: space.md }}>
          <View style={styles.total} accessible accessibilityLabel={`Meal total ${totals.kcal} calories`}>
            <AppText variant="label" color={colors.textMuted}>
              Meal total
            </AppText>
            <AppText variant="display">
              {items.some((i) => i.choice.amountMethod === 'estimated') ? '≈ ' : ''}
              {totals.kcal} kcal
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              P {totals.proteinG} g · C {totals.carbsG} g · F {totals.fatG} g · {measured} of {items.length} measured
            </AppText>
          </View>
          <Field label="Name this meal (optional)" value={name} onChangeText={setName} maxLength={60} placeholder="e.g. Chicken rice bowl" />
          <Segmented label="Meal" options={MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] }))} value={meal} onChange={setMeal} />
          {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
          <Button label={`Log meal (${items.length} ${items.length === 1 ? 'ingredient' : 'ingredients'})`} icon="checkmark" loading={addMeal.isPending} onPress={log} />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: space.xs,
  },
  total: {
    gap: 2,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.wash,
  },
});
