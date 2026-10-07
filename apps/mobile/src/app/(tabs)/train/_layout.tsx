import { Stack } from 'expo-router';
import { stackScreenOptions } from '@/components/ui/navigation';

// Deep links to an exercise or workout get Today's Workout underneath, so Back returns to it.
export const unstable_settings = { initialRouteName: 'index' };

export default function TrainStack() {
  return (
    <Stack
      screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Train' }} />
      <Stack.Screen name="exercise/[id]" options={{ title: 'Exercise' }} />
      <Stack.Screen name="history/[id]" options={{ title: 'Workout' }} />
    </Stack>
  );
}
