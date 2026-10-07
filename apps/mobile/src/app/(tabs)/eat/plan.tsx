import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { dayLabel, MealPlanView } from '@/components/eat/MealPlanView';
import { AppText, Button, Card, ErrorState, HeroMedia, InlineMessage, Row, Screen, StateView } from '@/components/ui';
import { MealArt } from '@/components/art/MealArt';
import type { ApiError } from '@/lib/api';
import { localDateKey, uuid } from '@/lib/dates';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import { RestOfTodayView } from '@/components/pro/ProFeatureViews';
import { proFeatureOf, useProAccess, useRestOfToday } from '@/lib/pro';
import { useAlternatives, useCreatePlan, useCurrentPlan, useDeletePlan, usePlanAction, useRefetchOnFocus } from '@/lib/queries';
import type { MealPlanView as Plan, PlannedMealView } from '@/lib/types';
import { imagery } from '@/theme/imagery';
import { colors, radius, space } from '@/theme/tokens';

const message = (e: ApiError) => (e.kind === 'network' ? 'Not saved — check your connection and try again.' : e.message);

/** Meal planning: make a plan for today or the week, then eat, swap, resize, add or repeat meals. */
export default function MealPlanScreen() {
  const today = localDateKey();
  const current = useCurrentPlan();
  const create = useCreatePlan();
  // Only for the button label; the server decides whether a week plan is allowed.
  const weekPro = useProAccess('MEAL_PLANNER_ADVANCED').has;
  const [intent, setIntent] = useState(() => ({ day: uuid(), week: uuid() }));
  const [error, setError] = useState<ApiError | null>(null);
  useRefetchOnFocus(current.refetch);

  const make = (days: 1 | 7) => {
    setError(null);
    create.mutate({ clientPlanId: days === 1 ? intent.day : intent.week, days }, { onSuccess: () => setIntent({ day: uuid(), week: uuid() }), onError: setError });
  };

  if (current.isPending) return <Screen title="Meal plan"><StateView kind="loading" /></Screen>;
  if (current.isError && !current.data) return <Screen title="Meal plan"><ErrorState error={current.error} onRetry={current.refetch} /></Screen>;
  const plan = current.data?.plan ?? null;

  if (!plan) {
    return (
      <Screen title="Meal plan" subtitle="Eat">
        <HeroMedia
          image={imagery.nutrition}
          minHeight={240}
          art={<MealArt kind="dinner" size={120} style={{ position: 'absolute', top: 14, right: 10, opacity: 0.95 }} />}>
          <AppText variant="overline" color={colors.primary}>
            Plan ahead
          </AppText>
          <AppText variant="title" header>
            Meals that fit your day
          </AppText>
          <AppText variant="body" color={colors.textMuted}>
            Built from FORM’s recipes around your targets, allergies, diet and cooking time. You stay in charge — swap anything.
          </AppText>
        </HeroMedia>
        {error ? <PlanError error={error} /> : null}
        <Button label={weekPro ? "Plan this week" : "Plan this week · Pro"} iconRight="arrow-forward" onPress={() => make(7)} loading={create.isPending && create.variables?.days === 7} />
        <Button label="Just today" variant="secondary" onPress={() => make(1)} loading={create.isPending && create.variables?.days === 1} />
        <Row gap={space.sm}>
          <Button label="Browse recipes" variant="ghost" onPress={() => router.push('/eat/recipes' as Href)} style={{ flex: 1 }} />
          <Button label="Grocery list" variant="ghost" onPress={() => router.push('/eat/grocery' as Href)} style={{ flex: 1 }} />
        </Row>
        <RestOfTodayCard />
      </Screen>
    );
  }
  return <PlanEditor plan={plan} today={today} onNew={make} creating={create.isPending} createError={error} />;
}

function PlanError({ error }: { error: ApiError }) {
  const pro = proFeatureOf(error);
  if (pro) return <ProUpsellFor feature={pro} />;
  if (error.code === 'targets_required') {
    return (
      <Pressable accessibilityRole="link" onPress={() => router.navigate('/profile' as Href)}>
        <InlineMessage tone="info">Add your body details in Profile first, so plans fit your energy needs safely →</InlineMessage>
      </Pressable>
    );
  }
  return <InlineMessage tone="danger">{message(error)}</InlineMessage>;
}

