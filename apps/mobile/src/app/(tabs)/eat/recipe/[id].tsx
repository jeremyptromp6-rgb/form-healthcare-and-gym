import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { RecipeView } from '@/components/eat/RecipeView';
import { ErrorState, Screen, Segmented, StateView } from '@/components/ui';
import { MEAL_LABEL } from '@/lib/eat';
import { localDateKey } from '@/lib/dates';
import { useGroceryAction, usePlanAction, useRecipe, useSaveRecipe } from '@/lib/queries';
import type { MealType, Recipe } from '@/lib/types';
import { dayLabel } from '@/components/eat/MealPlanView';

/** A recipe. From the plan's "Add a meal", it also adds the recipe to that day. */
export default function RecipeScreen() {
  const { id, planId, date } = useLocalSearchParams<{ id: string; planId?: string; date?: string }>();
  const q = useRecipe(id);
  if (q.isPending) return <Screen title="Recipe"><StateView kind="loading" /></Screen>;
  if (q.isError) return <Screen title="Recipe">{q.error.kind === 'not_found' ? <StateView kind="empty" title="Recipe not found" /> : <ErrorState error={q.error} onRetry={q.refetch} />}</Screen>;
  return <RecipeDetail recipe={q.data.recipe} planId={planId ?? null} date={date ?? null} />;
}

function RecipeDetail({ recipe, planId, date }: { recipe: Recipe; planId: string | null; date: string | null }) {
  const [servings, setServings] = useState(recipe.servings);
  const [slot, setSlot] = useState<MealType>(recipe.slots[0]!);
  const [groceryMessage, setGroceryMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveRecipe(recipe.id);
  const grocery = useGroceryAction();
  const plan = usePlanAction();
  const fail = (e: { kind: string; message: string }) => setError(e.kind === 'network' ? 'Not saved — check your connection and try again.' : e.message);

  return (
    <Screen title={recipe.title}>
      <Stack.Screen options={{ title: 'Recipe' }} />
      {planId && date && recipe.slots.length > 1 ? (
        <Segmented label="Add as" options={recipe.slots.map((s) => ({ value: s, label: MEAL_LABEL[s] }))} value={slot} onChange={setSlot} />
      ) : null}
      <RecipeView
        recipe={recipe}
        servings={servings}
        onServings={setServings}
        onToggleSave={() => save.mutate(!recipe.saved, { onError: fail })}
        saving={save.isPending}
        onAddToGrocery={() => {
          setGroceryMessage(null);
          grocery.mutate({ kind: 'recipe', recipeId: recipe.id, servings }, { onSuccess: () => setGroceryMessage('Added to your grocery list.'), onError: fail });
        }}
        addingToGrocery={grocery.isPending}
        groceryMessage={groceryMessage}
        error={error}
        planAction={
          planId && date
            ? {
                label: `Add to ${dayLabel(date, localDateKey())} · ${MEAL_LABEL[slot]}`,
                busy: plan.isPending,
                // One serving: the plan screen adjusts portions afterwards.
                onPress: () => plan.mutate({ kind: 'add', planId, date, slot, recipeId: recipe.id, servings: 1 }, { onSuccess: () => router.dismissTo('/eat/plan' as Href), onError: fail }),
              }
            : null
        }
      />
    </Screen>
  );
}
