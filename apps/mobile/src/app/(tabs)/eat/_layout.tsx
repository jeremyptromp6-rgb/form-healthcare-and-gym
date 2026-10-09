import { Stack } from 'expo-router';
import { stackScreenOptions } from '@/components/ui/navigation';

// Deep links to add/edit get the Eat day underneath, so Back returns to it.
export const unstable_settings = { initialRouteName: 'index' };

export default function EatStack() {
  return (
    <Stack
      screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Eat' }} />
      <Stack.Screen name="add" options={{ title: 'Add food' }} />
      <Stack.Screen name="log/[id]" options={{ title: 'Edit entry' }} />
      <Stack.Screen name="food/new" options={{ title: 'New food' }} />
      <Stack.Screen name="scan" options={{ title: 'Scan a meal' }} />
      <Stack.Screen name="barcode" options={{ title: 'Scan a barcode' }} />
      <Stack.Screen name="meal" options={{ title: 'Weigh a meal' }} />
      <Stack.Screen name="plan" options={{ title: 'Meal plan' }} />
      <Stack.Screen name="recipes" options={{ title: 'Recipes' }} />
      <Stack.Screen name="recipe/[id]" options={{ title: 'Recipe' }} />
      <Stack.Screen name="grocery" options={{ title: 'Grocery list' }} />
    </Stack>
  );
}
