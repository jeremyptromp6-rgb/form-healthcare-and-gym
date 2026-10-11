import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { BodyMap, MUSCLES, MuscleThumb } from '@/components/art/BodyMap';
import { Buddy, BUDDY_MOODS } from '@/components/art/Buddy';
import { ExerciseArt, ExerciseThumb, ILLUSTRATED_EXERCISES } from '@/components/art/ExerciseArt';
import { MealArt } from '@/components/art/MealArt';
import { RANK_ORDER, RankEmblem } from '@/components/art/RankEmblem';
import { FormMark, ProgressArt, RingsArt, TrophyArt, WelcomeArt } from '@/components/art/SceneArt';
import { STATE_ART_KINDS, StateArt } from '@/components/art/StateArt';
import { AppText } from '@/components/ui';
import type { ArtTone } from '@/theme/artPalette';
import { allGradients, palettes, scheme, space } from '@/theme/tokens';

/**
 * Development only (not reachable in production builds): the illustrations on one page, for reviewing
 * the art. Everything is a section in the SECTIONS registry:
 *
 *   ?section=<key>                 one section (keys below)
 *   ?tone=light|dark|both          the tone to draw in (default: the app's scheme); `both` shows the
 *                                  light and dark panels side by side
 *   ?page=1..4                     the old pages: 1-2 exercises, 3 ranks/meals/scenes, 4 Pip and the body map
 *
 * Every piece takes `tone`, so `?tone=both` shows light and dark side by side.
 */

interface Section {
  key: string;
  title: string;
  render: (tone: ArtTone) => ReactNode;
}

const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

const wrap = { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'flex-end' } as const;

function Cell({ tone, label, children }: { tone: ArtTone; label: string; children: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      {children}
      <AppText variant="caption" color={palettes[tone].textMuted}>
        {label}
      </AppText>
    </View>
  );
}

function exerciseCards(tone: ArtTone, ids: readonly string[]): ReactNode {
  return ids.map((id) => (
    <View key={id} style={{ backgroundColor: palettes[tone].cardRaised, borderRadius: 16, padding: 6, gap: 2 }}>
      <ExerciseArt exerciseId={id} name={id} tone={tone} style={{ height: 180 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <ExerciseThumb exerciseId={id} size={52} tone={tone} />
        <ExerciseThumb exerciseId={id} size={40} tone={tone} />
        <AppText variant="caption" color={palettes[tone].textMuted}>
          {id}
        </AppText>
      </View>
    </View>
  ));
}

const SECTIONS: Section[] = [
  {
    key: 'pip',
    title: 'Pip: all nine moods, at hero size and at 44',
    render: (tone) => (
      <View style={wrap}>
        {BUDDY_MOODS.map((m) => (
          <Cell key={m} tone={tone} label={m}>
            <Buddy mood={m} size={150} tone={tone} float={false} />
            <Buddy mood={m} size={44} tone={tone} float={false} />
          </Cell>
        ))}
      </View>
    ),
  },
  {
    key: 'states',
    title: 'State art: every kind, at 88 and 64',
    render: (tone) => (
      <View style={wrap}>
        {STATE_ART_KINDS.map((k) => (
          <Cell key={k} tone={tone} label={k}>
            <StateArt kind={k} size={150} tone={tone} />
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
              <StateArt kind={k} size={88} tone={tone} />
              <StateArt kind={k} size={64} tone={tone} />
            </View>
          </Cell>
        ))}
      </View>
    ),
  },
  {
    key: 'ranks',
    title: 'Rank emblems: every rank at 100, 44 and 38, then the same ranks not reached yet',
    render: (tone) => (
      <View style={{ gap: space.md }}>
        {[false, true].map((locked) => (
          <View key={String(locked)} style={wrap}>
            {RANK_ORDER.map((r) => (
              <Cell key={r} tone={tone} label={locked ? `${r} (locked)` : r}>
                <RankEmblem rank={r} size={100} tone={tone} locked={locked} />
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
                  <RankEmblem rank={r} size={44} tone={tone} locked={locked} />
                  <RankEmblem rank={r} size={38} tone={tone} locked={locked} />
                </View>
              </Cell>
            ))}
          </View>
        ))}
      </View>
    ),
  },
  {
    key: 'meals',
    title: 'Meals: both dishes of every slot at 120, 56 and 32, and the trophy',
    render: (tone) => (
      <View style={{ gap: space.md }}>
        <View style={wrap}>
          {MEAL_KINDS.flatMap((k) =>
            [0, 1].map((v) => (
              <Cell key={`${k}${v}`} tone={tone} label={`${k} ${v}`}>
                <MealArt kind={k} variant={v} size={120} tone={tone} />
                <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
                  <MealArt kind={k} variant={v} size={56} tone={tone} />
                  <MealArt kind={k} variant={v} size={32} tone={tone} />
                </View>
              </Cell>
            )),
          )}
        </View>
        <View style={wrap}>
          <TrophyArt size={80} tone={tone} />
          <FormMark size={64} tone={tone} />
        </View>
      </View>
    ),
  },
  {
    key: 'scenes',
    title: 'Scenes: Home, Progress and Welcome heroes at the sizes they are used, the trophy and the FORM mark',
    render: (tone) => {
      // `corner` shows the art the way the level card does: a small box in the top-right corner, faded.
      const hero = (label: string, w: number, h: number, art: ReactNode, corner = false) => (
        <Cell key={label} tone={tone} label={`${label} ${w}x${h}`}>
          <LinearGradient colors={allGradients[tone].heroMedia} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ width: w, height: h, borderRadius: 20, overflow: 'hidden' }}>
            <View style={corner ? { position: 'absolute', top: 0, right: 0, width: 170, height: 120, opacity: 0.6 } : { position: 'absolute', inset: 0 }}>{art}</View>
          </LinearGradient>
        </Cell>
      );
      return (
        <View style={{ gap: space.md }}>
          <View style={wrap}>
            {hero('Home hero', 340, 280, <RingsArt tone={tone} style={{ flex: 1 }} />)}
            {hero('Home hero, short', 340, 220, <RingsArt tone={tone} style={{ flex: 1 }} />)}
            {hero('Welcome, wide screen', 340, 236, <WelcomeArt tone={tone} style={{ flex: 1 }} />)}
            {hero('Progress level card, at 0.6', 340, 150, <ProgressArt tone={tone} style={{ flex: 1 }} />, true)}
          </View>
          <View style={wrap}>
            <Cell tone={tone} label="trophy 96">
              <TrophyArt size={96} tone={tone} />
            </Cell>
            <Cell tone={tone} label="trophy 64">
              <TrophyArt size={64} tone={tone} />
            </Cell>
            <Cell tone={tone} label="FORM mark 64">
              <FormMark size={64} tone={tone} />
            </Cell>
            <Cell tone={tone} label="FORM mark 38">
              <FormMark size={38} tone={tone} />
            </Cell>
          </View>
        </View>
      );
    },
  },
  {
    key: 'body',
    title: 'Muscle thumbs (lit, softer, off) and body maps (heat, primary and secondary, small)',
    render: (tone) => (
      <View style={{ gap: space.md }}>
        <View style={wrap}>
          {MUSCLES.map((m) => (
            <MuscleThumb key={m} muscle={m} size={64} tone={tone} />
          ))}
        </View>
        <View style={wrap}>
          {MUSCLES.map((m) => (
            <MuscleThumb key={m} muscle={m} size={32} tone={tone} intensity={0.55} />
          ))}
          {MUSCLES.slice(0, 4).map((m) => (
            <MuscleThumb key={`off${m}`} muscle={m} size={44} tone={tone} active={false} />
          ))}
        </View>
        <View style={wrap}>
          <BodyMap tone={tone} heat={{ chest: 1, triceps: 0.6, quads: 0.8, glutes: 0.5, back: 0.3, core: 0.9, shoulders: 0.25 }} />
          <BodyMap tone={tone} primary={['chest', 'triceps']} secondary={['shoulders', 'core']} />
          <BodyMap tone={tone} primary={['quads', 'glutes']} secondary={['hamstrings', 'core']} />
          <BodyMap tone={tone} primary={['lats', 'back']} secondary={['biceps']} />
          <BodyMap tone={tone} primary={['hamstrings', 'glutes', 'back']} secondary={['calves']} height={170} />
        </View>
      </View>
    ),
  },
  {
    key: 'exercises',
    title: 'Exercise illustrations',
    render: (tone) => <View style={wrap}>{exerciseCards(tone, [...ILLUSTRATED_EXERCISES, 'not_drawn_yet'])}</View>,
  },
];

