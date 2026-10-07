import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, Badge, Card, ErrorState, Field, Row, StateView } from '@/components/ui';
import { useFoodSearch } from '@/lib/queries';
import type { FoodItem } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

/** A search field plus results — for picking a food from the verified database or your own. */
export function FoodPicker({ onPick, label = 'Search foods', autoFocus, initialQuery = '' }: { onPick: (f: FoodItem) => void; label?: string; autoFocus?: boolean; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <View style={{ gap: space.md }}>
      <Field label={label} value={query} onChangeText={setQuery} placeholder="e.g. chicken breast, oats, banana" autoFocus={autoFocus} autoCorrect={false} />
      {query.trim() ? <FoodSearchResults query={query} onPick={onPick} /> : null}
    </View>
  );
}

export function FoodSearchResults({ query, onPick }: { query: string; onPick: (f: FoodItem) => void }) {
  const search = useFoodSearch(query);
  if (search.isPending) return <StateView kind="loading" compact />;
  if (search.isError && !search.data) return <ErrorState error={search.error} onRetry={search.refetch} compact />;
  const foods = search.data?.foods ?? [];
  if (foods.length === 0) {
    return (
      <Card>
        <StateView kind="empty" compact title="No matches" message="Try another word, add it as a new food from its label, or quick-add the numbers." />
      </Card>
    );
  }
  return (
    <Card style={{ gap: 2, paddingVertical: space.sm }}>
      {foods.map((f) => (
        <FoodRow key={f.id} food={f} onPress={() => onPick(f)} />
      ))}
    </Card>
  );
}

export function FoodRow({ food, onPress }: { food: FoodItem; onPress: () => void }) {
  const serving = food.servings[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${food.name}${food.brand ? `, ${food.brand}` : ''}, ${Math.round(food.per100.kcal)} calories per 100 ${food.basis}`}
      onPress={onPress}
      style={({ pressed }) => [{ minHeight: 52, justifyContent: 'center', borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 }]}>
      <Row>
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={space.sm}>
            <AppText variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
              {food.name}
            </AppText>
            {food.origin === 'user_food' ? <Badge label="My food" tone="purple" /> : null}
          </Row>
          <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
            {food.brand ? `${food.brand} · ` : ''}
            {Math.round(food.per100.kcal)} kcal / 100 {food.basis}
            {serving ? ` · ${serving.label}` : ''}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
      </Row>
    </Pressable>
  );
}
