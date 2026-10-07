import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { defaultMealType } from '@form/domain';
import { AppText, Badge, Button, Card, GradientCard, IconButton, InlineMessage, MacroTile, ProgressRing, Row, Stat, StateView, type IconName } from '@/components/ui';
import { MealArt } from '@/components/art/MealArt';
import { dayHeadline, entryBadge, formatLiters, MEAL_LABEL, MEALS, portionLabel, proteinNudge } from '@/lib/eat';
import type { FoodLog, MealType, NutritionDay } from '@/lib/types';
import { colors, gradients, radius, space } from '@/theme/tokens';

export interface EatDayViewProps {
  day: NutritionDay;
  title: string;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onAdd: (meal: MealType) => void;
  onOpenLog: (log: FoodLog) => void;
  /** Quick-add water; only offered for today. */
  onAddWater?: (ml: number) => void;
  addingWater?: boolean;
  onScan: () => void;
  scanAvailable: boolean;
  /** Weigh several ingredients and log them as one meal. */
  onWeighMeal: () => void;
  /** Meal planning, recipes and the grocery list — shown when those features are live. */
  planning?: { onOpenPlan: () => void; onOpenRecipes: () => void; onOpenGrocery: () => void } | null;
  showScanInfo: boolean;
  onSetUpProfile: () => void;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/** The Eat dashboard: day totals vs targets, water, and the day's meals. Pure view. */
export function EatDayView(p: EatDayViewProps) {
  const { day } = p;
  const kcal = day.progress?.kcal;
  const protein = day.progress?.proteinG;
  // Only today gets a nudge — past days are history, not a to-do list.
  const nudge = p.onAddWater ? proteinNudge(day) : null;

  return (
    <View style={{ gap: space.lg }}>
      <Row style={styles.dayPill}>
        {p.onPrev ? <IconButton icon="chevron-back" label="Previous day" onPress={p.onPrev} color={colors.text} /> : <View style={{ width: 44 }} />}
        <AppText variant="heading" header accessibilityLabel={`Showing ${p.title}`}>
          {p.title}
        </AppText>
        {p.onNext ? <IconButton icon="chevron-forward" label="Next day" onPress={p.onNext} color={colors.text} /> : <View style={{ width: 44 }} />}
      </Row>

      <GradientCard colorsOverride={gradients.heroMedia} style={{ gap: space.md }}>
        <AppText variant="heading" header>
          {dayHeadline(day)}
        </AppText>
        <Row gap={space.lg}>
          <View style={{ flex: 1, gap: 2 }}>
            <Row gap={space.xs} style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
              <AppText variant="display" style={{ fontVariant: ['tabular-nums'] }}>
                {fmt(day.totals.kcal)}
              </AppText>
              <AppText variant="bodyStrong" color={colors.textMuted}>
                {kcal ? `/ ${fmt(kcal.target)} kcal` : 'kcal'}
              </AppText>
            </Row>
            {kcal ? (
              <AppText variant="label" color={kcal.over > 0 ? colors.warning : colors.textMuted}>
                {kcal.over > 0 ? `${fmt(kcal.over)} over` : `${fmt(kcal.remaining)} left`}
              </AppText>
            ) : null}
          </View>
          {kcal ? (
            <ProgressRing value={kcal.fraction} size={88} stroke={8} color={kcal.over > 0 ? colors.warning : colors.accent} label="Calories eaten of target">
              <Ionicons name="flame" size={24} color={kcal.over > 0 ? colors.warning : colors.accent} />
            </ProgressRing>
          ) : null}
        </Row>
        {day.progress ? (
          <Row gap={space.sm}>
            <MacroTile label="Protein" value={day.totals.proteinG} target={Math.round(day.progress.proteinG.target)} color={colors.protein} />
            <MacroTile label="Carbs" value={day.totals.carbsG} target={Math.round(day.progress.carbsG.target)} color={colors.carbs} />
            <MacroTile label="Fat" value={day.totals.fatG} target={Math.round(day.progress.fatG.target)} color={colors.fat} />
          </Row>
        ) : null}
        {day.totals.estimatedKcalShare > 0 ? (
          <InlineMessage tone="warning" icon="alert-circle-outline">
            {`About ${Math.round(day.totals.estimatedKcalShare * 100)}% of these calories are estimates, not measured amounts.`}
          </InlineMessage>
        ) : null}
        {day.totals.measuredKcalShare > 0 ? (
          <AppText variant="caption" color={colors.textFaint}>
            {`${Math.round(day.totals.measuredKcalShare * 100)}% measured on a scale.`}
          </AppText>
        ) : null}
        {!day.targets ? (
          <Pressable accessibilityRole="link" onPress={p.onSetUpProfile}>
            <InlineMessage tone="info">Add your body details in Profile to get personal calorie and macro targets →</InlineMessage>
          </Pressable>
        ) : null}
      </GradientCard>

      {/* With targets, protein sits with the other macros above; without, it gets its own tile. */}
      {protein ? null : (
        <Stat
          label="Protein"
          value={String(Math.round(day.totals.proteinG))}
          unit="g"
          icon="nutrition"
          tint={colors.protein}
          accessibilityLabel={`Protein: ${Math.round(day.totals.proteinG)} grams`}
        />
      )}
      <Card style={{ gap: space.md, backgroundColor: `${colors.water}12`, borderColor: `${colors.water}30` }}>
        <Row gap={space.lg}>
          <ProgressRing value={day.water.progress.fraction} size={72} stroke={7} color={colors.water}>
            <Ionicons name="water" size={24} color={colors.water} />
          </ProgressRing>
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Water: ${formatLiters(day.water.totalMl)} of ${formatLiters(day.water.targetMl)}`}>
            <AppText variant="label" color={colors.textMuted}>
              Water
            </AppText>
            <Row gap={4} style={{ alignItems: 'baseline' }}>
              <AppText variant="number">{formatLiters(day.water.totalMl)}</AppText>
              <AppText variant="bodyStrong" color={colors.textMuted}>
                / {formatLiters(day.water.targetMl)}
              </AppText>
            </Row>
            <AppText variant="caption" color={colors.textFaint}>
              {day.water.progress.fraction >= 1 ? 'Goal reached — nicely done.' : 'A glass at a time adds up.'}
            </AppText>
          </View>
        </Row>
        {p.onAddWater ? (
          <Row gap={space.sm}>
            <Button label="+250 ml" variant="secondary" icon="water-outline" onPress={() => p.onAddWater!(250)} loading={p.addingWater} style={{ flex: 1 }} />
            <Button label="+500 ml" variant="secondary" onPress={() => p.onAddWater!(500)} disabled={p.addingWater} style={{ flex: 1 }} />
          </Row>
        ) : null}
      </Card>

      {nudge ? (
        <Card variant="raised" style={{ gap: space.sm }}>
          <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
            <Ionicons name="nutrition-outline" size={20} color={colors.accent} />
            <AppText variant="bodyStrong" style={{ flex: 1 }}>
              {nudge}
            </AppText>
          </Row>
          <AppText variant="caption" color={colors.textMuted}>
            A protein-rich meal or snack that fits your diet would close the gap.
          </AppText>
          <Button label="Add food" iconRight="arrow-forward" onPress={() => p.onAdd(defaultMealType(new Date().getHours()))} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {MEALS.map((meal) => (
        <MealSection key={meal} meal={meal} day={day} onAdd={() => p.onAdd(meal)} onOpenLog={p.onOpenLog} />
      ))}

      {p.planning ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingVertical: 2 }}>
          <PlanCard title="Meal plan" body="Meals that fit your targets and diet" meal="dinner" tint={colors.primary} icon="calendar" onPress={p.planning.onOpenPlan} />
          <PlanCard title="Recipes" body="Simple recipes that suit you" meal="lunch" tint={colors.success} icon="book" onPress={p.planning.onOpenRecipes} />
          <PlanCard title="Grocery list" body="Everything your plan needs, by aisle" meal="breakfast" tint={colors.accent} icon="cart" onPress={p.planning.onOpenGrocery} />
        </ScrollView>
      ) : null}

      <Row gap={space.sm}>
        <Button label="Weigh a meal" icon="scale-outline" variant="secondary" onPress={p.onWeighMeal} style={{ flex: 1 }} />
        <Button label="Scan a meal" icon="camera-outline" variant="secondary" onPress={p.onScan} style={{ flex: 1 }} />
      </Row>
      {p.showScanInfo ? (
        <Card>
          {p.scanAvailable ? (
            <StateView kind="empty" compact title="Scanning gives an estimate" message="A photo can't weigh food. Scanned amounts are always marked as estimates." />
          ) : (
            <StateView kind="unavailable" compact title="Food scanning isn't available yet" message="Search the food database, add a food from its label, or weigh it for the most accurate numbers." />
          )}
        </Card>
      ) : null}
    </View>
  );
}

/** A big picture card for meal planning, recipes and groceries — like a programme you open. */
function PlanCard({ title, body, meal, tint, icon, onPress }: { title: string; body: string; meal: MealType; tint: string; icon: IconName; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${body}`} onPress={onPress} style={({ pressed }) => [styles.plan, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={[styles.planArt, { backgroundColor: `${tint}1A` }]}>
        <MealArt kind={meal} size={74} />
        <View style={[styles.planIcon, { backgroundColor: tint }]}>
          <Ionicons name={icon} size={14} color={colors.onPrimary} />
        </View>
      </View>
      <View style={{ padding: space.md, gap: 2 }}>
        <AppText variant="heading" style={{ fontSize: 17 }}>
          {title}
        </AppText>
        <AppText variant="caption" color={colors.textMuted} numberOfLines={2}>
          {body}
        </AppText>
      </View>
    </Pressable>
  );
}

/** Each meal has its own warm colour, so the day reads at a glance. */
const MEAL_TINT: Record<MealType, string> = { breakfast: colors.carbs, lunch: colors.success, dinner: colors.primary, snack: colors.purple };

function MealSection({ meal, day, onAdd, onOpenLog }: { meal: MealType; day: NutritionDay; onAdd: () => void; onOpenLog: (log: FoodLog) => void }) {
  const logs = day.logs.filter((l) => l.mealType === meal);
  const totals = day.byMeal[meal];
  const tint = MEAL_TINT[meal];
  return (
    <Card style={{ gap: space.sm, paddingVertical: space.md, backgroundColor: `${tint}12`, borderColor: `${tint}2E` }}>
      <Row style={{ justifyContent: 'space-between' }} gap={space.md}>
        <View style={[styles.mealArt, { backgroundColor: colors.card, borderColor: `${tint}40` }]}>
          <MealArt kind={meal} size={36} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" header>
            {MEAL_LABEL[meal]}
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {totals.entries ? `${fmt(totals.kcal)} kcal · P ${Math.round(totals.proteinG)} · C ${Math.round(totals.carbsG)} · F ${Math.round(totals.fatG)}` : 'Nothing logged'}
          </AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add to ${MEAL_LABEL[meal]}`} onPress={onAdd} style={({ pressed }) => [styles.add, { backgroundColor: tint, opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="add" size={22} color={colors.onPrimary} />
        </Pressable>
      </Row>
      {logs.map((l, i) => {
        const badge = entryBadge(l);
        const portion = portionLabel(l);
        // Entries logged together (a scan or a weighed meal) get their meal name once, above the group.
        const groupStart = l.mealId && l.mealName && logs[i - 1]?.mealId !== l.mealId;
        return (
          <View key={l.id}>
            {groupStart ? (
              <AppText variant="label" color={colors.textFaint} style={{ paddingTop: space.xs }}>
                {l.mealName}
              </AppText>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${l.name}, ${Math.round(l.kcal)} calories${l.isEstimate ? ', estimate' : ''}. Edit`}
              onPress={() => onOpenLog(l)}
              style={({ pressed }) => [styles.entry, { opacity: pressed ? 0.7 : 1 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={space.sm}>
                  <AppText variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {l.name}
                  </AppText>
                  <Badge label={badge.label} tone={badge.tone} />
                </Row>
                <AppText variant="caption" color={colors.textMuted}>
                  {portion ? `${portion} · ` : ''}P {Math.round(l.proteinG)} · C {Math.round(l.carbsG)} · F {Math.round(l.fatG)}
                </AppText>
              </View>
              <AppText variant="bodyStrong">
                {l.isEstimate ? '≈' : ''}
                {fmt(l.kcal)}
              </AppText>
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  plan: { width: 196, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderTopColor: colors.edge },
  planArt: { height: 110, alignItems: 'center', justifyContent: 'center' },
  planIcon: { position: 'absolute', top: 10, left: 10, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dayPill: { justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 4 },
  mealArt: { width: 58, height: 50, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  add: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingVertical: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
