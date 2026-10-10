import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { defaultMealType } from '@form/domain';
import { AppText, Badge, Button, Card, Divider, FuelSummary, IconBubble, IconButton, InlineMessage, ListRow, Row, SectionHeader, StateView, WaterLine, type FuelMacro, type IconName } from '@/components/ui';
import { MealArt } from '@/components/art/MealArt';
import { dayHeadline, entryBadge, formatLiters, MEAL_LABEL, MEALS, portionLabel, proteinNudge } from '@/lib/eat';
import type { FoodLog, MealType, NutritionDay } from '@/lib/types';
import { a11y, colors, radius, space } from '@/theme/tokens';

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
  /** The server couldn't be asked whether scanning is on (offline, or still waking up). */
  scanUnknown?: boolean;
  scanChecking?: boolean;
  /** Weigh several ingredients and log them as one meal. */
  onWeighMeal: () => void;
  /** Scan a packaged food's barcode (Open Food Facts). */
  onScanBarcode?: () => void;
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
  const over = !!kcal && kcal.over > 0;
  // Only today gets a nudge — past days are history, not a to-do list.
  const nudge = p.onAddWater ? proteinNudge(day) : null;
  // With targets all three macros show bars; without, protein alone stays visible, as a plain number.
  const macros: FuelMacro[] = day.progress
    ? [
        { label: 'Protein', value: day.totals.proteinG, target: Math.round(day.progress.proteinG.target), color: colors.protein },
        { label: 'Carbs', value: day.totals.carbsG, target: Math.round(day.progress.carbsG.target), color: colors.carbs },
        { label: 'Fat', value: day.totals.fatG, target: Math.round(day.progress.fatG.target), color: colors.fat },
      ]
    : [{ label: 'Protein', value: day.totals.proteinG, target: null, color: colors.protein }];

  return (
    <View style={{ gap: space.lg }}>
      <Row style={styles.dayPill}>
        {p.onPrev ? <IconButton icon="chevron-back" label="Previous day" onPress={p.onPrev} color={colors.text} /> : <View style={{ width: 44 }} />}
        <AppText variant="heading" header accessibilityLabel={`Showing ${p.title}`}>
          {p.title}
        </AppText>
        {p.onNext ? <IconButton icon="chevron-forward" label="Next day" onPress={p.onNext} color={colors.text} /> : <View style={{ width: 44 }} />}
      </Row>

      <Card style={{ gap: space.lg }}>
        <FuelSummary
          title={dayHeadline(day)}
          numeral={fmt(day.totals.kcal)}
          unitLabel={kcal ? `/ ${fmt(kcal.target)} kcal` : 'kcal'}
          caption={kcal ? (kcal.over > 0 ? `${fmt(kcal.over)} over` : `${fmt(kcal.remaining)} left`) : null}
          captionTone={over ? 'warning' : 'muted'}
          ring={kcal ? { value: kcal.fraction, color: over ? colors.warning : colors.accent, label: 'Calories eaten of target' } : null}
          macros={macros}>
          {day.totals.estimatedKcalShare > 0 ? (
            <InlineMessage flat tone="warning" icon="alert-circle-outline">
              {`About ${Math.round(day.totals.estimatedKcalShare * 100)}% of these calories are estimates, not measured amounts.`}
            </InlineMessage>
          ) : null}
          {day.totals.measuredKcalShare > 0 ? (
            <AppText variant="caption" color={colors.textFaint}>
              {`${Math.round(day.totals.measuredKcalShare * 100)}% measured on a scale.`}
            </AppText>
          ) : null}
          {!day.targets ? (
            <Pressable accessibilityRole="link" onPress={p.onSetUpProfile} style={{ minHeight: a11y.minTouch, justifyContent: 'center' }}>
              <InlineMessage flat tone="info">
                Add your body details in Profile to get personal calorie and macro targets →
              </InlineMessage>
            </Pressable>
          ) : null}
        </FuelSummary>
        <Divider />
        <WaterLine
          totalText={formatLiters(day.water.totalMl)}
          targetText={formatLiters(day.water.targetMl)}
          fraction={day.water.progress.fraction}
          accessibilityLabel={`Water: ${formatLiters(day.water.totalMl)} of ${formatLiters(day.water.targetMl)}`}
          hint={day.water.progress.fraction >= 1 ? 'Goal reached — nicely done.' : 'A glass at a time adds up.'}
        />
        {p.onAddWater ? (
          <Row gap={space.sm}>
            <Button label="+250 ml" variant="secondary" icon="water-outline" onPress={() => p.onAddWater!(250)} loading={p.addingWater} style={{ flex: 1 }} />
            <Button label="+500 ml" variant="secondary" onPress={() => p.onAddWater!(500)} disabled={p.addingWater} style={{ flex: 1 }} />
          </Row>
        ) : null}
      </Card>

      {nudge ? (
        <Card style={{ gap: space.sm }}>
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

      <View style={{ gap: space.md }}>
        <SectionHeader title="Log food" />
        <Card style={styles.tools}>
          <Tool icon="camera-outline" label="Scan a meal" onPress={p.onScan} busy={p.scanChecking && !p.scanAvailable} />
          {p.onScanBarcode ? <Tool icon="barcode-outline" label="Barcode" accessibilityLabel="Scan a barcode" onPress={p.onScanBarcode} divided /> : null}
          <Tool icon="scale-outline" label="Weigh a meal" onPress={p.onWeighMeal} divided />
        </Card>
        {p.showScanInfo ? (
          p.scanAvailable ? (
            <StateView kind="empty" compact title="Scanning gives an estimate" message="A photo can't weigh food. Scanned amounts are always marked as estimates." />
          ) : p.scanUnknown ? (
            <StateView kind="error" compact title="Couldn't reach FORM's server" message="Check your connection and tap Scan a meal again. The server can take up to a minute to wake up." />
          ) : (
            <StateView kind="unavailable" compact title="Food scanning isn't available yet" message="Search the food database, add a food from its label, or weigh it for the most accurate numbers." />
          )
        ) : null}
      </View>

      <View style={{ gap: space.md }}>
        <SectionHeader title="Meals" />
        <Card style={{ paddingVertical: space.xs }}>
          {MEALS.map((meal, i) => (
            <View key={meal}>
              {i > 0 ? <Divider /> : null}
              <MealSection meal={meal} day={day} onAdd={() => p.onAdd(meal)} onOpenLog={p.onOpenLog} />
            </View>
          ))}
        </Card>
      </View>

      {p.planning ? (
        <Card style={{ paddingVertical: space.xs }}>
          <ListRow
            title="Meal plan"
            subtitle="Meals that fit your targets and diet"
            icon="calendar"
            iconTint={colors.primary}
            accessibilityLabel="Meal plan. Meals that fit your targets and diet"
            onPress={p.planning.onOpenPlan}
          />
          <Divider />
          <ListRow title="Recipes" subtitle="Simple recipes that suit you" icon="book" iconTint={colors.success} accessibilityLabel="Recipes. Simple recipes that suit you" onPress={p.planning.onOpenRecipes} />
          <Divider />
          <ListRow
            title="Grocery list"
            subtitle="Everything your plan needs, by aisle"
            icon="cart"
            iconTint={colors.accent}
            accessibilityLabel="Grocery list. Everything your plan needs, by aisle"
            onPress={p.planning.onOpenGrocery}
          />
        </Card>
      ) : null}
    </View>
  );
}

/** Each meal has its own warm colour, so the day reads at a glance. */
const MEAL_TINT: Record<MealType, string> = { breakfast: colors.carbs, lunch: colors.success, dinner: colors.primary, snack: colors.purple };

function MealSection({ meal, day, onAdd, onOpenLog }: { meal: MealType; day: NutritionDay; onAdd: () => void; onOpenLog: (log: FoodLog) => void }) {
  const logs = day.logs.filter((l) => l.mealType === meal);
  const totals = day.byMeal[meal];
  const tint = MEAL_TINT[meal];
  return (
    <View style={{ gap: space.sm, paddingVertical: space.md }}>
      <Row style={{ justifyContent: 'space-between' }} gap={space.md}>
        <View style={[styles.mealArt, { backgroundColor: `${tint}1A` }]}>
          <MealArt kind={meal} size={32} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" header>
            {MEAL_LABEL[meal]}
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {totals.entries ? `${fmt(totals.kcal)} kcal · P ${Math.round(totals.proteinG)} · C ${Math.round(totals.carbsG)} · F ${Math.round(totals.fatG)}` : 'Nothing logged'}
          </AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add to ${MEAL_LABEL[meal]}`} onPress={onAdd} style={({ pressed }) => [styles.add, { opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name="add" size={22} color={colors.primary} />
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
    </View>
  );
}

/** One logging tool: an icon over a short label, one equal cell of the tools card. */
function Tool({ icon, label, onPress, busy, accessibilityLabel, divided }: { icon: IconName; label: string; onPress: () => void; busy?: boolean; accessibilityLabel?: string; divided?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: !!busy }}
      aria-busy={!!busy}
      onPress={onPress}
      style={({ pressed }) => [styles.tool, divided && styles.toolDivided, { opacity: pressed ? 0.75 : busy ? 0.6 : 1 }]}>
      <IconBubble icon={icon} tint={colors.primary} />
      <AppText variant="label" color={colors.text} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dayPill: { justifyContent: 'space-between', paddingHorizontal: 4 },
  mealArt: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', alignItems: 'stretch', padding: 0, overflow: 'hidden' },
  tool: { flex: 1, alignItems: 'center', gap: space.sm, paddingVertical: space.md, paddingHorizontal: space.xs, minHeight: 88 },
  toolDivided: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.hairline },
  add: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 48,
    paddingVertical: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
});
