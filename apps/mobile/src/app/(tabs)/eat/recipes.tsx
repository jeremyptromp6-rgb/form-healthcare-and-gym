import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Card, Divider, ErrorState, Field, ListRow, Screen, Segmented, StateView } from '@/components/ui';
import { MEAL_LABEL } from '@/lib/eat';
import { useRecipes } from '@/lib/queries';
import type { MealType } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

type Filter = 'all' | MealType | 'saved';

/** Browse recipes that suit you. With `planId` + `date`, picking one adds it to that day of the plan. */
export default function Recipes() {
  const params = useLocalSearchParams<{ planId?: string; date?: string }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const recipes = useRecipes({ ...(filter === 'saved' ? { saved: true } : filter !== 'all' ? { slot: filter } : {}), ...(q.trim().length >= 2 ? { q: q.trim() } : {}) });
  const picking = params.planId && params.date;

  return (
    <Screen title={picking ? 'Add a meal' : 'Recipes'} subtitle={picking ? 'Choose a recipe' : 'Suited to your diet and allergies'}>
      <Field label="Search recipes" value={q} onChangeText={setQ} placeholder="e.g. lentils, salmon, oats" autoCorrect={false} />
      <Segmented
        label="Show"
        options={[
          { value: 'all', label: 'All' },
          { value: 'breakfast', label: 'Breakfast' },
          { value: 'lunch', label: 'Lunch' },
          { value: 'dinner', label: 'Dinner' },
          { value: 'snack', label: 'Snacks' },
          ...(picking ? [] : [{ value: 'saved' as const, label: 'Saved' }]),
        ]}
        value={filter}
        onChange={setFilter}
      />
      {recipes.isPending ? <StateView kind="loading" /> : null}
      {recipes.isError && !recipes.data ? <ErrorState error={recipes.error} onRetry={recipes.refetch} /> : null}
      {recipes.data?.recipes.length === 0 ? (
        <Card>
          <StateView kind="empty" compact title={filter === 'saved' ? 'No saved recipes yet' : 'No recipes match'} message={filter === 'saved' ? 'Tap Save on any recipe to keep it here.' : 'Try another search or meal.'} />
        </Card>
      ) : null}
      {recipes.data && recipes.data.recipes.length > 0 ? (
        <Card style={{ paddingVertical: space.xs }}>
          {recipes.data.recipes.map((r, i) => (
            <View key={r.id}>
              {i > 0 ? <Divider /> : null}
              <ListRow
                title={r.title}
                subtitle={`${r.slots.map((s) => MEAL_LABEL[s]).join(' · ')} · ${r.totalMinutes === 0 ? 'no cooking' : `${r.totalMinutes} min`} · ${r.perServing.kcal} kcal · ${Math.round(r.perServing.proteinG)} g protein`}
                onPress={() => router.push((picking ? `/eat/recipe/${r.id}?planId=${params.planId}&date=${params.date}` : `/eat/recipe/${r.id}`) as Href)}
                right={r.fit.disliked ? <AppText variant="caption" color={colors.textFaint}>Not your favourite</AppText> : null}
              />
            </View>
          ))}
        </Card>
      ) : null}
      <AppText variant="caption" color={colors.textFaint}>
        Recipes that conflict with your allergies or diet restrictions are never shown. Nutrition is per serving, calculated from FORM’s verified food database.
      </AppText>
    </Screen>
  );
}
