import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { AppText, Card, Row, SectionHeader } from '@/components/ui';
import type { BodyQuest } from '@/lib/types';
import { colors, space } from '@/theme/tokens';
import { BodyQuestHistory, NextStageCard, STAGE_INFO, StageTrack, StatList } from './RecognitionViews';

/** Body Quest in full: where you are, what each stat measures, what's next, and how it has changed. */
export function BodyQuestView({ bodyQuest: bq }: { bodyQuest: BodyQuest }) {
  const info = STAGE_INFO[bq.stage];
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.lg, paddingVertical: space.xl }}>
        <Row gap={space.lg}>
          <View style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: info.color, backgroundColor: `${info.color}1F`, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={info.icon} size={32} color={info.color} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="overline" color={info.color}>
              Stage {['starter', 'foundation', 'builder', 'athlete', 'elite'].indexOf(bq.stage) + 1} of 5
            </AppText>
            <AppText variant="display" header style={{ fontSize: 34, lineHeight: 40 }}>
              {info.label}
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {bq.overall === null ? 'Overall score appears once 3 stats are measured' : `Overall ${bq.overall} of 100`}
            </AppText>
          </View>
        </Row>
        <StageTrack stage={bq.stage} highestStage={bq.highestStage} />
        <AppText variant="body" color={colors.textMuted}>
          {info.blurb}
        </AppText>
        {bq.highestStage !== bq.stage ? (
          <AppText variant="caption" color={colors.textFaint}>
            You&apos;ve reached {STAGE_INFO[bq.highestStage].label} before — consistent training brings it back.
          </AppText>
        ) : null}
      </Card>

      <SectionHeader title="Your stats" />
      <StatList stats={bq.stats} />
      <AppText variant="caption" color={colors.textFaint} style={{ marginTop: -space.sm }}>
        Body Quest measures what your body can do and how you train — never your weight or how you look. Training beyond your plan or through pain doesn&apos;t score higher.
      </AppText>

      {bq.next ? (
        <>
          <SectionHeader title="Next stage" />
          <NextStageCard next={bq.next} />
        </>
      ) : null}

      <SectionHeader title="History" />
      <BodyQuestHistory snapshots={bq.snapshots} />
    </View>
  );
}
