import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ManualFoodForm } from '@/components/eat/ManualFoodForm';
import { PortionEditor } from '@/components/eat/PortionEditor';
import { Provenance } from '@/components/eat/Provenance';
import { Button, ErrorState, InlineMessage, Row, Screen, StateView } from '@/components/ui';
import { localDateKey } from '@/lib/dates';
import { dayTitle, MEAL_LABEL } from '@/lib/eat';
import { useDeleteFood, useFood, useNutritionDay, useUpdateFood } from '@/lib/queries';
import type { FoodItem, FoodLog } from '@/lib/types';

/** Edit or delete one entry. Catalog foods change by portion; manual entries by their numbers. */
export default function EditFoodLog() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const today = localDateKey();
  const day = useNutritionDay(date ?? today, today);
  const log = day.data?.logs.find((l) => l.id === id);

  if (day.isPending) return <Screen title="Edit entry"><StateView kind="loading" /></Screen>;
  if (day.isError && !day.data) return <Screen title="Edit entry"><ErrorState error={day.error} onRetry={day.refetch} /></Screen>;
  if (!log) {
    return (
      <Screen title="Edit entry">
        <StateView kind="empty" title="Entry not found" message="It may have been deleted." actionLabel="Back" onAction={() => router.back()} />
      </Screen>
    );
  }
  return <Editor log={log} today={today} />;
}

function Editor({ log, today }: { log: FoodLog; today: string }) {
  const update = useUpdateFood(log.id);
  const del = useDeleteFood();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fail = (e: { kind: string; message: string }) => setError(e.kind === 'network' ? 'Not saved — check your connection and try again.' : e.message);
  const subtitle = `${MEAL_LABEL[log.mealType]} · ${dayTitle(log.localDate, today)}`;

  return (
    <Screen title={log.name} subtitle={subtitle}>
      {log.source === 'scan_estimate' ? <InlineMessage tone="warning">This is a scan estimate. Editing the amount keeps it an estimate.</InlineMessage> : null}
      {log.source === 'scan_estimate' ? (
        <Button
          label="I weighed it — replace estimate"
          icon="scale-outline"
          variant="secondary"
          onPress={() =>
            router.push(
              `/eat/add?replaces=${log.id}&meal=${log.mealType}&date=${log.localDate}&name=${encodeURIComponent(log.name)}${log.foodId ? `&food=${encodeURIComponent(log.foodId)}` : ''}` as Href,
            )
          }
        />
      ) : null}
      <Provenance log={log} />
      {log.foodId || log.source === 'scan_estimate' ? (
        <FoodPortion log={log} busy={update.isPending} error={error} onSave={(c) => (setError(null), update.mutate(c, { onSuccess: () => router.back(), onError: fail }))} />
      ) : (
        <ManualFoodForm
          initial={{
            name: log.name,
            kcal: log.kcal,
            proteinG: log.proteinG,
            carbsG: log.carbsG,
            fatG: log.fatG,
            grams: log.unit === 'g' ? log.quantity : null,
            amountMethod: log.amountMethod,
            mealType: log.mealType,
          }}
          submitLabel="Save changes"
          busy={update.isPending}
          error={error}
          onSubmit={(m) => {
            setError(null);
            update.mutate(
              {
                name: m.name,
                kcal: m.kcal,
                proteinG: m.proteinG,
                carbsG: m.carbsG,
                fatG: m.fatG,
                mealType: m.mealType,
                amountMethod: m.amountMethod,
                ...(m.grams !== null ? { quantity: m.grams, unit: 'g' as const } : {}),
              },
              { onSuccess: () => router.back(), onError: fail },
            );
          }}
        />
      )}
      {confirming ? (
        <Row>
          <Button label="Keep it" variant="secondary" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
          <Button
            label="Delete"
            variant="danger"
            loading={del.isPending}
            onPress={() =>
              del.mutate(log.id, {
                onSuccess: () => router.back(),
                onError: fail,
              })
            }
            style={{ flex: 1 }}
          />
        </Row>
      ) : (
        <Button label="Delete entry" variant="danger" icon="trash-outline" onPress={() => setConfirming(true)} />
      )}
    </Screen>
  );
}

function FoodPortion({ log, busy, error, onSave }: { log: FoodLog; busy: boolean; error: string | null; onSave: (c: Parameters<ReturnType<typeof useUpdateFood>['mutate']>[0]) => void }) {
  const food = useFood(log.foodId ?? '', !!log.foodId);
  if (log.foodId && food.isPending) return <StateView kind="loading" compact />;
  const scan = log.source === 'scan_estimate';
  // The catalog food may be gone (a deleted user food): edit against the entry's own snapshot.
  const item: FoodItem = food.data?.food ?? snapshotFood(log);
  return (
    <PortionEditor
      food={item}
      initial={{
        quantity: log.quantity ?? undefined,
        unit: log.unit ?? undefined,
        servingId: log.servingId,
        amountMethod: log.amountMethod,
        mealType: log.mealType,
        weightSource: log.measurement.weightSource ?? undefined,
      }}
      submitLabel="Save changes"
      busy={busy}
      error={error}
      lockEstimated={scan}
      sourceLabel={scan ? 'Scan estimate' : undefined}
      onSubmit={(c) =>
        onSave({
          quantity: c.quantity,
          unit: c.unit,
          servingId: c.servingId,
          amountMethod: c.amountMethod,
          mealType: c.mealType,
          ...(c.weightSource ? { weightSource: c.weightSource } : {}),
        })
      }
    />
  );
}

function snapshotFood(log: FoodLog): FoodItem {
  const amount = log.amount ?? 100;
  const per = (v: number) => (v / amount) * 100;
  return {
    id: log.foodId ?? log.id,
    name: log.name,
    brand: log.brand,
    basis: log.amountUnit ?? 'g',
    // The logged per-100 snapshot when there is one (exact); otherwise derived from the entry.
    per100: log.basis?.per100 ?? {
      kcal: per(log.kcal),
      proteinG: per(log.proteinG),
      carbsG: per(log.carbsG),
      fatG: per(log.fatG),
    },
    servings:
      log.servingId && log.quantity
        ? [
            {
              id: log.servingId,
              label: log.servingLabel ?? 'serving',
              amount: amount / log.quantity,
              kind: log.unit === 'piece' || log.unit === 'item' ? log.unit : 'serving',
            },
          ]
        : [],
    ...(log.measurement.densityGPerMl ? { gramsPerMl: log.measurement.densityGPerMl } : {}),
    origin: log.source === 'verified_database' ? 'verified_database' : 'user_food',
  };
}
