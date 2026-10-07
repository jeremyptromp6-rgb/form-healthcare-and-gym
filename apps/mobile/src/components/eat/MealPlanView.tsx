import Ionicons from '@expo/vector-icons/Ionicons';
import { SERVING_STEPS } from '@form/domain';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card, IconButton, InlineMessage, ProgressBar, Row } from '@/components/ui';
import { MealArt } from '@/components/art/MealArt';
import { MEAL_LABEL, MEALS } from '@/lib/eat';
import type { MealPlanView as Plan, PlannedMealView } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

export interface MealPlanViewProps {
  plan: Plan;
  today: string;
  date: string;
  onSelectDate: (date: string) => void;
  onOpenRecipe: (recipeId: string) => void;
  onMarkEaten: (meal: PlannedMealView) => void;
  onUnmark: (meal: PlannedMealView) => void;
  onSwap: (meal: PlannedMealView) => void;
  onServings: (meal: PlannedMealView, servings: number) => void;
  onRemove: (meal: PlannedMealView) => void;
  onAddMeal: (date: string) => void;
  onRepeatDay?: (date: string) => void;
  /** The meal an action is running for (its buttons show busy). */
  busyMealId?: string | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

const step = (s: number, dir: 1 | -1): number | null => {
  const steps = SERVING_STEPS as readonly number[];
  const i = steps.indexOf(s);
  const j = (i === -1 ? steps.findIndex((x) => x > s) : i) + dir;
  return j >= 0 && j < steps.length ? steps[j]! : null;
};

/**
 * A meal plan, one day at a time: what's planned, what's actually been eaten, and how the day adds
 * up against the targets. Planned meals count as food only once marked eaten. Pure view.
 */
export function MealPlanView(p: MealPlanViewProps) {
  const { plan } = p;
  const totals = plan.totalsByDate[p.date] ?? { planned: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, eaten: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, meals: 0 };
  const meals = plan.meals.filter((m) => m.date === p.date);

  return (
    <View style={{ gap: space.lg }}>
      {plan.dates.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityRole="tablist">
          {plan.dates.map((d) => {
            const on = d === p.date;
            return (
              <Pressable key={d} accessibilityRole="tab" accessibilityLabel={dayLabel(d, p.today)} accessibilityState={{ selected: on }} aria-selected={on} onPress={() => p.onSelectDate(d)} style={[styles.day, on && styles.dayOn]}>
                <AppText variant="label" color={on ? colors.text : colors.textMuted}>
                  {dayLabel(d, p.today)}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <Card style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <AppText variant="heading" header>
            {dayLabel(p.date, p.today) === 'Today' ? "Today's plan" : `Plan for ${dayLabel(p.date, p.today)}`}
          </AppText>
          <AppText variant="label" color={colors.textMuted}>
            {fmt(totals.planned.kcal)} / {fmt(plan.targets.kcal)} kcal
          </AppText>
        </Row>
        <ProgressBar value={totals.eaten.kcal / plan.targets.kcal} height={6} label="Eaten of today's target" />
        <AppText variant="caption" color={colors.textMuted}>
          {totals.eaten.kcal > 0 ? `${fmt(totals.eaten.kcal)} kcal eaten so far` : 'Nothing marked eaten yet'} · {Math.round(totals.planned.proteinG)} g protein planned
        </AppText>
      </Card>

      {plan.warnings.map((w) => (
        <InlineMessage key={w} tone="info">
          {w}
        </InlineMessage>
      ))}

      {meals.length === 0 ? (
        <Card>
          <AppText variant="caption" color={colors.textMuted}>
            No meals planned for this day.
          </AppText>
        </Card>
      ) : null}

      {MEALS.map((slot) =>
        meals
          .filter((m) => m.slot === slot)
          .map((m) => <MealCard key={m.id} meal={m} p={p} />),
      )}

      <Row gap={space.sm}>
        <Button label="Add a meal" icon="add" variant="secondary" onPress={() => p.onAddMeal(p.date)} style={{ flex: 1 }} />
        {p.onRepeatDay && plan.dates.length > 1 && meals.length > 0 ? (
          <Button label="Repeat this day" icon="copy-outline" variant="secondary" onPress={() => p.onRepeatDay!(p.date)} style={{ flex: 1 }} />
        ) : null}
      </Row>
      <AppText variant="caption" color={colors.textFaint}>
        Planned meals aren’t counted as food until you mark them eaten. Portions are recipe servings — estimates unless you weigh them.
      </AppText>
    </View>
  );
}

function MealCard({ meal: m, p }: { meal: PlannedMealView; p: MealPlanViewProps }) {
  const eaten = m.status === 'eaten';
  const busy = p.busyMealId === m.id;
  const down = step(m.servings, -1);
  const up = step(m.servings, 1);
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="label" color={colors.textMuted}>
          {MEAL_LABEL[m.slot]}
        </AppText>
        {eaten ? <Badge label="Eaten" tone="primary" icon="checkmark" /> : <Badge label="Planned" />}
      </Row>
      <Pressable accessibilityRole="button" accessibilityLabel={`${m.title}. Open recipe`} onPress={() => p.onOpenRecipe(m.recipeId)} style={{ gap: 2 }}>
        <Row gap={space.md}>
          <MealArt kind={m.slot} size={34} />
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            {m.title}
          </AppText>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          {m.nutrients.kcal} kcal · {Math.round(m.nutrients.proteinG)} g protein{m.totalMinutes ? ` · ${m.totalMinutes} min` : ''}
        </AppText>
      </Pressable>
      {eaten ? (
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="caption" color={colors.textMuted}>
            Logged to today’s food · {m.servings} {m.servings === 1 ? 'serving' : 'servings'}
          </AppText>
          <Button label="Undo" variant="ghost" onPress={() => p.onUnmark(m)} loading={busy} />
        </Row>
      ) : (
        <>
          <Row gap={space.sm}>
            <IconButton icon="remove" label={`Fewer servings of ${m.title}`} onPress={() => down !== null && p.onServings(m, down)} color={down !== null ? colors.text : colors.border} />
            <AppText variant="bodyStrong" accessibilityLabel={`${m.servings} servings`} style={{ minWidth: 64, textAlign: 'center' }}>
              {m.servings} {m.servings === 1 ? 'serving' : 'servings'}
            </AppText>
            <IconButton icon="add" label={`More servings of ${m.title}`} onPress={() => up !== null && p.onServings(m, up)} color={up !== null ? colors.text : colors.border} />
            <View style={{ flex: 1 }} />
            <IconButton icon="swap-horizontal" label={`Swap ${m.title}`} onPress={() => p.onSwap(m)} color={colors.text} />
            <IconButton icon="trash-outline" label={`Remove ${m.title}`} onPress={() => p.onRemove(m)} />
          </Row>
          {m.canMarkEaten ? <Button label="Mark eaten" icon="checkmark" onPress={() => p.onMarkEaten(m)} loading={busy} /> : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  day: { minHeight: 40, paddingHorizontal: space.lg, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.card },
  dayOn: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
});
