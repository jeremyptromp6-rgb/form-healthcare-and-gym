import { Redirect, useLocalSearchParams } from 'expo-router';
import { EatDayView } from '@/components/eat/EatDayView';
import SignIn from './sign-in';
import Welcome from './welcome';
import { HomeView } from '@/components/home/HomeView';
import { LevelHero, RankLadder } from '@/components/progress/ProgressionViews';
import { Screen } from '@/components/ui';
import { SAMPLE_DAY as DAY, SAMPLE_HOME as HOME, SAMPLE_NOW as NOW, SAMPLE_PROGRESS as PROGRESS } from '@/components/welcome/sampleData';

/**
 * Development only: real screens rendered with sample data (no account, no server), for reviewing
 * the visual design. ?screen=home | eat | progress | signin | welcome. Not reachable in production builds.
 */

const noop = () => {};

export default function DesignPreview() {
  const { screen } = useLocalSearchParams<{ screen?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  if (screen === 'signin') return <SignIn />;
  if (screen === 'welcome') return <Welcome />;
  if (screen === 'eat') {
    return (
      <Screen title="Eat" subtitle="Monday, October 5">
        <EatDayView day={DAY} title="Today" onPrev={noop} onNext={null} onAdd={noop} onOpenLog={noop} onAddWater={noop} onScan={noop} scanAvailable onWeighMeal={noop} showScanInfo={false} onSetUpProfile={noop} />
      </Screen>
    );
  }
  if (screen === 'progress') {
    return (
      <Screen title="Progress" subtitle="Your journey">
        <LevelHero progress={PROGRESS} />
        <RankLadder progress={PROGRESS} />
      </Screen>
    );
  }
  return <HomeView vm={HOME} now={NOW} onNavigate={noop} onAddWater={noop} onUndoWater={noop} />;
}
