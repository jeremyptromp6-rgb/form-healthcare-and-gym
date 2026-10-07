import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Buddy } from '@/components/art/Buddy';
import { FormMark, WelcomeArt } from '@/components/art/SceneArt';
import { AppText, Button, Field, HeroMedia, IconButton, InlineMessage, Segmented } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { imagery } from '@/theme/imagery';
import { colors, gradients, space } from '@/theme/tokens';

export default function SignIn() {
  const { signIn, register } = useAuth();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signin' | 'register'>(params.mode === 'register' ? 'register' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) return setError('Enter your email and password.');
    if (mode === 'register' && password.length < 10) return setError('Use at least 10 characters for your password.');
    setBusy(true);
    try {
      await (mode === 'signin' ? signIn(email.trim(), password) : register(email.trim(), password));
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(
        err?.kind === 'network'
          ? "Can't reach FORM. Check your connection and that the API is running."
          : err?.code === 'invalid_request'
            ? 'Check your email address and password.'
            : (err?.message ?? 'Something went wrong. Try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {router.canGoBack() ? (
            <View style={{ alignSelf: 'flex-start', marginLeft: -space.sm }}>
              <IconButton icon="chevron-back" label="Back to welcome" onPress={() => router.back()} color={colors.text} />
            </View>
          ) : null}
          <HeroMedia image={imagery.onboarding} minHeight={340} style={{ marginBottom: space.sm }} art={
              <>
                <WelcomeArt style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 236 }} />
                {/* Melt the bottom of the scene into the card so there's no hard edge under the hills. */}
                <LinearGradient colors={[`${gradients.heroMedia[2]}00`, gradients.heroMedia[2]]} style={{ position: 'absolute', left: 0, right: 0, top: 176, height: 62 }} />
                <Buddy mood="happy" size={84} style={{ position: 'absolute', top: 112, left: 30 }} />
              </>
            }>
            <View style={styles.brand}>
              <FormMark size={36} />
              <AppText variant="heading" style={{ letterSpacing: 4 }}>
                FORM
              </AppText>
            </View>
            <AppText variant="display" header>
              {mode === 'signin' ? 'Welcome back.' : 'Your journey starts here.'}
            </AppText>
            <AppText variant="body" color={colors.textMuted}>
              Train. Eat. Progress.
            </AppText>
          </HeroMedia>

          <Segmented
            options={[
              { value: 'signin', label: 'Sign in' },
              { value: 'register', label: 'Create account' },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError(null);
            }}
          />

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            textContentType={mode === 'signin' ? 'password' : 'newPassword'}
            placeholder={mode === 'register' ? 'At least 10 characters' : '••••••••••'}
            onSubmitEditing={submit}
            hint={mode === 'register' ? 'Your workouts, meals and body data stay private to your account.' : undefined}
          />

          {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}

          <Button label={mode === 'signin' ? 'Sign in' : 'Create account'} onPress={submit} loading={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { position: 'absolute', top: space.xl, left: space.xl, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  container: { flexGrow: 1, justifyContent: 'center', padding: space.lg, gap: space.lg, width: '100%', maxWidth: 440, alignSelf: 'center' },
});
