import { Redirect, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { BodyMap, MUSCLES, MuscleThumb } from '@/components/art/BodyMap';
import { Buddy } from '@/components/art/Buddy';
import { ExerciseArt, ILLUSTRATED_EXERCISES } from '@/components/art/ExerciseArt';
import { MealArt } from '@/components/art/MealArt';
import { RANK_ORDER, RankEmblem } from '@/components/art/RankEmblem';
import { FormMark, ProgressArt, RingsArt, TrophyArt, WelcomeArt } from '@/components/art/SceneArt';
import { AppText } from '@/components/ui';
import { colors, space } from '@/theme/tokens';

/** Development only: the illustrations on one page (8 per page: ?page=1, 2), for reviewing the art. Not reachable in production builds. */
export default function ArtGallery() {
  const { page } = useLocalSearchParams<{ page?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  const p = Math.max(1, Number(page ?? 1));
  const ids = ILLUSTRATED_EXERCISES.slice((p - 1) * 8, p * 8);
  if (p === 4) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.md, flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {(['happy', 'cheer', 'sleepy', 'proud'] as const).map((m) => (
          <Buddy key={m} mood={m} size={150} />
        ))}
        {MUSCLES.map((m) => (
          <MuscleThumb key={m} muscle={m} size={64} />
        ))}
        <BodyMap heat={{ chest: 1, triceps: 0.6, quads: 0.8, glutes: 0.5, back: 0.3 }} />
        <BodyMap primary={['chest', 'triceps']} secondary={['shoulders', 'core']} />
        <BodyMap primary={['quads', 'glutes']} secondary={['hamstrings', 'core']} />
        <BodyMap primary={['lats', 'back']} secondary={['biceps']} />
        <BodyMap primary={['hamstrings', 'glutes', 'back']} secondary={['calves']} />
      </ScrollView>
    );
  }
  if (p === 3) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.md, gap: space.md }}>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {RANK_ORDER.map((r) => (
            <View key={r} style={{ alignItems: 'center', gap: 4 }}>
              <RankEmblem rank={r} size={84} />
              <AppText variant="caption">{r}</AppText>
            </View>
          ))}
          <RankEmblem rank="Master" size={84} locked />
        </View>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((k) => (
            <MealArt key={k} kind={k} size={80} />
          ))}
          <TrophyArt size={80} />
          <FormMark size={64} />
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {[RingsArt, ProgressArt, WelcomeArt].map((A, i) => (
            <View
              key={i}
              style={{
                width: 300,
                height: 180,
                backgroundColor: colors.card,
                borderRadius: 20,
                overflow: 'hidden',
              }}>
              <A style={{ position: 'absolute', inset: 0 }} />
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.md,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: space.sm,
      }}>
      {ids.map((id) => (
        <View
          key={id}
          style={{
            backgroundColor: colors.card,
            borderRadius: 16,
            padding: 6,
            gap: 2,
          }}>
          <ExerciseArt exerciseId={id} name={id} style={{ height: 180 }} />
          <AppText variant="caption" color={colors.textMuted}>
            {id}
          </AppText>
        </View>
      ))}
    </ScrollView>
  );
}
