import { defaultMealType, MEAL_TYPES } from '@form/domain';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { FoodPicker, FoodRow, FoodSearchResults } from '@/components/eat/FoodPicker';
import { ManualFoodForm } from '@/components/eat/ManualFoodForm';
import { PortionEditor, type PortionChoice } from '@/components/eat/PortionEditor';
import { AppText, Button, Card, ErrorState, Field, InlineMessage, Row, Screen, SectionHeader, StateView, Toggle } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { dayTitle, MEAL_LABEL } from '@/lib/eat';
import { useAddFood, useFood, useMyFoods, useRecentFoods } from '@/lib/queries';
import type { FoodItem, MealType, RecentFood } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

/** Add food: search the verified database and your foods, pick a portion, log. Or quick-add numbers. */
export default function AddFood() {
  // `replaces` (+ `food` when the scan matched one, `name` to search by): weigh and supersede a scan estimate.
  const params = useLocalSearchParams<{
    meal?: string;
    date?: string;
    replaces?: string;
    food?: string;
    name?: string;
  }>();
  const today = localDateKey();
  const date = params.date ?? today;
  const meal: MealType = (MEAL_TYPES as readonly string[]).includes(params.meal ?? '') ? (params.meal as MealType) : defaultMealType(new Date().getHours());

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{
    food: FoodItem;
    last?: RecentFood['last'];
  } | null>(null);
  const [quick, setQuick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per intended entry, kept across retries so a retried request can't log twice.
  const [clientLogId, setClientLogId] = useState(uuid);
  const add = useAddFood();

  const done = () => {
    setClientLogId(uuid());
    router.back();
  };
  const fail = (e: { kind: string; message: string }) => setError(e.kind === 'network' ? 'Not saved — no connection. Try again; it won’t be logged twice.' : e.message);

  const logPortion = (food: FoodItem, c: PortionChoice) => {
    setError(null);
    add.mutate(
      {
        clientLogId,
        localDate: date,
        mealType: c.mealType,
        amountMethod: c.amountMethod,
        ...(c.weightSource ? { weightSource: c.weightSource } : {}),
        food: {
          foodId: food.id,
          quantity: c.quantity,
          unit: c.unit,
          servingId: c.servingId,
        },
      },
      { onSuccess: done, onError: fail },
    );
  };

  const title = `${MEAL_LABEL[meal]} · ${dayTitle(date, today)}`;

  if (params.replaces) {
    return <ReplaceEstimate logId={params.replaces} foodId={params.food ?? null} name={params.name ?? ''} meal={meal} date={date} title={title} />;
  }

  if (selected) {
    return (
      <Screen title="Add food" subtitle={title}>
        <Stack.Screen options={{ title: 'Add food' }} />
        <PortionEditor
          food={selected.food}
          initial={{
            mealType: meal,
            ...(selected.last
              ? {
                  quantity: selected.last.quantity,
                  unit: selected.last.unit,
                  servingId: selected.last.servingId,
                  amountMethod: selected.last.amountMethod,
                }
              : {}),
          }}
          submitLabel="Log food"
          busy={add.isPending}
          error={error}
          onSubmit={(c) => logPortion(selected.food, c)}
        />
        <Button label="Back to search" variant="ghost" onPress={() => (setSelected(null), setError(null))} />
      </Screen>
    );
  }

  if (quick) {
    return (
      <Screen title="Add food" subtitle={title}>
        <ManualFoodForm
          initial={{ mealType: meal }}
          submitLabel="Log food"
          busy={add.isPending}
          error={error}
          onSubmit={(m) => {
            setError(null);
            add.mutate(
              {
                clientLogId,
                localDate: date,
                mealType: m.mealType,
                amountMethod: m.amountMethod,
                manual: {
                  name: m.name,
                  kcal: m.kcal,
                  proteinG: m.proteinG,
                  carbsG: m.carbsG,
                  fatG: m.fatG,
                  ...(m.grams !== null ? { quantity: m.grams, unit: 'g' as const } : {}),
                },
              },
              { onSuccess: done, onError: fail },
            );
          }}
        />
        <Button label="Back to search" variant="ghost" onPress={() => (setQuick(false), setError(null))} />
      </Screen>
    );
  }

  return (
    <Screen title="Add food" subtitle={title}>
      <Field label="Search foods" value={query} onChangeText={setQuery} placeholder="e.g. chicken breast, oats, banana" autoFocus autoCorrect={false} />
      {query.trim() ? <FoodSearchResults query={query} onPick={(food) => setSelected({ food })} /> : <Browse onPick={setSelected} />}
      <Row gap={space.sm}>
        <Button label="Quick add" icon="flash-outline" variant="secondary" onPress={() => setQuick(true)} style={{ flex: 1 }} />
        <Button label="New food" icon="add" variant="secondary" onPress={() => router.push('/eat/food/new' as Href)} style={{ flex: 1 }} />
      </Row>
      <Button label="Scan a barcode" icon="barcode-outline" variant="secondary" onPress={() => router.push('/eat/barcode' as Href)} />
    </Screen>
  );
}

/**
 * Scanner estimate → choose the food → weigh it → the measured entry supersedes the estimate (the
 * server removes the estimate in the same transaction). Keeping both is an explicit choice.
 */
function ReplaceEstimate({ logId, foodId, name, meal, date, title }: { logId: string; foodId: string | null; name: string; meal: MealType; date: string; title: string }) {
  const known = useFood(foodId ?? '', !!foodId);
  const [picked, setPicked] = useState<FoodItem | null>(null);
  const [choosing, setChoosing] = useState(!foodId);
  const [keepBoth, setKeepBoth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id for this replacement, kept across retries: it can only log (and supersede) once.
  const [clientLogId] = useState(uuid);
  const add = useAddFood();
  const food = picked ?? (choosing ? null : (known.data?.food ?? null));

  const submit = (f: FoodItem, c: PortionChoice) => {
    setError(null);
    add.mutate(
      {
        clientLogId,
        localDate: date,
        mealType: c.mealType,
        amountMethod: c.amountMethod,
        ...(c.weightSource ? { weightSource: c.weightSource } : {}),
        food: {
          foodId: f.id,
          quantity: c.quantity,
          unit: c.unit,
          servingId: c.servingId,
        },
        ...(keepBoth ? {} : { replacesLogId: logId }),
      },
      {
        onSuccess: () => router.back(),
        onError: (e) => setError(e.kind === 'network' ? 'Not saved — no connection. Try again; it won’t be logged twice.' : e.message),
      },
    );
  };

  return (
    <Screen title="Weigh it" subtitle={title}>
      <Stack.Screen options={{ title: 'Replace estimate' }} />
      <InlineMessage tone="info">{`Choose the food, weigh it and enter the weight. The measured entry replaces the scan estimate${name ? ` “${name}”` : ''}.`}</InlineMessage>
      {choosing && !picked ? <FoodPicker label="Which food was it?" initialQuery={name} onPick={(f) => (setPicked(f), setChoosing(false))} autoFocus /> : null}
      {!choosing && !picked && known.isPending ? <StateView kind="loading" /> : null}
      {!choosing && !picked && known.isError ? <ErrorState error={known.error} onRetry={known.refetch} /> : null}
      {food ? (
        <>
          <PortionEditor
            key={food.id}
            food={food}
            initial={{
              mealType: meal,
              unit: food.basis === 'ml' ? 'ml' : 'g',
              quantity: 100,
              amountMethod: 'measured',
            }}
            submitLabel={keepBoth ? 'Log weighed entry' : 'Replace with weighed entry'}
            busy={add.isPending}
            error={error}
            replacing={!keepBoth}
            onSubmit={(c) => submit(food, c)}
          />
          <Button label="Choose a different food" variant="ghost" onPress={() => (setPicked(null), setChoosing(true))} />
          <Toggle label="Keep the scan estimate too" description="Only if this is extra food — otherwise both would count." value={keepBoth} onChange={setKeepBoth} />
        </>
      ) : null}
    </Screen>
  );
}

function Browse({ onPick }: { onPick: (s: { food: FoodItem; last?: RecentFood['last'] }) => void }) {
  const recent = useRecentFoods();
  const mine = useMyFoods();
  return (
    <>
      <SectionHeader title="Recent" />
      <Card style={{ gap: 2, paddingVertical: space.sm }}>
        {recent.isError && !recent.data ? <ErrorState error={recent.error} onRetry={recent.refetch} compact /> : null}
        {recent.data?.recent.length === 0 ? (
          <AppText variant="caption" color={colors.textMuted} style={{ paddingVertical: space.sm }}>
            Foods you log show up here for one-tap logging.
          </AppText>
        ) : null}
        {recent.data?.recent.map((r) => (
          <FoodRow key={r.food.id} food={r.food} onPress={() => onPick({ food: r.food, last: r.last })} />
        ))}
      </Card>
      {mine.data && mine.data.foods.length > 0 ? (
        <>
          <SectionHeader title="My foods" />
          <Card style={{ gap: 2, paddingVertical: space.sm }}>
            {mine.data.foods.map((f) => (
              <FoodRow key={f.id} food={f} onPress={() => onPick({ food: f })} />
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}