function PlanEditor({ plan, today, onNew, creating, createError }: { plan: Plan; today: string; onNew: (days: 1 | 7) => void; creating: boolean; createError: ApiError | null }) {
  const action = usePlanAction();
  const del = useDeletePlan();
  const [chosenDate, setDate] = useState<string | null>(null);
  const date = chosenDate && plan.dates.includes(chosenDate) ? chosenDate : plan.dates.includes(today) ? today : plan.dates[0]!;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<PlannedMealView | null>(null);
  const [repeatFrom, setRepeatFrom] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const run = (a: Parameters<typeof action.mutate>[0], mealId: string | null, after?: () => void) => {
    setError(null);
    setBusy(mealId);
    action.mutate(a, { onSuccess: () => after?.(), onError: (e) => setError(message(e)), onSettled: () => setBusy(null) });
  };

  if (swapFor) return <SwapPanel plan={plan} meal={swapFor} busy={action.isPending} error={error} onPick={(recipeId, servings) => run({ kind: 'swap', planId: plan.id, mealId: swapFor.id, recipeId, servings }, swapFor.id, () => setSwapFor(null))} onCancel={() => setSwapFor(null)} />;
  if (repeatFrom) return <RepeatPanel plan={plan} today={today} from={repeatFrom} busy={action.isPending} error={error} onRepeat={(toDates) => run({ kind: 'repeat', planId: plan.id, date: repeatFrom, toDates }, null, () => setRepeatFrom(null))} onCancel={() => setRepeatFrom(null)} />;

  return (
    <Screen title="Meal plan" subtitle={plan.days === 7 ? 'This week' : 'Today'}>
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      <MealPlanView
        plan={plan}
        today={today}
        date={date}
        onSelectDate={setDate}
        onOpenRecipe={(id) => router.push(`/eat/recipe/${id}` as Href)}
        onMarkEaten={(m) => run({ kind: 'eaten', planId: plan.id, mealId: m.id, clientLogId: uuid() }, m.id)}
        onUnmark={(m) => run({ kind: 'uneaten', planId: plan.id, mealId: m.id }, m.id)}
        onSwap={setSwapFor}
        onServings={(m, servings) => run({ kind: 'servings', planId: plan.id, mealId: m.id, servings }, m.id)}
        onRemove={(m) => run({ kind: 'remove', planId: plan.id, mealId: m.id }, m.id)}
        onAddMeal={(d) => router.push(`/eat/recipes?planId=${plan.id}&date=${d}` as Href)}
        onRepeatDay={setRepeatFrom}
        busyMealId={busy}
      />
      <Button label="Grocery list" icon="cart-outline" variant="secondary" onPress={() => router.push('/eat/grocery' as Href)} />
      {createError ? <PlanError error={createError} /> : null}
      {replacing ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="bodyStrong">Start a new plan?</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            It replaces this one. Meals you’ve already marked eaten stay in your food log.
          </AppText>
          <Row gap={space.sm}>
            <Button label="This week" onPress={() => (onNew(7), setReplacing(false))} loading={creating} style={{ flex: 1 }} />
            <Button label="Just today" variant="secondary" onPress={() => (onNew(1), setReplacing(false))} style={{ flex: 1 }} />
          </Row>
          <Button label="Keep this plan" variant="ghost" onPress={() => setReplacing(false)} />
        </Card>
      ) : (
        <Row gap={space.sm}>
          <Button label="New plan" variant="ghost" onPress={() => setReplacing(true)} style={{ flex: 1 }} />
          <Button label="Discard plan" variant="ghost" onPress={() => del.mutate(plan.id, { onError: (e) => setError(message(e)) })} loading={del.isPending} style={{ flex: 1 }} />
        </Row>
      )}
    </Screen>
  );
}

