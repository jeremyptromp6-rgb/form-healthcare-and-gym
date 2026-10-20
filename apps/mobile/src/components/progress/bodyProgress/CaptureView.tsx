import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Image, Linking, View } from 'react-native';
import { AppText, Button, Card, InlineMessage, Row, Segmented, StateView, Toggle } from '@/components/ui';
import { discardTemp } from '@/lib/privateFiles';
import { prepareProgressPhoto } from '@/lib/progressPhotoImage';
import { addProgressPhoto, latestOfPose, photoUri, POSE_LABEL, POSES, PRIVACY_COPY, progressPhotosSupported, type PhotoPose, type ProgressPhoto } from '@/lib/progressPhotos';
import { colors, radius, space } from '@/theme/tokens';
import { PHOTO_ASPECT, PrivacyNote } from './PhotoPieces';
import { shortDate } from './timeline';

/** How strongly the previous photo shows through the live camera. */
export const GHOST_OPACITY = 0.3;
export const TIMER_SECONDS = 3;

type Phase = 'live' | 'countdown' | 'taking' | 'review' | 'saving' | 'saved';
type Shot = { uri: string; width?: number; height?: number };

/**
 * Take a body progress photo. A faint "ghost" of the last photo of the same pose sits over the
 * camera so the user can line up the same way; an optional 3-second timer leaves time to step back.
 * After the shot: Save (resized, stored privately on this phone) or Retake. Nothing goes to the
 * gallery or the network.
 */
