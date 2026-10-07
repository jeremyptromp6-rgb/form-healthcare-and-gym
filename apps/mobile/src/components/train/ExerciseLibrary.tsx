import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MUSCLE_LABEL, MUSCLES, MuscleThumb, type Muscle } from '@/components/art/BodyMap';
import { ExerciseArt } from '@/components/art/ExerciseArt';
import { AppText, SearchPill, StateView } from '@/components/ui';
import type { Exercise } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

const DIFFICULTY: Record<string, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

/** Muscles that at least one exercise in the library trains, in the catalogue's order. */
function musclesIn(exercises: Exercise[]): Muscle[] {
  const used = new Set(exercises.flatMap((e) => e.primaryMuscles));
  return MUSCLES.filter((m) => used.has(m));
}

/** The exercise library: search, filter by muscle, and a grid of picture cards. Pure view. */
export function ExerciseLibrary({ exercises, onOpen }: { exercises: Exercise[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const muscles = useMemo(() => musclesIn(exercises), [exercises]);
  const q = query.trim().toLowerCase();
  const shown = exercises.filter(
    (e) => (!muscle || e.primaryMuscles.includes(muscle) || e.secondaryMuscles.includes(muscle)) && (!q || e.name.toLowerCase().includes(q) || e.primaryMuscles.some((m) => m.includes(q))),
  );

  return (
    <View style={{ gap: space.md }}>
      <SearchPill value={query} onChangeText={setQuery} placeholder="Search exercises" label="Search exercises" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }} accessibilityRole="radiogroup" accessibilityLabel="Filter by muscle">
        <FilterChip label="All" selected={muscle === null} onPress={() => setMuscle(null)}>
          <View style={[styles.allIcon, muscle === null && { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="body" size={26} color={muscle === null ? colors.primary : colors.textMuted} />
          </View>
        </FilterChip>
        {muscles.map((m) => (
          <FilterChip key={m} label={MUSCLE_LABEL[m]} selected={muscle === m} onPress={() => setMuscle(muscle === m ? null : m)}>
            <MuscleThumb muscle={m} size={52} active={muscle === m || muscle === null} intensity={muscle === m ? 1 : 0.55} />
          </FilterChip>
        ))}
      </ScrollView>
      <AppText variant="label" color={colors.textMuted}>
        {muscle ? `${MUSCLE_LABEL[muscle]} · ` : 'All exercises · '}
        {shown.length} {shown.length === 1 ? 'exercise' : 'exercises'}
      </AppText>
      {shown.length === 0 ? (
        <StateView kind="empty" compact title="No matches" message="Try another muscle or a different word." />
      ) : (
        <View style={styles.grid}>
          {shown.map((e) => (
            <Pressable
              key={e.id}
              accessibilityRole="button"
              accessibilityLabel={`${e.name}, ${e.primaryMuscles.join(', ')}${e.cameraVerifiable ? ', camera coaching' : ''}`}
              onPress={() => onOpen(e.id)}
              style={({ pressed }) => [styles.card, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
              <View style={styles.cardArt}>
                <ExerciseArt exerciseId={e.id} decorative style={{ height: 104 }} />
                {e.cameraVerifiable ? (
                  <View style={styles.camBadge}>
                    <Ionicons name="videocam" size={12} color={colors.onPrimary} />
                  </View>
                ) : null}
              </View>
              <View style={{ padding: space.sm, gap: 2 }}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {e.name}
                </AppText>
                <AppText variant="caption" color={colors.textMuted} numberOfLines={1} style={{ fontSize: 13 }}>
                  {e.primaryMuscles.map((m) => MUSCLE_LABEL[m as Muscle] ?? m).join(' · ')}
                </AppText>
                <AppText variant="label" color={colors.textFaint} style={{ fontSize: 11 }}>
                  {DIFFICULTY[e.difficulty] ?? e.difficulty}
                </AppText>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function FilterChip({ label, selected, onPress, children }: { label: string; selected: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected }} aria-checked={selected} onPress={onPress} style={{ alignItems: 'center', gap: 4, width: 64 }}>
      <View style={[styles.ring, selected && styles.ringOn]}>
        {children}
        {selected ? (
          <View style={styles.check}>
            <Ionicons name="checkmark" size={11} color={colors.onPrimary} />
          </View>
        ) : null}
      </View>
      <AppText variant="label" color={selected ? colors.text : colors.textMuted} numberOfLines={1} style={{ fontSize: 12 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  card: { flexBasis: '47%', flexGrow: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderTopColor: colors.edge },
  cardArt: { height: 116, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardRaised },
  camBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.water, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  ringOn: { borderColor: colors.primary },
  check: { position: 'absolute', top: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  allIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.cardRaised, alignItems: 'center', justifyContent: 'center' },
});
