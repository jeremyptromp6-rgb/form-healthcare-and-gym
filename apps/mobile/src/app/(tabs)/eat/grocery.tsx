import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { GroceryListView } from '@/components/eat/GroceryListView';
import { ErrorState, Screen, StateView } from '@/components/ui';
import { uuid } from '@/lib/dates';
import { useGrocery, useGroceryAction, useRefetchOnFocus } from '@/lib/queries';

/** The grocery list: from the meal plan, from recipes, and anything you add. */
export default function Grocery() {
  const list = useGrocery();
  const action = useGroceryAction();
  const [error, setError] = useState<string | null>(null);
  useRefetchOnFocus(list.refetch);
  const fail = (e: { kind: string; message: string }) => setError(e.kind === 'network' ? 'Not saved — check your connection and try again.' : e.message);
  const run = (a: Parameters<typeof action.mutate>[0]) => {
    setError(null);
    action.mutate(a, { onError: fail });
  };

  if (list.isPending) return <Screen title="Grocery list"><StateView kind="loading" /></Screen>;
  if (list.isError && !list.data) return <Screen title="Grocery list"><ErrorState error={list.error} onRetry={list.refetch} /></Screen>;
  return (
    <Screen title="Grocery list" subtitle="Eat" refreshing={list.isRefetching} onRefresh={list.refetch}>
      <GroceryListView
        list={list.data.list}
        onToggle={(i) => run({ kind: 'check', itemId: i.id, checked: !i.checked })}
        onDelete={(i) => run({ kind: 'delete', itemId: i.id })}
        onAddCustom={(name, quantity) => run({ kind: 'custom', clientItemId: uuid(), name, quantity })}
        adding={action.isPending && action.variables?.kind === 'custom'}
        onClearChecked={() => run({ kind: 'clear' })}
        error={error}
        onOpenPlan={() => router.push('/eat/plan' as Href)}
      />
    </Screen>
  );
}