export function CaptureView({ photos, date, weightKg, onDone }: { photos: ProgressPhoto[]; date: string; weightKg: number | null; onDone: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [pose, setPose] = useState<PhotoPose>('front');
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [ghostOn, setGhostOn] = useState(true);
  const [timerOn, setTimerOn] = useState(false);
  const [phase, setPhase] = useState<Phase>('live');
  const [count, setCount] = useState(TIMER_SECONDS);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A shot that was never saved is a temporary file: remove it if the user walks away.
  const unsaved = useRef<string | null>(null);
  useEffect(() => () => discardTemp(unsaved.current), []);

  const previous = latestOfPose(photos, pose);

  const snap = async () => {
    setPhase('taking');
    setProblem(null);
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 1, exif: false, shutterSound: false });
      if (!picture?.uri) throw new Error('No picture');
      unsaved.current = picture.uri;
      setShot({ uri: picture.uri, width: picture.width, height: picture.height });
      setPhase('review');
    } catch {
      setProblem("The camera couldn't take that photo. Try again.");
      setPhase('live');
    }
  };

  // The self-timer: 3, 2, 1 a second apart, then the shot.
  useEffect(() => {
    if (phase !== 'countdown') return;
    const t = setTimeout(() => {
      if (count <= 1) void snap();
      else setCount((c) => c - 1);
    }, 1000);
    return () => clearTimeout(t);
    // snap only reads refs and setters.
  }, [phase, count]);

  const shutter = () => {
    if (timerOn) {
      setCount(TIMER_SECONDS);
      setPhase('countdown');
    } else {
      void snap();
    }
  };

  const retake = () => {
    discardTemp(unsaved.current);
    unsaved.current = null;
    setShot(null);
    setProblem(null);
    setReady(false); // the camera view is mounted afresh
    setPhase('live');
  };

  const save = async () => {
    if (!shot) return;
    setPhase('saving');
    setProblem(null);
    try {
      const prepared = await prepareProgressPhoto(shot);
      unsaved.current = null; // prepareProgressPhoto removed the camera's file
      await addProgressPhoto({ sourceUri: prepared.uri, pose, date, weightKg });
      setShot(null);
      setPhase('saved');
    } catch {
      unsaved.current = null;
      setShot(null);
      setReady(false);
      setProblem("That photo couldn't be saved. Check there's space on your phone, then take it again.");
      setPhase('live');
    }
  };

  if (!progressPhotosSupported()) {
    return <StateView kind="unavailable" title="Progress photos are for the phone app" message="They are kept privately on your phone, so there is nothing to take or see here on the web." />;
  }
  if (!permission) return <StateView kind="loading" compact />;
  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <Card style={{ gap: space.md }}>
        <PrivacyNote text={PRIVACY_COPY} />
        <StateView
          kind="permission"
          compact
          title={blocked ? 'Camera access is off' : 'Use your camera for progress photos'}
          message={blocked ? 'Allow camera access in Settings to take a progress photo.' : 'FORM uses the camera only while you are on this screen. Photos are saved on this phone and nowhere else.'}
          actionLabel={blocked ? 'Open Settings' : 'Allow camera'}
          onAction={blocked ? () => void Linking.openSettings() : () => void requestPermission()}
        />
      </Card>
    );
  }

  if (phase === 'saved') {
    return (
      <Card style={{ gap: space.md }}>
        <InlineMessage tone="success">{`Saved: ${POSE_LABEL[pose]} photo, ${shortDate(date)}. It is on this phone only.`}</InlineMessage>
        <Button label="Take another" icon="camera-outline" variant="secondary" onPress={retake} />
        <Button label="Done" onPress={onDone} />
      </Card>
    );
  }

  if (phase === 'review' || phase === 'saving') {
    const busy = phase === 'saving';
    return (
      <>
        <View style={{ aspectRatio: PHOTO_ASPECT, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.cardRaised }}>
          {shot ? <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityLabel={`Preview of your ${POSE_LABEL[pose].toLowerCase()} photo`} /> : null}
        </View>
        {problem ? <InlineMessage tone="danger">{problem}</InlineMessage> : null}
        <Row gap={space.sm}>
          <Button label="Retake" variant="secondary" icon="refresh" onPress={retake} disabled={busy} style={{ flex: 1 }} />
          <Button label="Save" icon="checkmark" onPress={save} loading={busy} style={{ flex: 1 }} />
        </Row>
        <PrivacyNote text={PRIVACY_COPY} />
      </>
    );
  }

  const counting = phase === 'countdown';
  const busy = phase === 'taking';
  return (
    <>
      <Segmented<PhotoPose> label="Pose" options={POSES.map((p) => ({ value: p, label: POSE_LABEL[p] }))} value={pose} onChange={setPose} />
      <View style={{ aspectRatio: PHOTO_ASPECT, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000000' }}>
        <CameraView
          ref={camera}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
          facing={facing}
          mirror={facing === 'front'}
          animateShutter={false}
          onCameraReady={() => setReady(true)}
          onMountError={() => setProblem("The camera couldn't start. Close other apps that use it and try again.")}
        />
        {ghostOn && previous ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
            <Image
              testID="ghost-overlay"
              source={{ uri: photoUri(previous) }}
              resizeMode="cover"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ width: '100%', height: '100%', opacity: GHOST_OPACITY }}
            />
          </View>
        ) : null}
        {counting ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <AppText variant="display" color="#FFFFFF" accessibilityLabel={`Taking the photo in ${count} seconds`}>
              {String(count)}
            </AppText>
          </View>
        ) : null}
      </View>
      <View accessibilityLiveRegion="polite">{counting ? <AppText variant="caption" color={colors.textMuted}>{`Taking the photo in ${count}…`}</AppText> : null}</View>
      {problem ? <InlineMessage tone="danger">{problem}</InlineMessage> : null}

      {counting ? (
        <Button label="Cancel timer" variant="secondary" onPress={() => setPhase('live')} />
      ) : (
        <Button label={timerOn ? `Start ${TIMER_SECONDS}-second timer` : 'Take photo'} icon="camera" onPress={shutter} disabled={!ready || busy} loading={busy} />
      )}

      <Card style={{ gap: space.sm }}>
        <Toggle
          label="Ghost guide"
          description={previous ? `Your last ${POSE_LABEL[pose].toLowerCase()} photo (${shortDate(previous.date)}) shows faintly so you can line up the same way.` : `No earlier ${POSE_LABEL[pose].toLowerCase()} photo yet. This one becomes your guide next time.`}
          value={ghostOn && !!previous}
          onChange={setGhostOn}
          disabled={!previous}
        />
        <Toggle label={`${TIMER_SECONDS}-second timer`} description="Leaves time to step back from the phone." value={timerOn} onChange={setTimerOn} disabled={counting || busy} />
        <Button
          label={facing === 'front' ? 'Use the back camera' : 'Use the front camera'}
          variant="secondary"
          icon="camera-reverse-outline"
          disabled={counting || busy}
          onPress={() => {
            setReady(false);
            setFacing((f) => (f === 'front' ? 'back' : 'front'));
          }}
        />
      </Card>
      <PrivacyNote text={PRIVACY_COPY} />
    </>
  );
}
