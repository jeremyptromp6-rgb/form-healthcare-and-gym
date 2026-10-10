import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, type ReactNode } from 'react';
import { View } from 'react-native';
import { AppText, Badge, Card, Divider, Row, SectionAction } from '@/components/ui';
import { labelOf } from '@/lib/profileForm';
import type { Me, OnboardingStep, ProfileOptions } from '@/lib/types';
import { formatHeight, formatWeight } from '@/lib/units';
import { colors, space } from '@/theme/tokens';

/** The plan's sections, separated by hairlines inside one card. */
function SectionStack({ children }: { children: ReactNode }) {
  return (
    <View>
      {Children.toArray(children).map((child, i) => (
        <View key={i}>
          {i > 0 ? <Divider style={{ marginVertical: space.md }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

function Section({ title, onEdit, missing, children }: { title: string; onEdit?: () => void; missing?: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm} style={{ flex: 1 }}>
          <AppText variant="heading" header style={{ flexShrink: 1 }}>
            {title}
          </AppText>
          {missing ? <Badge label="TO DO" tone="warning" /> : null}
        </Row>
        {onEdit ? <SectionAction label="Edit" accessibilityLabel={`Edit ${title}`} onPress={onEdit} /> : null}
      </Row>
      {children}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={space.md}>
      <AppText variant="caption" color={colors.textMuted}>
        {label}
      </AppText>
      <AppText variant="body" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </AppText>
    </Row>
  );
}

const list = (items: string[]) => (items.length ? items.join(', ') : 'None');

/** Read-only summary of everything onboarding collects, with an Edit link per section. */
export function ProfileSummary({
  me,
  catalog,
  onEdit,
  sections = ['goal', 'body', 'training', 'nutrition', 'habits'],
}: {
  me: Me;
  catalog: ProfileOptions;
  onEdit?: (step: OnboardingStep) => void;
  sections?: OnboardingStep[];
}) {
  const p = me.profile;
  const n = me.preferences;
  const units = me.settings.units;
  const missing = new Set(me.onboarding.remaining);
  const edit = (s: OnboardingStep) => (onEdit ? () => onEdit(s) : undefined);
  const labels = (opts: { key: string; label: string }[], keys: string[] = []) => keys.map((k) => labelOf(opts, k));

  const known: OnboardingStep[] = ['goal', 'body', 'training', 'nutrition', 'habits'];
  if (!sections.some((s) => known.includes(s))) return null;

  return (
    <Card>
      <SectionStack>
        {sections.includes('goal') ? (
          <Section title="Goal" onEdit={edit('goal')} missing={missing.has('goal')}>
            <AppText variant="bodyStrong">{labelOf(catalog.goals, p?.primaryGoal)}</AppText>
          </Section>
        ) : null}

        {sections.includes('body') ? (
          <Section title="About you" onEdit={edit('body')} missing={missing.has('body')}>
            <Line label="Age" value={p?.ageYears != null ? String(p.ageYears) : '—'} />
            <Line label="Height" value={p?.heightCm != null ? formatHeight(p.heightCm, units) : '—'} />
            <Line label="Weight" value={p?.weightKg != null ? formatWeight(p.weightKg, units) : '—'} />
          </Section>
        ) : null}

        {sections.includes('training') ? (
          <Section title="Training" onEdit={edit('training')} missing={missing.has('training')}>
            <Line label="Experience" value={labelOf(catalog.experienceLevels, p?.experience)} />
            <Line label="Days per week" value={p?.trainingDaysPerWeek != null ? String(p.trainingDaysPerWeek) : '—'} />
            <Line label="Where" value={labelOf(catalog.trainingLocations, p?.trainingLocation)} />
            <Line label="Equipment" value={list(labels(catalog.equipment, p?.equipment ?? []))} />
          </Section>
        ) : null}

        {sections.includes('nutrition') ? (
          <Section title="Food preferences" onEdit={edit('nutrition')} missing={missing.has('nutrition')}>
            <Line label="Diet" value={list(labels(catalog.dietaryPreferences, n?.dietaryPreferences))} />
            <View style={{ gap: 4, paddingVertical: 2 }} accessible accessibilityLabel={`Allergies: ${list([...labels(catalog.allergens, n?.allergens), ...(n?.customAllergies ?? [])])}`}>
              <Row gap={space.xs}>
                <Ionicons name="warning" size={14} color={colors.danger} />
                <AppText variant="caption" color={colors.danger}>
                  Allergies — never suggested
                </AppText>
              </Row>
              <AppText variant="body">{list([...labels(catalog.allergens, n?.allergens), ...(n?.customAllergies ?? [])])}</AppText>
            </View>
            <Line label="Dislikes — suggested less" value={list(n?.dislikedFoods ?? [])} />
          </Section>
        ) : null}

        {sections.includes('habits') ? (
          <Section title="Food habits" onEdit={edit('habits')} missing={missing.has('habits')}>
            <Line label="Cooking time" value={labelOf(catalog.cookingTimes, n?.cookingTime)} />
            <Line label="Budget" value={labelOf(catalog.foodBudgets, n?.foodBudget)} />
          </Section>
        ) : null}
      </SectionStack>
    </Card>
  );
}
