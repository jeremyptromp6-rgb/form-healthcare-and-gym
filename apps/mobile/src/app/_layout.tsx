import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, StateView } from '@/components/ui';
import { wakeServer } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { reportCrash } from '@/lib/crashReport';
import { useMe } from '@/lib/queries';
import { bindAppFocus, createQueryClient } from '@/lib/queryClient';
import { useTimeZoneSync } from '@/lib/timezone';
import { useAfterDelay } from '@/lib/timing';
import { installFocusRing } from '@/lib/webFocus';
import { colors, scheme, space } from '@/theme/tokens';

const baseTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
const navTheme = {
  ...baseTheme,
  colors: { ...baseTheme.colors, background: colors.bg, card: colors.surface, primary: colors.primary, text: colors.text, border: colors.border },
};

/** How long the first load may take before we say the server is probably asleep. */
const WAKING_CAPTION_AFTER_MS = 6000;

function FullScreenLoading({ waking }: { waking?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <StateView kind="loading" />
      {waking ? (
        <AppText variant="caption" color={colors.textMuted} style={{ textAlign: 'center', paddingHorizontal: space.xl }}>
          Waking up the server — this can take up to a minute
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Route gating: signed out → the welcome page (then sign-in); signed in without a finished profile → onboarding;
 * otherwise → the five tabs. If /me can't load (offline), don't trap the user in
 * onboarding — let them into the app, where each screen shows its own error state.
 */
function RootNavigator() {
  const { status } = useAuth();
  const me = useMe();
  useTimeZoneSync();
  // Wait for /me only while it has a chance: after one failure (offline, API down) go on in, and
  // let each screen show its own error state instead of holding everyone on a spinner through retries.
  const waitingForMe = status === 'signedIn' && me.isPending && me.failureCount === 0;
  const waking = useAfterDelay(waitingForMe, WAKING_CAPTION_AFTER_MS);
  if (status === 'loading' || waitingForMe) return <FullScreenLoading waking={waking} />;

  const signedIn = status === 'signedIn';
  const needsOnboarding = signedIn && me.data !== undefined && !me.data.onboarding.completed;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={signedIn && !needsOnboarding}>
        <Stack.Screen name="(tabs)" />
        {/* The live workout sits above the tabs: full screen, no tab bar, no accidental swipes away. */}
        <Stack.Screen name="workout" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="coach" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pro" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={needsOnboarding}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      {/* Export and deletion must never depend on finishing onboarding. */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="privacy" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        {/* First listed, so it's where signed-out visitors land. */}
        <Stack.Screen name="welcome" />
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  useEffect(() => bindAppFocus(), []);
  useEffect(() => installFocusRing(), []);
  // Start waking the server the moment the app opens, so it is ready by the time anyone signs in.
  useEffect(() => wakeServer(), []);
  // Inter — clean, sharp and very readable — is the product typeface; if it fails to load, the system font is a fine fallback.
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  if (!fontsLoaded && !fontError) return <FullScreenLoading />;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={navTheme}>
        <AuthProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** Last-resort boundary for render errors anywhere in the app. Never shows stack traces to users. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  if (__DEV__) console.error(error);
  return <CrashScreen error={error} retry={retry} />;
}

function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  // Report once per crash (not on every re-render of this screen).
  useEffect(() => reportCrash(error), [error]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <StateView kind="error" title="Something went wrong" message="FORM hit an unexpected problem. Your data is safe." actionLabel="Try again" onAction={retry} />
    </SafeAreaView>
  );
}
