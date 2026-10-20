import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Image, PanResponder, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { AppText, Card, Segmented, StateView } from '@/components/ui';
import { photosOfPose, photoUri, POSE_LABEL, POSES, PRIVACY_COPY, type PhotoPose, type ProgressPhoto } from '@/lib/progressPhotos';
import type { Units } from '@/lib/units';
import { a11y, colors, radius, space } from '@/theme/tokens';
import { PHOTO_ASPECT, PhotoImage, photoCaption, photoLabel, PrivacyNote } from './PhotoPieces';
import { clampFraction, defaultPair, fractionFromX, sliderValueText, stepFraction } from './compareMath';
import { shortDate } from './timeline';

type Mode = 'slider' | 'side';

const HANDLE = a11y.minTouch;

/**
 * Before and after in one frame: the "before" photo is shown left of the line, the "after" right of
 * it. Drag the handle (or use the screen reader's adjust gestures) to move the line. The page still
 * scrolls everywhere else, because only the handle takes the touch.
 */
export function BeforeAfterSlider({ before, after, units, initial = 0.5 }: { before: ProgressPhoto; after: ProgressPhoto; units: Units; initial?: number }) {
  const [width, setWidth] = useState(0);
  const [fraction, setFraction] = useState(clampFraction(initial));
  // The pan handlers are created once, so they read the live width and position from this ref (only inside events).
  const live = useRef({ width: 0, fraction: clampFraction(initial), startX: 0 });
  const move = (f: number) => {
    live.current.fraction = f;
    setFraction(f);
  };
  // The handlers only touch the ref when a touch event fires, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        live.current.startX = live.current.fraction * live.current.width;
      },
      onPanResponderMove: (_e, g) => {
        live.current.fraction = fractionFromX(live.current.startX + g.dx, live.current.width);
        setFraction(live.current.fraction);
      },
    }),
  );

  const onLayout = (e: LayoutChangeEvent) => {
    live.current.width = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };
  const split = fraction * width;

  return (
    <View style={{ gap: space.sm }}>
      <View testID="compare-frame" onLayout={onLayout} style={{ aspectRatio: PHOTO_ASPECT, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.cardRaised }}>
        <PhotoImage photo={after} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: split, overflow: 'hidden' }}>
          <Image source={{ uri: photoUri(before) }} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width }} resizeMode="cover" accessibilityIgnoresInvertColors importantForAccessibility="no" />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: split - 1, top: 0, bottom: 0, width: 2, backgroundColor: '#FFFFFF' }} />
        <View
          {...pan.panHandlers}
          testID="compare-handle"
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Before and after slider"
          accessibilityHint="Swipe up or down to move the line between the before and after photos"
          accessibilityValue={{ text: sliderValueText(fraction) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => move(stepFraction(live.current.fraction, e.nativeEvent.actionName === 'increment' ? 1 : -1))}
          style={{ position: 'absolute', left: split - HANDLE / 2, top: 0, bottom: 0, width: HANDLE, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: HANDLE - 8, height: HANDLE - 8, borderRadius: radius.pill, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.primary }}>
            <Ionicons name="swap-horizontal" size={20} color={colors.primaryDeep} />
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <AppText variant="label" color={colors.textFaint}>
            Before
          </AppText>
          <AppText variant="caption">{photoCaption(before, units)}</AppText>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <AppText variant="label" color={colors.textFaint}>
            After
          </AppText>
          <AppText variant="caption">{photoCaption(after, units)}</AppText>
        </View>
      </View>
    </View>
  );
}

function SideBySide({ before, after, units }: { before: ProgressPhoto; after: ProgressPhoto; units: Units }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      {[
        { label: 'Before', photo: before },
        { label: 'After', photo: after },
      ].map(({ label, photo }) => (
        <View key={label} style={{ flex: 1, gap: space.xs }}>
          <View accessible accessibilityLabel={`${label}: ${photoLabel(photo, units)}`} style={{ aspectRatio: PHOTO_ASPECT, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.cardRaised }}>
            <PhotoImage photo={photo} />
          </View>
          <AppText variant="label" color={colors.textFaint}>
            {label}
          </AppText>
          <AppText variant="caption">{photoCaption(photo, units)}</AppText>
        </View>
      ))}
    </View>
  );
}

/** One row of dates to pick a photo from (the photos are all of one pose). */
function PhotoPicker({ label, photos, value, onChange }: { label: string; photos: ProgressPhoto[]; value: string; onChange: (id: string) => void }) {
  return (
    <View style={{ gap: space.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <AppText variant="label" color={colors.textMuted}>
        {label}
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {photos.map((p) => {
          const on = p.id === value;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityLabel={shortDate(p.date)}
              accessibilityState={{ checked: on }}
              aria-checked={on}
              onPress={() => onChange(p.id)}
              style={{ minHeight: a11y.minTouch, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colors.primary : colors.borderStrong, backgroundColor: on ? colors.primarySoft : colors.card }}>
              <AppText variant={on ? 'bodyStrong' : 'body'}>{shortDate(p.date)}</AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Compare two photos of one pose: oldest and newest to start, then any two; a slider or side by side. */
export function CompareView({ photos, units }: { photos: ProgressPhoto[]; units: Units }) {
  const [pose, setPose] = useState<PhotoPose>(() => POSES.find((p) => defaultPair(photos, p)) ?? 'front');
  const [mode, setMode] = useState<Mode>('slider');
  // Picks are remembered per pose; an unset pick falls back to the oldest / newest.
  const [picks, setPicks] = useState<Partial<Record<PhotoPose, { before?: string; after?: string }>>>({});

  const ofPose = photosOfPose(photos, pose);
  const fallback = defaultPair(photos, pose);
  const find = (id: string | undefined) => ofPose.find((p) => p.id === id);
  const before = find(picks[pose]?.before) ?? fallback?.before ?? null;
  const after = find(picks[pose]?.after) ?? fallback?.after ?? null;
  const pick = (side: 'before' | 'after') => (id: string) => setPicks((s) => ({ ...s, [pose]: { ...s[pose], [side]: id } }));

  return (
    <>
      <Card style={{ gap: space.md }}>
        <PrivacyNote text={PRIVACY_COPY} />
        <Segmented<PhotoPose> label="Pose" options={POSES.map((p) => ({ value: p, label: POSE_LABEL[p] }))} value={pose} onChange={setPose} />
      </Card>

      {!before || !after ? (
        <StateView kind="empty" compact title="Two photos needed" message={`Take at least two ${POSE_LABEL[pose].toLowerCase()} photos to compare them. Try another pose if you have more of those.`} />
      ) : (
        <>
          <Segmented<Mode>
            label="View"
            options={[
              { value: 'slider', label: 'Slider' },
              { value: 'side', label: 'Side by side' },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'slider' ? <BeforeAfterSlider key={`${before.id}:${after.id}`} before={before} after={after} units={units} /> : <SideBySide before={before} after={after} units={units} />}
          <Card style={{ gap: space.md }}>
            <PhotoPicker label="Before photo" photos={ofPose} value={before.id} onChange={pick('before')} />
            <PhotoPicker label="After photo" photos={ofPose} value={after.id} onChange={pick('after')} />
          </Card>
        </>
      )}
    </>
  );
}
