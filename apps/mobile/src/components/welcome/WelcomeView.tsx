import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Buddy } from '@/components/art/Buddy';
import { ExerciseArt } from '@/components/art/ExerciseArt';
import { MealArt } from '@/components/art/MealArt';
import { RANK_ORDER, RankEmblem } from '@/components/art/RankEmblem';
import { FormMark, WelcomeArt } from '@/components/art/SceneArt';
import { EatDayView } from '@/components/eat/EatDayView';
import { HomeView } from '@/components/home/HomeView';
import { LevelHero, RankLadder } from '@/components/progress/ProgressionViews';
import { AppText, BreathingGlow, Button, Row, Screen, type IconName } from '@/components/ui';
import { colors, gradients, radius, shadow, space } from '@/theme/tokens';
import { PhonePreview } from './PhonePreview';
import { SAMPLE_DAY, SAMPLE_HOME, SAMPLE_NOW, SAMPLE_PROGRESS } from './sampleData';

const noop = () => {};

/** One feature: a picture, a title and a sentence, on a softly tinted card. */
function Feature({ tint, icon, title, body, art }: { tint: string; icon: IconName; title: string; body: string; art: ReactNode }) {
  return (
    <View style={[styles.feature, { backgroundColor: `${tint}12`, borderColor: `${tint}30` }]}>
      <View style={styles.featureArt}>{art}</View>
      <Row gap={space.sm}>
        <View style={[styles.featureIcon, { backgroundColor: tint }]}>
          <Ionicons name={icon} size={16} color={colors.onPrimary} />
        </View>
        <AppText variant="heading" header style={{ flex: 1 }}>
          {title}
        </AppText>
      </Row>
      <AppText variant="body" color={colors.textMuted}>
        {body}
      </AppText>
    </View>
  );
}

function PromiseItem({ icon, text }: { icon: IconName; text: string }) {
  return (
    <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
      <View style={[styles.featureIcon, { backgroundColor: colors.successSoft }]}>
        <Ionicons name={icon} size={16} color={colors.success} />
      </View>
      <AppText variant="body" color={colors.textMuted} style={{ flex: 1 }}>
        {text}
      </AppText>
    </Row>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={{ gap: 4, alignItems: 'center' }}>
      <AppText variant="overline" color={colors.primary}>
        {eyebrow}
      </AppText>
      <AppText variant="title" header style={{ textAlign: 'center' }}>
        {title}
      </AppText>
    </View>
  );
}

/**
 * The front door: what FORM is, what it feels like, and a look at the real app — before anyone is
 * asked for an email. Every claim here is something the app actually does.
 */
