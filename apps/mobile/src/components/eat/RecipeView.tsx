import { formatGroceryAmount } from '@form/domain';
import { View } from 'react-native';
import { AppText, Badge, Button, Card, Divider, HeroMedia, InlineMessage, Row, Stat } from '@/components/ui';
import { MealArt } from '@/components/art/MealArt';
import { MEAL_LABEL } from '@/lib/eat';
import type { Recipe } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

export interface RecipeViewProps {
  recipe: Recipe;
  /** Servings to cook (scales the ingredient list and the grocery add). */
  servings: number;
  onServings: (n: number) => void;
  onToggleSave: () => void;
  saving?: boolean;
  onAddToGrocery: () => void;
  addingToGrocery?: boolean;
  groceryMessage?: string | null;
  /** When picking a meal for a plan. */
  planAction?: { label: string; onPress: () => void; busy?: boolean } | null;
  error?: string | null;
}

const ALLERGEN_LABEL: Record<string, string> = {
  peanuts: 'peanuts', tree_nuts: 'tree nuts', milk: 'milk', eggs: 'eggs', fish: 'fish', crustaceans: 'shellfish', molluscs: 'molluscs', soy: 'soy',
  gluten: 'gluten', sesame: 'sesame', mustard: 'mustard', celery: 'celery', lupin: 'lupin', sulphites: 'sulphites',
};

const amountText = (amount: number, unit: 'g' | 'ml') => (amount >= 1000 ? formatGroceryAmount(amount, unit) : `${Math.round(amount)} ${unit}`);

/** A recipe: what it is, whether it suits you, what's in it per serving, and how to make it. Pure view. */
export function RecipeView(p: RecipeViewProps) {
  const r = p.recipe;
  const factor = p.servings / r.servings;
  return (
    <View style={{ gap: space.lg }}>
      <HeroMedia minHeight={200} art={<MealArt kind={r.slots[0] ?? 'dinner'} size={110} style={{ position: 'absolute', top: 12, right: 10 }} />}>
        <AppText variant="overline" color={colors.primary}>
          {r.slots.map((s) => MEAL_LABEL[s]).join(' · ')}
        </AppText>
        <AppText variant="title" header>
          {r.title}
        </AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {r.totalMinutes === 0 ? 'No cooking' : `${r.totalMinutes} min`} · makes {r.servings} {r.servings === 1 ? 'serving' : 'servings'}
        </AppText>
      </HeroMedia>

      {r.fit.verdict === 'excluded' ? (
        <InlineMessage tone="danger">{`Not suitable for you${r.fit.matchedAllergens.length ? ` — contains ${r.fit.matchedAllergens.map((a) => ALLERGEN_LABEL[a] ?? a).join(', ')}` : ' — it conflicts with your diet'}.`}</InlineMessage>
      ) : r.fit.verdict === 'caution' ? (
        <InlineMessage tone="warning">We can’t confirm this suits your allergies or diet. Check every ingredient.</InlineMessage>
      ) : null}
      {r.fit.disliked ? <InlineMessage tone="info">Includes something you said you don’t like.</InlineMessage> : null}

      <View style={{ gap: space.sm }}>
        <AppText variant="label" color={colors.textMuted}>
          Per serving
        </AppText>
        <Row gap={space.sm}>
          <Stat label="Calories" value={String(r.perServing.kcal)} unit="kcal" />
          <Stat label="Protein" value={String(Math.round(r.perServing.proteinG))} unit="g" />
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          Carbs {Math.round(r.perServing.carbsG)} g · Fat {Math.round(r.perServing.fatG)} g · about {r.servingGrams} g per serving
        </AppText>
      </View>

      <Card style={{ gap: space.md }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="heading" header>
            Ingredients
          </AppText>
          <Row gap={space.xs}>
            <Button label="−" variant="secondary" onPress={() => p.onServings(Math.max(1, p.servings - 1))} disabled={p.servings <= 1} accessibilityHint="Fewer servings" style={{ width: 52 }} />
            <AppText variant="bodyStrong" accessibilityLabel={`${p.servings} servings`} style={{ minWidth: 36, textAlign: 'center' }}>
              {p.servings}
            </AppText>
            <Button label="+" variant="secondary" onPress={() => p.onServings(Math.min(12, p.servings + 1))} disabled={p.servings >= 12} accessibilityHint="More servings" style={{ width: 52 }} />
          </Row>
        </Row>
        {r.ingredients.map((i, k) => (
          <View key={i.foodId + k}>
            {k > 0 ? <Divider /> : null}
            <Row style={{ justifyContent: 'space-between', paddingVertical: space.sm }}>
              <View style={{ flex: 1 }}>
                <AppText variant="body">{i.name}</AppText>
                {i.note ? (
                  <AppText variant="caption" color={colors.textFaint}>
                    {i.note}
                    {factor !== 1 ? ' (for the original recipe)' : ''}
                  </AppText>
                ) : null}
              </View>
              <AppText variant="bodyStrong">{amountText(i.amount * factor, i.unit)}</AppText>
            </Row>
          </View>
        ))}
        {r.pantry.length ? (
          <AppText variant="caption" color={colors.textMuted}>
            Plus, to taste: {r.pantry.join(', ')}
          </AppText>
        ) : null}
        {p.groceryMessage ? <InlineMessage tone="success">{p.groceryMessage}</InlineMessage> : null}
        <Button label={`Add to grocery list (${p.servings} ${p.servings === 1 ? 'serving' : 'servings'})`} icon="cart-outline" variant="secondary" onPress={p.onAddToGrocery} loading={p.addingToGrocery} />
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="heading" header>
          Method
        </AppText>
        {r.steps.map((s, k) => (
          <Row key={k} gap={space.md} style={{ alignItems: 'flex-start' }}>
            <AppText variant="bodyStrong" color={colors.primary} style={{ width: 20 }}>
              {k + 1}
            </AppText>
            <AppText variant="body" style={{ flex: 1 }}>
              {s}
            </AppText>
          </Row>
        ))}
      </Card>

      <AppText variant="caption" color={colors.textFaint}>
        {r.allergens.length ? `Contains ${r.allergens.map((a) => ALLERGEN_LABEL[a] ?? a).join(', ')}. ` : ''}
        Always check labels — brands and kitchens differ. Nutrition is calculated from FORM’s verified food database.
      </AppText>

      {p.error ? <InlineMessage tone="danger">{p.error}</InlineMessage> : null}
      {p.planAction ? <Button label={p.planAction.label} icon="add" onPress={p.planAction.onPress} loading={p.planAction.busy} disabled={r.fit.verdict !== 'ok'} /> : null}
      <Button label={r.saved ? 'Saved' : 'Save recipe'} icon={r.saved ? 'bookmark' : 'bookmark-outline'} variant={r.saved ? 'secondary' : 'ghost'} onPress={p.onToggleSave} loading={p.saving} />
      {r.fit.overTime ? <Badge label="Longer than your usual cooking time" tone="neutral" icon="time-outline" /> : null}
    </View>
  );
}
