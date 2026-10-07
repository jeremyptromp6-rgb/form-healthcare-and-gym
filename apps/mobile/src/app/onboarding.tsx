import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileSummary } from '@/components/profile/ProfileSummary';
import { BodySection, GoalSection, HabitsSection, NutritionSection, TrainingSection, type SectionProps } from '@/components/profile/sections';
import { AppText, Button, ErrorState, IconButton, InlineMessage, ProgressBar, Row, StateView } from '@/components/ui';
import { useReducedMotion } from '@/lib/a11y';
import { useAuth } from '@/lib/auth';
import { useCatalog, useCompleteOnboarding, useMe } from '@/lib/queries';
import type { OnboardingStep } from '@/lib/types';
import { colors, MAX_CONTENT_WIDTH, space } from '@/theme/tokens';

type Step = OnboardingStep | 'review';
const ORDER: Step[] = ['goal', 'body', 'training', 'nutrition', 'habits', 'review'];

const COPY: Record<Step, { title: string; subtitle: string }> = {
  goal: { title: "What's your main goal?", subtitle: 'Pick the one that matters most right now. You can change it any time.' },
  body: { title: 'About you', subtitle: 'Used to set calorie and macro targets that are safe for you. Private to your account.' },
  training: { title: 'How you train', subtitle: 'So future plans fit your experience, schedule and kit.' },
  nutrition: { title: 'Food preferences', subtitle: 'Allergies are hard rules. Dislikes are just preferences. Skip anything that doesn’t apply.' },
  habits: { title: 'Food habits', subtitle: 'So meal ideas fit your time and budget.' },
  review: { title: 'Check your answers', subtitle: 'Everything look right? You can edit any of this later in Profile.' },
};

const SECTIONS: Record<OnboardingStep, (p: SectionProps) => React.JSX.Element> = {
  goal: GoalSection,
  body: BodySection,
  training: TrainingSection,
  nutrition: NutritionSection,
  habits: HabitsSection,
};

/** First-run personalization. Every step saves immediately, so a returning user resumes where they left off. */
export default function Onboarding() {
  const { signOut } = useAuth();
  const me = useMe();
  const catalog = useCatalog();
  const complete = useCompleteOnboarding();
  const [chosenStep, setStep] = useState<Step | null>(null);
  const [editingFromReview, setEditingFromReview] = useState(false);
  const scroll = useRef<ScrollView>(null);
  // Until the user navigates, resume at the server's next unanswered step.
  const step: Step | null = chosenStep ?? (me.data ? (me.data.onboarding.nextStep ?? 'review') : null);

  // Each step starts at the top — after the new step has rendered, not before.
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  const goTo = (s: Step) => setStep(s);
  const next = () => {
    if (editingFromReview) {
      setEditingFromReview(false);
      return goTo('review');
    }
    goTo(ORDER[Math.min(ORDER.indexOf(step!) + 1, ORDER.length - 1)]!);
  };
  const back = () => goTo(ORDER[Math.max(ORDER.indexOf(step!) - 1, 0)]!);

  if (me.isError && !me.data) return <Shell><ErrorState error={me.error} onRetry={me.refetch} /></Shell>;
  if (catalog.isError && !catalog.data) return <Shell><ErrorState error={catalog.error} onRetry={catalog.refetch} /></Shell>;
  if (!me.data || !catalog.data || step === null) return <Shell><StateView kind="loading" /></Shell>;

  const index = ORDER.indexOf(step);
  const Section = step === 'review' ? null : SECTIONS[step];
  const remaining = me.data.onboarding.remaining;

  return (
    <Shell scrollRef={scroll}>
      <Row style={{ justifyContent: 'space-between' }}>
        {index > 0 && !editingFromReview ? <IconButton icon="chevron-back" label="Back" onPress={back} color={colors.text} /> : <View style={{ width: 44 }} />}
        <AppText variant="label" color={colors.textMuted}>
          {step === 'review' ? 'Review' : `Step ${index + 1} of ${ORDER.length - 1}`}
        </AppText>
        <View style={{ width: 44 }} />
      </Row>
      <ProgressBar value={(index + 1) / ORDER.length} height={4} label={`Setup progress, step ${index + 1} of ${ORDER.length}`} />

      <StepTransition stepKey={step}>
        <View style={{ gap: space.sm, marginBottom: space.lg }}>
          <AppText variant="title" header>
            {COPY[step].title}
          </AppText>
          <AppText variant="body" color={colors.textMuted}>
            {COPY[step].subtitle}
          </AppText>
        </View>

        {Section ? (
          <Section me={me.data} catalog={catalog.data} submitLabel={editingFromReview ? 'Save' : 'Continue'} onSaved={next} />
        ) : (
          <View style={{ gap: space.lg }}>
            <ProfileSummary
              me={me.data}
              catalog={catalog.data}
              onEdit={(s) => {
                setEditingFromReview(true);
                goTo(s);
              }}
            />
            {remaining.length ? <InlineMessage tone="warning">A few answers are still missing. Tap Edit on the sections marked “To do”.</InlineMessage> : null}
            {complete.isError ? <InlineMessage tone="danger">Couldn&apos;t finish setup. Try again.</InlineMessage> : null}
            <Button label="Confirm & start" icon="arrow-forward" onPress={() => complete.mutate()} loading={complete.isPending} disabled={remaining.length > 0} />
          </View>
        )}
      </StepTransition>

      <Button label="Your data & privacy" icon="shield-checkmark-outline" variant="ghost" onPress={() => router.push('/privacy' as Href)} />
      <Button label="Sign out" variant="ghost" onPress={signOut} />
    </Shell>
  );
}

function Shell({ children, scrollRef }: { children: React.ReactNode; scrollRef?: React.RefObject<ScrollView | null> }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Fades and slides each step in. Skipped when the user prefers reduced motion. */
function StepTransition({ stepKey, children }: { stepKey: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduce) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [stepKey, reduce, anim]);
  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>{children}</Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.xl, paddingTop: space.md, gap: space.lg, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
});
