import { Stack } from 'expo-router';
import { stackScreenOptions } from '@/components/ui/navigation';

// Deep links to /profile/edit/… or /profile/weight get the hub underneath, so Back returns to it.
export const unstable_settings = { initialRouteName: 'index' };

export default function ProfileStack() {
  return (
    <Stack
      screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ headerShown: false, title: 'Profile' }} />
      <Stack.Screen name="edit/[section]" options={{ title: 'Edit' }} />
      <Stack.Screen name="weight" options={{ title: 'Weight history' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="security" options={{ title: 'Account & security' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy center' }} />
    </Stack>
  );
}
