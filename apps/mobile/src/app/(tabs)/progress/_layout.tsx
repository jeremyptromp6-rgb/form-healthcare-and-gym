import { Stack } from 'expo-router';
import { stackScreenOptions } from '@/components/ui/navigation';

// Deep links to Body Quest or achievements get Progress underneath, so Back returns to it.
export const unstable_settings = { initialRouteName: 'index' };

export default function ProgressStack() {
  return (
    <Stack
      screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Progress' }} />
      <Stack.Screen name="body-quest" options={{ title: 'Body Quest' }} />
      <Stack.Screen name="achievements" options={{ title: 'Achievements' }} />
      <Stack.Screen name="rank" options={{ title: 'Your rank' }} />
      <Stack.Screen name="leaderboard" options={{ title: 'Leaderboards' }} />
      <Stack.Screen name="streak" options={{ title: 'Streak & Season' }} />
      <Stack.Screen name="analytics" options={{ title: 'Trends' }} />
      <Stack.Screen name="muscles" options={{ title: 'Muscle ranks' }} />
      <Stack.Screen name="body-progress" options={{ title: 'Body progress' }} />
      <Stack.Screen name="body-progress-capture" options={{ title: 'New photo' }} />
      <Stack.Screen name="body-progress-compare" options={{ title: 'Compare' }} />
      <Stack.Screen name="reports" options={{ title: 'Weekly report' }} />
    </Stack>
  );
}