function SwapPanel({ plan, meal, onPick, onCancel, busy, error }: { plan: Plan; meal: PlannedMealView; onPick: (recipeId: string, servings: number) => void; onCancel: () => void; busy: boolean; error: string | null }) {
  const alts = useAlternatives(plan.id, meal.id);
  return (
    <Screen title="Swap meal" subtitle={meal.title}>
      <AppText variant="body" color={colors.textMuted}>
        Similar in calories and protein, and suitable for your diet and allergies.
      </AppText>
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      {alts.isPending ? <StateView kind="loading" /> : null}
      {alts.isError ? <ErrorState error={alts.error} onRetry={alts.refetch} /> : null}
      {alts.data?.alternatives.length === 0 ? <StateView kind="empty" title="No close swaps" message="Nothing else fits this meal right now. Try changing the servings instead." /> : null}
      {alts.data?.alternatives.map((a) => (
        <Pressable key={a.recipeId} accessibilityRole="button" accessibilityLabel={`Swap to ${a.title}, ${a.display.kcal} calories`} onPress={() => !busy && onPick(a.recipeId, a.servings)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Card style={{ gap: 4 }}>
            <AppText variant="bodyStrong">{a.title}</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {a.display.kcal} kcal ({a.kcalDelta >= 0 ? '+' : ''}
              {a.kcalDelta}) · {Math.round(a.display.proteinG)} g protein ({a.proteinDelta >= 0 ? '+' : ''}
              {Math.round(a.proteinDelta)}) · {a.totalMinutes} min · {a.servings} {a.servings === 1 ? 'serving' : 'servings'}
            </AppText>
            {a.notes.map((n) => (
              <AppText key={n} variant="caption" color={colors.warning}>
                {n}
              </AppText>
            ))}
          </Card>
        </Pressable>
      ))}
      <Button label="Keep current meal" variant="ghost" onPress={onCancel} />
    </Screen>
  );
}

function RepeatPanel({ plan, today, from, onRepeat, onCancel, busy, error }: { plan: Plan; today: string; from: string; onRepeat: (toDates: string[]) => void; onCancel: () => void; busy: boolean; error: string | null }) {
  const [picked, setPicked] = useState<string[]>([]);
  const others = plan.dates.filter((d) => d !== from);
  return (
    <Screen title="Repeat a day" subtitle={dayLabel(from, today)}>
      <AppText variant="body" color={colors.textMuted}>
        Copy {dayLabel(from, today)}’s meals onto other days. Meals already eaten on those days are kept.
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="list">
        {others.map((d) => {
          const on = picked.includes(d);
          return (
            <Pressable
              key={d}
              accessibilityRole="checkbox"
              accessibilityLabel={dayLabel(d, today)}
              accessibilityState={{ checked: on }} aria-checked={on}
              onPress={() => setPicked((p) => (on ? p.filter((x) => x !== d) : [...p, d]))}
              style={{ minHeight: 44, paddingHorizontal: space.lg, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : colors.card }}>
              <AppText variant="label" color={on ? colors.text : colors.textMuted}>
                {dayLabel(d, today)}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      <Button label={picked.length ? `Repeat on ${picked.length} ${picked.length === 1 ? 'day' : 'days'}` : 'Choose days'} disabled={picked.length === 0} loading={busy} onPress={() => onRepeat(picked)} />
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Screen>
  );
}

/** FORM Pro: meals for the rest of today from what's left of today's targets. Asked for on tap; a 402 shows the upsell. */
function RestOfTodayCard() {
  const [open, setOpen] = useState(false);
  const q = useRestOfToday(open);
  const locked = proFeatureOf(q.error);
  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="heading">Plan the rest of today</AppText>
      <AppText variant="caption" color={colors.textMuted}>
        Meals sized to what&apos;s left of today&apos;s calories and protein, around your allergies, diet and saved recipes.
      </AppText>
      {!open ? <Button label="Suggest meals" variant="secondary" onPress={() => setOpen(true)} /> : null}
      {open && q.isPending ? <StateView kind="loading" compact /> : null}
      {locked ? <ProUpsellFor feature={locked} compact /> : null}
      {q.isError && !locked ? <ErrorState error={q.error} onRetry={q.refetch} compact /> : null}
      {q.data ? <RestOfTodayView suggestion={q.data.suggestion} onOpenRecipe={(id) => router.push(`/eat/recipe/${id}` as Href)} /> : null}
    </Card>
  );
}