export function WelcomeView({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) {
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const phoneW = wide ? 250 : Math.min(230, width * 0.6);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        {/* Hero — on phones the scene sits above the words; on wide screens it gets its own panel beside them. */}
        <LinearGradient colors={gradients.heroMedia} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.hero, wide && styles.heroWide]}>
          {wide ? null : (
            <>
              <WelcomeArt style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 260 }} />
              <LinearGradient colors={[`${gradients.heroMedia[2]}00`, gradients.heroMedia[2]]} style={{ position: 'absolute', left: 0, right: 0, top: 200, height: 80 }} />
            </>
          )}
          <View style={[{ gap: space.lg }, wide && { flex: 1, justifyContent: 'center' }]}>
            <Row gap={space.sm} style={{ zIndex: 1 }}>
              <FormMark size={38} />
              <AppText variant="heading" style={{ letterSpacing: 4 }}>
                FORM
              </AppText>
            </Row>
            {wide ? null : (
              <View style={{ alignSelf: 'flex-start', marginTop: 70, marginLeft: space.md - 26, alignItems: 'center', justifyContent: 'center' }}>
                <BreathingGlow size={156} color={colors.accent} style={{ position: 'absolute' }} />
                <Buddy mood="cheer" size={104} />
              </View>
            )}
            <View style={{ gap: space.md, maxWidth: 620 }}>
              <AppText variant="display" header style={{ fontSize: wide ? 50 : 36, lineHeight: wide ? 56 : 42 }}>
                Get stronger, eat well, and enjoy every step.
              </AppText>
              <AppText variant="body" color={colors.textMuted} style={{ fontSize: 17, lineHeight: 25 }}>
                FORM is your cosy companion for training and food. It counts your reps, makes logging meals easy and celebrates the progress you really earn.
              </AppText>
            </View>
            <View style={[styles.ctas, wide && { flexDirection: 'row' }]}>
              <Button label="Get started — it's free" iconRight="arrow-forward" onPress={onGetStarted} style={wide ? { minWidth: 250 } : undefined} />
              <Button label="I already have an account" variant="secondary" onPress={onSignIn} style={wide ? { minWidth: 240 } : undefined} />
            </View>
          </View>
          {wide ? (
            <View style={styles.heroArt}>
              <WelcomeArt style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
              <BreathingGlow size={220} color={colors.accent} style={{ position: 'absolute', left: -8, bottom: 26 }} />
              <Buddy mood="cheer" size={132} style={{ position: 'absolute', left: 36, bottom: 70 }} />
            </View>
          ) : null}
        </LinearGradient>

        {/* Features */}
        <SectionTitle eyebrow="Everything in one place" title="Train, eat and level up" />
        <View style={styles.grid}>
          <Feature
            tint={colors.water}
            icon="videocam"
            title="Every rep counted"
            body="Point your camera and FORM counts each full-range rep and tells you how your form looks — privately, on your phone."
            art={<ExerciseArt exerciseId="push_up" decorative style={{ height: 110 }} />}
          />
          <Feature
            tint={colors.success}
            icon="restaurant"
            title="Meals made simple"
            body="Search, weigh or snap a photo. Clear calories and macros, with estimates always labelled as estimates."
            art={
              <Row gap={space.sm}>
                <MealArt kind="breakfast" size={64} />
                <MealArt kind="dinner" size={78} />
                <MealArt kind="snack" size={58} />
              </Row>
            }
          />
          <Feature
            tint={colors.accent}
            icon="trophy"
            title="Real progress, real ranks"
            body="Earn XP for honest training and climb seven ranks — from Rookie all the way to Champion."
            art={
              <Row gap={4}>
                {(['Starter', 'Iron', 'Elite', 'Champion'] as const).map((r) => (
                  <RankEmblem key={r} rank={r} size={58} />
                ))}
              </Row>
            }
          />
          <Feature
            tint={colors.primary}
            icon="heart"
            title="A plan that fits you"
            body="Workouts built from your goal, equipment and recent sessions — and rest days that never cost you a streak."
            art={<Buddy mood="proud" size={104} float={false} />}
          />
        </View>

        {/* Ranks */}
        <View style={[styles.band, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SectionTitle eyebrow="Your journey" title="Seven ranks to climb" />
          <View style={styles.ranks}>
            {RANK_ORDER.map((r) => (
              <View key={r} style={{ alignItems: 'center', gap: 4, width: wide ? 96 : 76 }}>
                <RankEmblem rank={r} size={wide ? 72 : 56} />
                <AppText variant="label" color={colors.textMuted}>
                  {r}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        {/* A look inside */}
        <SectionTitle eyebrow="A peek inside" title="See how FORM looks" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.phones, wide && { flexGrow: 1, justifyContent: 'center' }]}>
          <PhonePreview width={phoneW} caption="Home — your day at a glance">
            <HomeView vm={SAMPLE_HOME} now={SAMPLE_NOW} onNavigate={noop} onAddWater={noop} onUndoWater={noop} />
          </PhonePreview>
          <PhonePreview width={phoneW} caption="Eat — food, water and macros">
            <Screen title="Eat" subtitle="Monday, October 5">
              <EatDayView day={SAMPLE_DAY} title="Today" onPrev={noop} onNext={null} onAdd={noop} onOpenLog={noop} onAddWater={noop} onScan={noop} scanAvailable onWeighMeal={noop} showScanInfo={false} onSetUpProfile={noop} />
            </Screen>
          </PhonePreview>
          <PhonePreview width={phoneW} caption="Progress — your level and ranks">
            <Screen title="Progress" subtitle="Your journey">
              <LevelHero progress={SAMPLE_PROGRESS} />
              <RankLadder progress={SAMPLE_PROGRESS} />
            </Screen>
          </PhonePreview>
        </ScrollView>

        {/* Promises */}
        <View style={[styles.band, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'stretch' }]}>
          <SectionTitle eyebrow="Private by design" title="Your data stays yours" />
          <View style={{ gap: space.md, maxWidth: 560, alignSelf: 'center' }}>
            <PromiseItem icon="videocam-off" text="Camera coaching runs on your phone. Nothing is recorded or uploaded." />
            <PromiseItem icon="download" text="Export everything, or delete your account and data, whenever you like." />
            <PromiseItem icon="moon" text="Two cosy looks — Morning and Evening — that follow your phone or your choice." />
          </View>
        </View>

        {/* Closing call to action */}
        <LinearGradient colors={gradients.heroMedia} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.closing}>
          <Buddy mood="happy" size={96} />
          <AppText variant="title" header style={{ textAlign: 'center' }}>
            Ready when you are
          </AppText>
          <AppText variant="body" color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 460 }}>
            It takes about a minute to set up. Pip will be waiting.
          </AppText>
          <View style={[styles.ctas, { alignSelf: 'stretch' }, wide && { flexDirection: 'row', justifyContent: 'center' }]}>
            <Button label="Create your account" iconRight="arrow-forward" onPress={onGetStarted} style={wide ? { minWidth: 260 } : undefined} />
            <Button label="Sign in" variant="ghost" onPress={onSignIn} />
          </View>
        </LinearGradient>

        <AppText variant="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
          FORM · Train. Eat. Progress.
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.xxl, paddingBottom: space.xxxl, width: '100%', maxWidth: 1080, alignSelf: 'center' },
  hero: { borderRadius: radius.xl, padding: space.xl, gap: space.lg, overflow: 'hidden', minHeight: 520, borderWidth: 1, borderColor: colors.border, ...shadow.lifted },
  heroWide: { flexDirection: 'row', alignItems: 'stretch', padding: space.xxl, gap: space.xxl, minHeight: 480 },
  heroArt: { width: 420, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.wash },
  ctas: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  feature: { flexGrow: 1, flexBasis: 300, gap: space.sm, padding: space.lg, borderRadius: radius.lg, borderWidth: 1 },
  featureArt: { height: 120, alignItems: 'center', justifyContent: 'center' },
  featureIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  band: { borderRadius: radius.xl, borderWidth: 1, padding: space.xl, gap: space.lg, alignItems: 'center', ...shadow.card },
  ranks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
  phones: { gap: space.lg, paddingHorizontal: space.xs, paddingVertical: space.sm },
  closing: { borderRadius: radius.xl, padding: space.xl, gap: space.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
});
