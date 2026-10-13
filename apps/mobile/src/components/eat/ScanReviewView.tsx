import { useRef, useState, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { NumberBadge, ScanPhotoLabels, type PhotoLabelItem, type ScanPhoto } from '@/components/eat/ScanPhotoLabels';
import { AppText, Badge, Button, Card, Field, IconButton, InlineMessage, Row, Segmented } from '@/components/ui';
import { useReducedMotion } from '@/lib/a11y';
import { MEAL_LABEL, MEALS, parseAmount } from '@/lib/eat';
import { ACCURACY_LABEL, chosenOption, CONFIDENCE_LABEL, itemEstimate, itemNumber, macroShares, qualityNote, reviewSummary, type ItemChoice, type ReviewState } from '@/lib/scan';
import type { FoodScan, MealType } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

export interface ScanReviewViewProps {
  scan: FoodScan;
  state: ReviewState;
  onChange: (itemId: string, patch: Partial<ItemChoice>) => void;
  onPickFood: (itemId: string) => void;
  meal: MealType;
  onMeal: (m: MealType) => void;
  mealName: string;
  onMealName: (s: string) => void;
  onConfirm: () => void;
  confirming?: boolean;
  error?: string | null;
  onRetake: () => void;
  /** The photo that was scanned, kept in memory for this review only. Absent: no photo section. */
  photo?: ScanPhoto | null;
  /** The enclosing screen's scroll view, so tapping a label on the photo can bring its card into view. */
  scrollRef?: RefObject<ScrollView | null>;
}

const BAND_TONE = { high: 'primary', medium: 'purple', low: 'warning' } as const;
const MACROS = ['protein', 'carbs', 'fat'] as const;

/** "Mostly protein — about 71% of its calories"; null when no one macro leads or there is nothing to split. */
function macroHeadline(shares: ReturnType<typeof macroShares>): string | null {
  const top = MACROS.reduce((a, b) => (shares[b] > shares[a] ? b : a));
  return shares[top] >= 0.5 ? `Mostly ${top} — about ${Math.round(shares[top] * 100)}% of its calories` : null;
}

/**
 * Review a scan before anything is logged. Everything here is an ESTIMATE: identity confidence
 * (what the food is) and nutrition accuracy (how close the numbers are) are shown separately.
 * The photo's labels are numbered like the cards below; they repeat the list, never replace it.
 */
export function ScanReviewView(p: ScanReviewViewProps) {
  const { scan, state } = p;
  const summary = reviewSummary(scan, state);
  const note = qualityNote(scan);
  const reduceMotion = useReducedMotion();
  // The label the user tapped on the photo: its card is highlighted (and scrolled into view when that's possible).
  const [activeId, setActiveId] = useState<string | null>(null);
  const cards = useRef<Record<string, View | null>>({});

  const anyLocated = scan.items.some((i) => i.box);
  const shownOnPhoto = scan.items.filter((i) => i.box && !state[i.id]?.removed).length;
  const labels: PhotoLabelItem[] = scan.items.map((item) => {
    const opt = chosenOption(item, state[item.id]!);
    return {
      id: item.id,
      number: itemNumber(scan, item.id),
      // A food we weren't sure of reads as a question on the photo, never as a fact.
      text: opt ? opt.label : `${item.label}?`,
      name: opt ? opt.label : `${item.label} (not sure)`,
      box: item.box,
      removed: state[item.id]?.removed,
    };
  });

  const showCard = (id: string) => {
    setActiveId(id);
    // Best effort: measure the card inside the scroll view's content, then scroll to just above it.
    const sv = p.scrollRef?.current as (ScrollView & { getInnerViewRef?: () => unknown }) | null | undefined;
    const card = cards.current[id] as (View & { measureLayout: (to: unknown, ok: (x: number, y: number) => void, fail: () => void) => void }) | null | undefined;
    const inner = sv?.getInnerViewRef?.();
    if (!sv || !card || !inner) return;
    try {
      card.measureLayout(
        inner,
        (_x, y) => sv.scrollTo({ y: Math.max(0, y - space.xl), animated: !reduceMotion }),
        () => {},
      );
    } catch {
      // The highlight is enough.
    }
  };

  return (
    <View style={{ gap: space.lg }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="heading" header>
          Review your meal
        </AppText>
        <Badge label="ESTIMATED" tone="warning" icon="alert-circle-outline" />
      </Row>
      {scan.provider.development ? (
        <InlineMessage tone="warning" icon="construct-outline">
          DEVELOPMENT SAMPLE — this isn’t real food recognition. These foods are a fixed test meal, not what’s in your photo.
        </InlineMessage>
      ) : null}
      {note ? <InlineMessage tone="info">{note}</InlineMessage> : null}

      {scan.summary ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="label" color={colors.textFaint}>
            In your photo
          </AppText>
          <AppText variant="bodyStrong">{scan.summary}</AppText>
        </Card>
      ) : null}

      {p.photo ? (
        <View style={{ gap: space.sm }}>
          <ScanPhotoLabels photo={p.photo} items={labels} activeId={activeId} onSelect={showCard} />
          <AppText variant="caption" color={colors.textMuted}>
            {shownOnPhoto
              ? 'Tap a label to jump to that food. Labels are our best reading of the photo, so check each food below.'
              : anyLocated
                ? 'The foods we could place were removed. What’s left is listed below.'
                : 'We couldn’t place labels on this photo. Every food we found is listed below.'}
          </AppText>
        </View>
      ) : null}

      <AppText variant="caption" color={colors.textMuted}>
        Portions and nutrition from a photo are estimates. Check each food, adjust the amounts, then log.
      </AppText>

      {scan.items.map((item) => {
        const c = state[item.id]!;
        const opt = chosenOption(item, c);
        const est = itemEstimate(item, c);
        const unit = c.food?.basis ?? 'g';
        const n = itemNumber(scan, item.id);
        if (c.removed) {
          return (
            <Card key={item.id} style={{ paddingVertical: space.md }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <AppText variant="body" color={colors.textMuted}>
                  {opt?.label ?? item.label} — removed
                </AppText>
                <Button label="Undo" variant="ghost" onPress={() => p.onChange(item.id, { removed: false })} />
              </Row>
            </Card>
          );
        }
        const shares = est ? macroShares(est) : null;
        const headline = shares ? macroHeadline(shares) : null;
        const active = activeId === item.id;
        return (
          <View key={item.id} ref={(r) => void (cards.current[item.id] = r)} collapsable={false}>
            <Card style={{ gap: space.md }}>
              <Row style={{ alignItems: 'flex-start' }}>
                <NumberBadge n={n} />
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText variant="bodyStrong">{opt?.label ?? 'Which food is this?'}</AppText>
                  <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                    <Badge label={`${CONFIDENCE_LABEL[item.band]} · ${Math.round(item.confidence * 100)}% sure it's ${item.label}`} tone={BAND_TONE[item.band]} />
                    {item.composite ? <Badge label="Mixed dish" tone="neutral" /> : null}
                  </Row>
                  {p.photo && anyLocated && !item.box ? (
                    <AppText variant="caption" color={colors.textFaint}>
                      Not located in the photo
                    </AppText>
                  ) : null}
                </View>
                <IconButton icon="close-circle-outline" label={`Remove ${opt?.label ?? item.label}`} onPress={() => p.onChange(item.id, { removed: true })} />
              </Row>

              {item.needsChoice && !opt ? <InlineMessage tone="warning">We’re not sure what this is — pick the right food.</InlineMessage> : null}

              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={`What is item ${n}?`}>
                {item.options.map((o) => {
                  const on = !c.food && c.option === o.key;
                  return (
                    <Pressable key={o.key} accessibilityRole="radio" accessibilityLabel={o.label} accessibilityState={{ checked: on }} aria-checked={on} onPress={() => p.onChange(item.id, { option: o.key, food: null })} style={[styles.chip, on && styles.chipOn]}>
                      <AppText variant="caption" color={on ? colors.text : colors.textMuted}>
                        {o.label}
                      </AppText>
                    </Pressable>
                  );
                })}
                <Pressable accessibilityRole="radio" accessibilityLabel="Other food" accessibilityState={{ checked: !!c.food }} aria-checked={!!c.food} onPress={() => p.onPickFood(item.id)} style={[styles.chip, !!c.food && styles.chipOn]}>
                  <AppText variant="caption" color={c.food ? colors.text : colors.primary}>
                    {c.food ? `✓ ${c.food.name}` : 'Other food…'}
                  </AppText>
                </Pressable>
              </View>

              <AmountField
                key={`${item.id}:${unit}`}
                value={c.amount}
                unit={unit}
                hint={c.food ? undefined : `Estimated ${item.serving.low}–${item.serving.high} g`}
                onChange={(amount) => p.onChange(item.id, { amount })}
              />

              {est ? (
                <View
                  style={styles.estimate}
                  accessible
                  accessibilityLabel={`About ${est.kcal} calories, likely between ${est.kcalLow} and ${est.kcalHigh}. ${est.proteinG} grams protein, ${est.carbsG} grams carbs, ${est.fatG} grams fat.${headline ? ` ${headline}.` : ''} ${ACCURACY_LABEL[est.accuracy]}`}>
                  <AppText variant="heading">
                    ≈ {est.kcal} kcal{' '}
                    <AppText variant="caption" color={colors.textMuted}>
                      ({est.kcalLow}–{est.kcalHigh})
                    </AppText>
                  </AppText>
                  {shares && shares.protein + shares.carbs + shares.fat > 0 ? <MacroBar id={item.id} shares={shares} /> : null}
                  <AppText variant="caption" color={colors.textMuted}>
                    <Text style={{ color: colors.protein }}>●</Text> P {est.proteinG} g · <Text style={{ color: colors.carbs }}>●</Text> C {est.carbsG} g · <Text style={{ color: colors.fat }}>●</Text> F {est.fatG} g
                  </AppText>
                  {headline ? (
                    <AppText variant="caption" color={colors.textMuted}>
                      {headline}
                    </AppText>
                  ) : null}
                  <AppText variant="caption" color={est.accuracy === 'rough' ? colors.warning : colors.textFaint}>
                    {ACCURACY_LABEL[est.accuracy]}
                  </AppText>
                </View>
              ) : null}
              {item.hiddenIngredients.length ? (
                <AppText variant="caption" color={colors.textMuted}>
                  May include: {item.hiddenIngredients.join(', ')} — not visible, not exact.
                </AppText>
              ) : null}
            </Card>
            {active ? <View testID={`item-highlight-${item.id}`} style={styles.highlight} /> : null}
          </View>
        );
      })}

      <Card style={{ gap: space.md }}>
        <View accessible accessibilityLabel={`Meal total about ${summary.kcal} calories, likely ${summary.kcalLow} to ${summary.kcalHigh}`}>
          <AppText variant="label" color={colors.textMuted}>
            Meal estimate
          </AppText>
          <AppText variant="title">≈ {summary.kcal} kcal</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Likely {summary.kcalLow}–{summary.kcalHigh} kcal · {summary.kept} item{summary.kept === 1 ? '' : 's'}
          </AppText>
        </View>
        <Segmented label="Meal" options={MEALS.map((m) => ({ value: m, label: MEAL_LABEL[m] }))} value={p.meal} onChange={p.onMeal} />
        {summary.kept > 1 ? <Field label="Name this meal (optional)" value={p.mealName} onChangeText={p.onMealName} placeholder="e.g. Chicken rice bowl" maxLength={60} /> : null}
        {summary.undecided.length ? (
          <AppText variant="caption" color={colors.warning}>
            Choose a food for {summary.undecided.length === 1 ? 'the item' : `${summary.undecided.length} items`} we weren’t sure about, or remove {summary.undecided.length === 1 ? 'it' : 'them'}.
          </AppText>
        ) : null}
        {p.error ? <InlineMessage tone="danger">{p.error}</InlineMessage> : null}
        <Button
          label={summary.kept ? `Log ${summary.kept} item${summary.kept === 1 ? '' : 's'} (estimated)` : 'Nothing to log'}
          icon="checkmark"
          onPress={p.onConfirm}
          loading={p.confirming}
          disabled={!summary.canConfirm}
        />
        <Button label="Retake photo" variant="ghost" icon="camera-reverse-outline" onPress={p.onRetake} />
      </Card>
    </View>
  );
}

/**
 * Where an item's calories come from, as a thin three-part bar (protein, carbs, fat). A picture of
 * the same numbers written beside it, so it is hidden from screen readers.
 */
function MacroBar({ id, shares }: { id: string; shares: { protein: number; carbs: number; fat: number } }) {
  return (
    <View testID={`macro-bar-${id}`} style={styles.bar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {MACROS.filter((m) => shares[m] > 0).map((m) => (
        <View key={m} style={{ flex: shares[m], backgroundColor: colors[m] }} />
      ))}
    </View>
  );
}

/** Amount with −/+ steps; keeps the typed text locally so partial input ("1.") isn't lost. */
function AmountField({ value, unit, hint, onChange }: { value: number; unit: 'g' | 'ml'; hint?: string; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const set = (n: number) => {
    const v = Math.max(1, Math.round(n));
    setText(String(v));
    onChange(v);
  };
  return (
    <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
      <Button label="−" variant="secondary" onPress={() => set((Number.isFinite(parseAmount(text)) ? parseAmount(text) : value) - 10)} accessibilityHint="Decrease amount" style={{ width: 52 }} />
      <Field
        label={`Amount (${unit})`}
        value={text}
        onChangeText={(t) => {
          setText(t);
          const n = parseAmount(t);
          onChange(Number.isFinite(n) && n > 0 ? n : 0);
        }}
        keyboardType="decimal-pad"
        hint={hint}
        style={{ flex: 1 }}
      />
      <Button label="+" variant="secondary" onPress={() => set((Number.isFinite(parseAmount(text)) ? parseAmount(text) : value) + 10)} accessibilityHint="Increase amount" style={{ width: 52 }} />
    </Row>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  estimate: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.wash, gap: 6 },
  bar: { flexDirection: 'row', height: 8, borderRadius: radius.pill, overflow: 'hidden', gap: 2, backgroundColor: colors.track },
  // A ring laid over the card the user chose on the photo, so nothing shifts when it appears.
  highlight: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary, pointerEvents: 'none' },
});
