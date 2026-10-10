import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { MUSCLE_LABEL, MUSCLES, MuscleThumb, type Muscle } from '@/components/art/BodyMap';
import { AppText, ExerciseList, ExerciseRow, FilterChipRow, SearchPill, StateView, type FilterOption } from '@/components/ui';
import type { Exercise, Experience } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

const LEVELS: Experience[] = ['beginner', 'intermediate', 'advanced'];
const BODYWEIGHT = 'bodyweight';

/** "cable_machine" -> "Cable machine". */
const humanize = (token: string) => {
  const t = token.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const muscleLabel = (m: string) => MUSCLE_LABEL[m as Muscle] ?? humanize(m);

/** An alternative with no equipment, or one that names bodyweight, needs nothing from the gym. */
const isBodyweightAlt = (alt: string[]) => alt.length === 0 || alt.some((t) => t.toLowerCase() === BODYWEIGHT);
/** Does any of the exercise's equipment alternatives use this token (or, for bodyweight, none)? */
const usesEquipment = (e: Exercise, token: string) =>
  e.equipment.some((alt) => (token === BODYWEIGHT ? isBodyweightAlt(alt) : alt.some((t) => t.toLowerCase() === token)));
/** The first alternative, spelled out: "Barbell + Squat rack", or "Bodyweight". */
const mainEquipment = (e: Exercise) => {
  const alt = e.equipment[0];
  return !alt || isBodyweightAlt(alt) ? 'Bodyweight' : alt.map(humanize).join(' + ');
};

/** Muscles that at least one exercise in the library trains, in the catalogue's order. */
function musclesIn(exercises: Exercise[]): Muscle[] {
  const used = new Set(exercises.flatMap((e) => e.primaryMuscles));
  return MUSCLES.filter((m) => used.has(m));
}

/** Equipment named by the library's real data: Bodyweight first, then A to Z. */
function equipmentIn(exercises: Exercise[]): FilterOption<string>[] {
  const tokens = new Set<string>();
  let bodyweight = false;
  for (const e of exercises) {
    for (const alt of e.equipment) {
      if (isBodyweightAlt(alt)) bodyweight = true;
      for (const t of alt) if (t.toLowerCase() !== BODYWEIGHT) tokens.add(t.toLowerCase());
    }
  }
  const rest = [...tokens].sort().map((t) => ({ value: t, label: humanize(t) }));
  return bodyweight ? [{ value: BODYWEIGHT, label: 'Bodyweight' }, ...rest] : rest;
}

/** The exercise library: search, filter by muscle, equipment and level, and a dense list. Pure view. */
export function ExerciseLibrary({ exercises, onOpen }: { exercises: Exercise[]; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<Muscle | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [level, setLevel] = useState<Experience | null>(null);
  const muscles = useMemo(() => musclesIn(exercises), [exercises]);
  const equipmentOptions = useMemo(() => equipmentIn(exercises), [exercises]);
  const levelOptions = useMemo<FilterOption<Experience>[]>(() => {
    const have = new Set(exercises.map((e) => e.difficulty));
    return LEVELS.filter((l) => have.has(l)).map((l) => ({ value: l, label: humanize(l) }));
  }, [exercises]);
  const q = query.trim().toLowerCase();
  const shown = exercises.filter(
    (e) =>
      (!muscle || e.primaryMuscles.includes(muscle) || e.secondaryMuscles.includes(muscle)) &&
      (!equipment || usesEquipment(e, equipment)) &&
      (!level || e.difficulty === level) &&
      (!q || e.name.toLowerCase().includes(q) || e.primaryMuscles.some((m) => m.includes(q))),
  );

  const activeFilters = [
    equipment ? (equipmentOptions.find((o) => o.value === equipment)?.label ?? humanize(equipment)) : null,
    level ? humanize(level) : null,
  ].filter((l): l is string => l !== null);
  const anyActive = q !== '' || muscle !== null || equipment !== null || level !== null;
  const clearFilters = () => {
    setQuery('');
    setMuscle(null);
    setEquipment(null);
    setLevel(null);
  };
  // "All exercises" only when nothing narrows the list by muscle, equipment or level.
  const heading = muscle ? MUSCLE_LABEL[muscle] : activeFilters.length > 0 ? 'Filtered' : 'All exercises';

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
      {equipmentOptions.length > 0 ? <FilterChipRow label="Filter by equipment" options={equipmentOptions} value={equipment} onChange={setEquipment} /> : null}
      {levelOptions.length > 0 ? <FilterChipRow label="Filter by level" options={levelOptions} value={level} onChange={setLevel} /> : null}
      <AppText variant="label" color={colors.textMuted}>
        {heading} · {shown.length} {shown.length === 1 ? 'exercise' : 'exercises'}
      </AppText>
      {activeFilters.length > 0 ? (
        <AppText variant="caption" color={colors.textFaint} style={{ marginTop: -space.sm }}>
          Filters: {activeFilters.join(' · ')}
        </AppText>
      ) : null}
      {shown.length === 0 ? (
        <StateView
          kind="empty"
          compact
          title="No matches"
          message="Try other filters or a different word."
          actionLabel={anyActive ? 'Clear filters' : undefined}
          onAction={anyActive ? clearFilters : undefined}
        />
      ) : (
        <ExerciseList>
          {shown.map((e) => {
            const muscleText = e.primaryMuscles.map(muscleLabel).join(' · ');
            const levelText = humanize(e.difficulty);
            const gear = mainEquipment(e);
            return (
              <ExerciseRow
                key={e.id}
                exerciseId={e.id}
                name={e.name}
                detail={muscleText}
                meta={`${levelText} · ${gear}`}
                metaIcon="barbell-outline"
                cameraVerifiable={e.cameraVerifiable}
                accessibilityLabel={`${e.name}, ${muscleText}, ${levelText}, ${gear}${e.cameraVerifiable ? ', camera coaching' : ''}`}
                onPress={() => onOpen(e.id)}
              />
            );
          })}
        </ExerciseList>
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
  ring: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  ringOn: { borderColor: colors.primary },
  check: { position: 'absolute', top: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  allIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.cardRaised, alignItems: 'center', justifyContent: 'center' },
});
