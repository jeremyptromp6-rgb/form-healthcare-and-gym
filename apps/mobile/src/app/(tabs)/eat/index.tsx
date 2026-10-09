import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { EatDayView } from '@/components/eat/EatDayView';
import { ErrorState, InlineMessage, Screen, StateView } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { dayNavigation, dayTitle } from '@/lib/eat';
import { useFeature } from '@/lib/features';
import { useAddWater, useNutritionDay, useRefetchOnFocus } from '@/lib/queries';

/** Eat: the day's calories, macros and water against targets, meal by meal. */
export default function Eat() {
  const today = localDateKey();
  const [date, setDate] = useState(today);
  const day = useNutritionDay(date, today);
  const foodScan = useFeature('food_scan');
  const planner = useFeature('meal_planner');
  const addWater = useAddWater();
  const [scanInfo, setScanInfo] = useState(false);
  const [waterError, setWaterError] = useState<string | null>(null);
  useRefetchOnFocus(day.refetch);
  useRefetchOnFocus(foodScan.recheck);
  const nav = dayNavigation(date, today);

  return (
    <Screen title="Eat" subtitle="Nutrition" refreshing={day.isRefetching} onRefresh={day.refetch}>
      {day.isPending ? <StateView kind="loading" /> : null}
      {day.isError && !day.data ? <ErrorState error={day.error} onRetry={day.refetch} /> : null}
      {waterError ? <InlineMessage tone="danger">{waterError}</InlineMessage> : null}
      {day.data ? (
        <EatDayView
          day={day.data}
          title={dayTitle(date, today)}
          onPrev={nav.prev ? () => setDate(nav.prev!) : null}
          onNext={nav.next ? () => setDate(nav.next!) : null}
          onAdd={(meal) => router.push(`/eat/add?meal=${meal}&date=${date}` as Href)}
          onOpenLog={(log) => router.push(`/eat/log/${log.id}?date=${log.localDate}` as Href)}
          onAddWater={
            nav.isToday
              ? (ml) => {
                  setWaterError(null);
                  // A fresh id per tap: a retried request is one drink, two taps are two.
                  addWater.mutate({ ml, clientLogId: uuid() }, { onError: (e) => setWaterError(e.kind === 'network' ? "Couldn't add water — check your connection." : e.message) });
                }
              : undefined
          }
          addingWater={addWater.isPending}
          onScan={async () => {
            if (foodScan.available) return router.push(`/eat/scan?date=${date}` as Href);
            // The cached answer may be stale (scanning switched on since, or the server was asleep): ask again first.
            if (await foodScan.recheck()) return router.push(`/eat/scan?date=${date}` as Href);
            setScanInfo(true);
          }}
          scanAvailable={foodScan.available}
          scanUnknown={foodScan.unknown}
          scanChecking={foodScan.checking}
          onWeighMeal={() => router.push(`/eat/meal?date=${date}` as Href)}
          onScanBarcode={() => router.push('/eat/barcode' as Href)}
          planning={
            planner.available
              ? { onOpenPlan: () => router.push('/eat/plan' as Href), onOpenRecipes: () => router.push('/eat/recipes' as Href), onOpenGrocery: () => router.push('/eat/grocery' as Href) }
              : null
          }
          showScanInfo={scanInfo}
          onSetUpProfile={() => router.navigate('/profile' as Href)}
        />
      ) : null}
    </Screen>
  );
}
