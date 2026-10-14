import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, InlineMessage, stateIcon, type IconName } from '@/components/ui';
import { toggleFocus } from '@/lib/profileForm';
import { usePatchProfile } from '@/lib/queries';
import type { FocusArea, ProfileOptions } from '@/lib/types';
import { a11y, colors, edgeLight, radius, space } from '@/theme/tokens';
import type { SectionProps } from './sections';

/**
 * "What do you want to focus on?" — pick up to three body areas the workouts should lean towards.
 * Onboarding and Profile use this same editor. Picking nothing is fine: workouts stay full body.
 */

const FOCUS_ICONS: Record<FocusArea, IconName> = {
  full_body: 'body',
  upper_body: 'barbell',
  lower_body: 'walk',
  chest: 'shield',
  back: 'trending-up',
  shoulders: 'triangle',
  arms: 'fitness',
  core: 'radio-button-on',
  legs: 'footsteps',
  glutes: 'flash',
};

const apiMessage = (e: { kind: string; message: string }) => (e.kind === 'network' ? "Couldn't save. Check your connection and try again." : e.message);

function FocusTile({ option, selected, disabled, onPress }: { option: ProfileOptions['focusAreas'][number]; selected: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={option.label}
      accessibilityHint={disabled ? 'You have reached the limit. Deselect another area first.' : option.description}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, selected && styles.tileSelected, disabled && { opacity: 0.5 }, pressed && { backgroundColor: selected ? colors.primarySoft : colors.cardRaised }]}>
      <View style={[styles.icon, selected && { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={stateIcon(FOCUS_ICONS[option.key], selected)} size={20} color={selected ? colors.primary : colors.textMuted} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong" color={selected ? colors.text : undefined}>
          {option.label}
        </AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {option.description}
        </AppText>
      </View>
      <Ionicons name={stateIcon('checkmark-circle', selected)} size={18} color={selected ? colors.primary : colors.textFaint} />
    </Pressable>
  );
}

export function FocusSection({ me, catalog, submitLabel, onSaved }: SectionProps) {
  const save = usePatchProfile();
  const saved = me.profile?.focusAreas ?? [];
  const [selected, setSelected] = useState<string[]>(saved);
  const [error, setError] = useState<string | null>(null);
  const max = catalog.limits.focusAreasMax;
  const full = selected.length >= max && !selected.includes('full_body');
  const groups = [
    { title: 'Whole areas', options: catalog.focusAreas.filter((a) => a.group === 'broad') },
    { title: 'Specific muscles', options: catalog.focusAreas.filter((a) => a.group === 'specific') },
  ];

  const submit = () => {
    setError(null);
    // Nothing picked: keep whatever was saved before, or stay on full body.
    const areas = (selected.length > 0 ? selected : saved.length > 0 ? ['full_body'] : []) as FocusArea[];
    if (areas.length === 0 || (areas.length === saved.length && areas.every((a) => saved.includes(a)))) return onSaved();
    save.mutate({ focusAreas: areas }, { onSuccess: onSaved, onError: (e) => setError(apiMessage(e)) });
  };

  return (
    <View style={{ gap: space.lg }}>
      <AppText variant="caption" color={colors.textMuted}>
        {selected.length === 0 ? `Choose up to ${max}, or skip to keep full-body workouts.` : `${selected.length} of ${max} chosen. Your workouts lean on these and still train the rest of you.`}
      </AppText>
      {groups.map((g) => (
        <View key={g.title} style={{ gap: space.sm }} accessibilityLabel={g.title}>
          <AppText variant="label" color={colors.textMuted}>
            {g.title}
          </AppText>
          <View style={styles.grid}>
            {g.options.map((o) => {
              const on = selected.includes(o.key);
              return <FocusTile key={o.key} option={o} selected={on} disabled={full && !on} onPress={() => setSelected(toggleFocus(selected, o.key, max))} />;
            })}
          </View>
        </View>
      ))}
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      <Button label={selected.length === 0 && saved.length === 0 && submitLabel === 'Continue' ? 'Skip for now' : submitLabel} onPress={submit} loading={save.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: space.sm },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: a11y.minTouch + 20,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...edgeLight,
  },
  tileSelected: { borderColor: colors.primary, borderTopColor: colors.primary, backgroundColor: colors.primarySoft },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cardRaised, alignItems: 'center', justifyContent: 'center' },
});
