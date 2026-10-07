import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card, Field, IconButton, InlineMessage, Row, Segmented } from '@/components/ui';
import { MEAL_LABEL, MEALS, parseAmount } from '@/lib/eat';
import { ACCURACY_LABEL, chosenOption, CONFIDENCE_LABEL, itemEstimate, qualityNote, reviewSummary, type ItemChoice, type ReviewState } from '@/lib/scan';
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
}

const BAND_TONE = { high: 'primary', medium: 'purple', low: 'warning' } as const;

/**
 * Review a scan before anything is logged. Everything here is an ESTIMATE: identity confidence
 * (what the food is) and nutrition accuracy (how close the numbers are) are shown separately.
 */
export function ScanReviewView(p: ScanReviewViewProps) {
  const { scan, state } = p;
  const summary = reviewSummary(scan, state);
  const note = qualityNote(scan);

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
      <AppText variant="caption" color={colors.textMuted}>
        Portions and nutrition from a photo are estimates. Check each food, adjust the amounts, then log.
      </AppText>

      {scan.items.map((item) => {
        const c = state[item.id]!;
        const opt = chosenOption(item, c);
        const est = itemEstimate(item, c);
        const unit = c.food?.basis ?? 'g';
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
        return (
          <Card key={item.id} style={{ gap: space.md }}>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="bodyStrong">{opt?.label ?? 'Which food is this?'}</AppText>
                <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
                  <Badge label={`${CONFIDENCE_LABEL[item.band]} · ${Math.round(item.confidence * 100)}% sure it's ${item.label}`} tone={BAND_TONE[item.band]} />
                  {item.composite ? <Badge label="Mixed dish" tone="neutral" /> : null}
                </Row>
              </View>
              <IconButton icon="close-circle-outline" label={`Remove ${opt?.label ?? item.label}`} onPress={() => p.onChange(item.id, { removed: true })} />
            </Row>

            {item.needsChoice && !opt ? <InlineMessage tone="warning">We’re not sure what this is — pick the right food.</InlineMessage> : null}

            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={`What is item ${item.id.slice(1)}?`}>
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
              <View style={styles.estimate} accessible accessibilityLabel={`About ${est.kcal} calories, likely between ${est.kcalLow} and ${est.kcalHigh}. ${ACCURACY_LABEL[est.accuracy]}`}>
                <AppText variant="heading">
                  ≈ {est.kcal} kcal{' '}
                  <AppText variant="caption" color={colors.textMuted}>
                    ({est.kcalLow}–{est.kcalHigh})
                  </AppText>
                </AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  P {est.proteinG} g · C {est.carbsG} g · F {est.fatG} g
                </AppText>
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
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  estimate: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.wash, gap: 2 },
});
