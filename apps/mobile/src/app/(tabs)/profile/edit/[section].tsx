import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { BodySection, GoalSection, HabitsSection, NutritionSection, TrainingSection, type SectionProps } from '@/components/profile/sections';
import { ErrorState, InlineMessage, Screen, StateView } from '@/components/ui';
import { useCatalog, useMe } from '@/lib/queries';
import type { OnboardingStep } from '@/lib/types';

const SECTIONS: Record<OnboardingStep, { title: string; component: (p: SectionProps) => React.JSX.Element }> = {
  goal: { title: 'Goal', component: GoalSection },
  body: { title: 'About you', component: BodySection },
  training: { title: 'Training', component: TrainingSection },
  nutrition: { title: 'Food preferences', component: NutritionSection },
  habits: { title: 'Food habits', component: HabitsSection },
};

/** Edits one profile section with the same editor onboarding uses. */
export default function EditSection() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const me = useMe();
  const catalog = useCatalog();
  const [saved, setSaved] = useState(false);
  const def = SECTIONS[section as OnboardingStep];

  if (!def) {
    return (
      <Screen title="Not found">
        <StateView kind="empty" title="Nothing to edit here" actionLabel="Back to profile" onAction={() => router.back()} />
      </Screen>
    );
  }
  const Section = def.component;
  return (
    <Screen title={def.title} subtitle="Edit">
      <Stack.Screen options={{ title: def.title }} />
      {saved ? <InlineMessage tone="success">Saved.</InlineMessage> : null}
      {me.isError && !me.data ? <ErrorState error={me.error} onRetry={me.refetch} /> : null}
      {catalog.isError && !catalog.data ? <ErrorState error={catalog.error} onRetry={catalog.refetch} /> : null}
      {me.data && catalog.data ? (
        <Section
          me={me.data}
          catalog={catalog.data}
          submitLabel="Save"
          onSaved={() => {
            setSaved(true);
            // The profile stack always has the hub underneath (initialRouteName), so Back returns to it.
            setTimeout(() => router.back(), 600);
          }}
        />
      ) : !me.isError && !catalog.isError ? (
        <StateView kind="loading" />
      ) : null}
    </Screen>
  );
}