const bySection = (key: string) => SECTIONS.find((s) => s.key === key);

/** The old `?page=` numbers, as lists of sections (pages 1 and 2 are slices of the exercises). */
function pageSections(page: number): Section[] {
  if (page === 4) return ['pip', 'body'].map((k) => bySection(k)!);
  if (page === 3) return ['ranks', 'meals', 'scenes'].map((k) => bySection(k)!);
  const ids = ILLUSTRATED_EXERCISES.slice((page - 1) * 8, page * 8);
  return [{ key: `exercises-${page}`, title: `Exercise illustrations, page ${page}`, render: (tone) => <View style={wrap}>{exerciseCards(tone, ids)}</View> }];
}

function Panel({ tone, sections }: { tone: ArtTone; sections: Section[] }) {
  return (
    <View style={{ flex: 1, backgroundColor: palettes[tone].card, borderRadius: 20, padding: space.md, gap: space.lg }}>
      {sections.map((s) => (
        <View key={s.key} style={{ gap: space.sm }}>
          <AppText variant="label" color={palettes[tone].textFaint}>
            {s.title}
          </AppText>
          {s.render(tone)}
        </View>
      ))}
    </View>
  );
}

/** The art gallery route. */
export default function ArtGallery() {
  const { page, section, tone } = useLocalSearchParams<{ page?: string; section?: string; tone?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  const tones: ArtTone[] = tone === 'both' ? ['light', 'dark'] : tone === 'light' || tone === 'dark' ? [tone] : [scheme];
  const found = section ? bySection(section) : undefined;
  const sections = found ? [found] : section ? [] : pageSections(Math.max(1, Number(page ?? 1)));
  return (
    <ScrollView style={{ flex: 1, backgroundColor: palettes[tones[0]!].bg }} contentContainerStyle={{ padding: space.md, gap: space.md }}>
      {section && !found ? <AppText variant="body">{`Unknown section "${section}". Sections: ${SECTIONS.map((s) => s.key).join(', ')}.`}</AppText> : null}
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
        {tones.map((t) => (
          <Panel key={t} tone={t} sections={sections} />
        ))}
      </View>
    </ScrollView>
  );
}
