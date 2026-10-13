import { defaultMealType, MEAL_TYPES } from '@form/domain';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, View, type ScrollView } from 'react-native';
import { FoodPicker } from '@/components/eat/FoodPicker';
import { ScanPhotoLabels, type ScanPhoto } from '@/components/eat/ScanPhotoLabels';
import { ScanReviewView } from '@/components/eat/ScanReviewView';
import { AppText, Button, Card, InlineMessage, Row, Screen, StateView } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { useFeature } from '@/lib/features';
import { useConfirmScan, useCreateScan, useDiscardScan , useUpdateSettings } from '@/lib/queries';
import { confirmItems, initialReview, scanErrorMessage, statusMessage, type ItemChoice, type ReviewState } from '@/lib/scan';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import { capturePhoto } from '@/lib/scanCapture';
import type { FoodScan, MealType } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

type Photo = ScanPhoto & { base64: string };
type Step =
  | { kind: 'start'; notice?: { text: string; settings?: boolean } }
  | { kind: 'preview'; photo: Photo }
  | { kind: 'analyzing'; photo: Photo }
  | { kind: 'status'; photo: Photo; scan: FoodScan }
  | { kind: 'error'; photo: Photo; message: string; retry: boolean; needsConsent?: boolean; pro?: boolean }
  | { kind: 'review'; scan: FoodScan; photo?: ScanPhoto }
  | { kind: 'picking'; scan: FoodScan; itemId: string; photo?: ScanPhoto };

/** What the review keeps of a photo: the picture and its size, not the upload copy. */
const reviewPhoto = (p: Photo): ScanPhoto => ({ uri: p.uri, width: p.width, height: p.height });

/**
 * Food scanner: take a photo → recognition → review the ESTIMATE → log. The photo is kept in
 * memory only for this screen (through the review, so labels can sit on the foods); the server
 * doesn't store it, and retaking, discarding or logging drops it. Nothing is logged until the
 * user confirms the review, and confirming twice can never log twice.
 */
export default function ScanMeal() {
  const params = useLocalSearchParams<{ meal?: string; date?: string }>();
  const date = params.date ?? localDateKey();
  const feature = useFeature('food_scan');
  const createScan = useCreateScan();
  const updateSettings = useUpdateSettings();
  const discard = useDiscardScan();

  const [step, setStep] = useState<Step>({ kind: 'start' });
  // One id per photo: retrying the same photo returns the same scan (no second recognition).
  const [clientScanId, setClientScanId] = useState(uuid);
  const [review, setReview] = useState<ReviewState>({});
  const [meal, setMeal] = useState<MealType>(
    (MEAL_TYPES as readonly string[]).includes(params.meal ?? '') ? (params.meal as MealType) : defaultMealType(new Date().getHours()),
  );
  const [mealName, setMealName] = useState('');
  const run = useRef(0);

  const take = async (source: 'camera' | 'library') => {
    const r = await capturePhoto(source);
    if (r.ok) {
      setClientScanId(uuid());
      setStep({ kind: 'preview', photo: r.image });
    } else if (r.reason === 'permission_denied') setStep({ kind: 'start', notice: { text: 'FORM needs camera access to scan a meal. You can also choose a photo, or search for the food.' } });
    else if (r.reason === 'permission_blocked') setStep({ kind: 'start', notice: { text: 'Camera access is off for FORM. Turn it on in Settings to scan meals.', settings: true } });
    else if (r.reason === 'failed') setStep({ kind: 'start', notice: { text: 'That photo couldn’t be used. Try again.' } });
  };

  const analyze = (photo: Photo) => {
    const token = ++run.current;
    setStep({ kind: 'analyzing', photo });
    createScan.mutate(
      { clientScanId, image: { mimeType: 'image/jpeg', data: photo.base64 } },
      {
        onSuccess: ({ scan }) => {
          if (token !== run.current) return; // cancelled meanwhile
          if (scan.status === 'ok') {
            setReview(initialReview(scan));
            setStep({ kind: 'review', scan, photo: reviewPhoto(photo) });
          } else setStep({ kind: 'status', photo, scan });
        },
        onError: (e) => {
          if (token !== run.current) return;
          const m = scanErrorMessage(e);
          setStep({ kind: 'error', photo, message: m.message, retry: m.retry, needsConsent: m.needsConsent, pro: m.pro });
        },
      },
    );
  };

  const retake = (scanId?: string) => {
    run.current++;
    if (scanId) discard.mutate(scanId); // drop the stored review; best effort
    setStep({ kind: 'start' });
  };

  if (!feature.loading && feature.unknown) {
    return (
      <Screen title="Scan a meal">
        <StateView
          kind="error"
          title="Couldn't reach FORM's server"
          message="Check your connection and try again. The server can take up to a minute to wake up."
          actionLabel={feature.checking ? 'Checking…' : 'Try again'}
          onAction={() => void feature.recheck()}
        />
      </Screen>
    );
  }
  if (!feature.loading && !feature.available) {
    return (
      <Screen title="Scan a meal">
        <StateView
          kind="unavailable"
          title="Food scanning isn’t available"
          message="Search the food database, add a food from its label, or weigh it for the most accurate numbers."
          actionLabel="Search foods"
          onAction={() => router.replace(`/eat/add?meal=${meal}&date=${date}` as Href)}
        />
      </Screen>
    );
  }

  switch (step.kind) {
    case 'start':
      return (
        <Screen title="Scan a meal" subtitle="Photo → estimate → review → log">
          <Card style={{ gap: space.md }}>
            <AppText variant="bodyStrong">Take a photo from above with the whole plate in view.</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              We identify the foods and estimate portions — you review and adjust before anything is logged. Scanned amounts are always estimates; weigh food when you need accuracy.
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              Your photo is sent to FORM’s server and its food-recognition provider (an outside image-recognition service) to identify the food. Location data is removed first, and FORM doesn’t keep the photo. The service handles it under its own terms — on a free plan it may use photos to improve its products, so don’t include people or anything private.
            </AppText>
          </Card>
          {step.notice ? (
            <InlineMessage tone="warning">
              {step.notice.text}
            </InlineMessage>
          ) : null}
          {step.notice?.settings && Platform.OS !== 'web' ? <Button label="Open Settings" variant="secondary" onPress={() => Linking.openSettings()} /> : null}
          <Button label="Take photo" icon="camera" onPress={() => take('camera')} />
          <Button label="Choose a photo" icon="images-outline" variant="secondary" onPress={() => take('library')} />
          <Button label="Search foods instead" variant="ghost" onPress={() => router.replace(`/eat/add?meal=${meal}&date=${date}` as Href)} />
        </Screen>
      );
    case 'preview':
    case 'analyzing':
      return (
        <Screen title="Scan a meal">
          <PhotoPreview photo={step.photo} />
          {step.kind === 'analyzing' ? (
            <Card style={{ gap: space.sm, alignItems: 'center' }}>
              <View accessibilityRole="progressbar" accessibilityLabel="Identifying foods">
                <ActivityIndicator color={colors.primary} />
              </View>
              <AppText variant="bodyStrong">Identifying foods…</AppText>
              <Button label="Cancel" variant="ghost" onPress={() => ((run.current += 1), setStep({ kind: 'preview', photo: step.photo }))} />
            </Card>
          ) : (
            <Row>
              <Button label="Retake" variant="secondary" icon="camera-reverse-outline" onPress={() => retake()} style={{ flex: 1 }} />
              <Button label="Use photo" icon="checkmark" onPress={() => analyze(step.photo)} style={{ flex: 1 }} />
            </Row>
          )}
        </Screen>
      );
    case 'status': {
      const m = statusMessage(step.scan)!;
      return (
        <Screen title="Scan a meal">
          <PhotoPreview photo={step.photo} />
          <StateView kind="empty" title={m.title} message={m.message} />
          <Button label="Retake photo" icon="camera" onPress={() => retake(step.scan.id)} />
          <Button label="Search foods instead" variant="secondary" onPress={() => router.replace(`/eat/add?meal=${meal}&date=${date}` as Href)} />
        </Screen>
      );
    }
    case 'error':
      return (
        <Screen title="Scan a meal">
          <PhotoPreview photo={step.photo} />
          <InlineMessage tone={step.needsConsent || step.pro ? 'info' : 'danger'}>{step.message}</InlineMessage>
          {step.pro ? <ProUpsellFor feature="FOOD_SCANNER_PREMIUM" compact /> : null}
          {step.needsConsent ? (
            <Button
              label="Allow and analyse"
              icon="checkmark"
              loading={updateSettings.isPending}
              onPress={() =>
                updateSettings.mutate(
                  { foodScanConsent: true },
                  {
                    onSuccess: () => analyze(step.photo),
                    // Keep the consent button on screen and say why nothing happened.
                    onError: (e) =>
                      setStep({
                        kind: 'error',
                        photo: step.photo,
                        message: e.kind === 'network' ? "Couldn't save your choice. Check your connection and try again." : "Couldn't save your choice. Try again.",
                        retry: false,
                        needsConsent: true,
                      }),
                  },
                )
              }
            />
          ) : null}
          {step.retry ? <Button label="Try again" icon="refresh" onPress={() => analyze(step.photo)} /> : null}
          <Button label="Retake photo" variant="secondary" icon="camera" onPress={() => retake()} />
          <Button label="Search foods instead" variant="ghost" onPress={() => router.replace(`/eat/add?meal=${meal}&date=${date}` as Href)} />
        </Screen>
      );
    case 'picking':
      return (
        <Screen title="Choose the food" subtitle="Search the database or your foods">
          <FoodPicker
            autoFocus
            onPick={(food) => {
              const current = review[step.itemId]!;
              const amount = food.basis === 'g' ? current.amount : (food.servings[0]?.amount ?? 250);
              setReview({ ...review, [step.itemId]: { ...current, food, option: null, amount } });
              setStep({ kind: 'review', scan: step.scan, photo: step.photo });
            }}
          />
          <Button label="Back to review" variant="ghost" onPress={() => setStep({ kind: 'review', scan: step.scan, photo: step.photo })} />
        </Screen>
      );
    case 'review':
      return (
        <Review
          scan={step.scan}
          photo={step.photo}
          review={review}
          setReview={setReview}
          meal={meal}
          setMeal={setMeal}
          mealName={mealName}
          setMealName={setMealName}
          date={date}
          onPick={(itemId) => setStep({ kind: 'picking', scan: step.scan, itemId, photo: step.photo })}
          onRetake={() => retake(step.scan.id)}
          onLogged={() => setStep({ kind: 'review', scan: step.scan })}
        />
      );
  }
}

function Review(p: {
  scan: FoodScan;
  photo?: ScanPhoto;
  review: ReviewState;
  setReview: (r: ReviewState) => void;
  meal: MealType;
  setMeal: (m: MealType) => void;
  mealName: string;
  setMealName: (s: string) => void;
  date: string;
  onPick: (itemId: string) => void;
  onRetake: () => void;
  /** The meal was logged: the photo is dropped. */
  onLogged: () => void;
}) {
  const confirm = useConfirmScan(p.scan.id);
  // One key per scan: a retried or double-tapped confirmation replays instead of logging again.
  const [confirmKey] = useState(uuid);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  return (
    <Screen title="Scan a meal" scrollRef={scrollRef}>
      <ScanReviewView
        scan={p.scan}
        photo={p.photo}
        scrollRef={scrollRef}
        state={p.review}
        onChange={(itemId, patch: Partial<ItemChoice>) => p.setReview({ ...p.review, [itemId]: { ...p.review[itemId]!, ...patch } })}
        onPickFood={p.onPick}
        meal={p.meal}
        onMeal={p.setMeal}
        mealName={p.mealName}
        onMealName={p.setMealName}
        confirming={confirm.isPending}
        error={error}
        onRetake={p.onRetake}
        onConfirm={() => {
          setError(null);
          confirm.mutate(
            { confirmKey, localDate: p.date, mealType: p.meal, mealName: p.mealName.trim() || null, items: confirmItems(p.scan, p.review) },
            {
              onSuccess: () => {
                p.onLogged();
                router.back();
              },
              onError: (e) => setError(e.kind === 'network' ? 'Not logged — no connection. Try again; it won’t be logged twice.' : e.message),
            },
          );
        }}
      />
    </Screen>
  );
}

/** The whole photo at its own shape (never cropped), the way the review will show it. */
function PhotoPreview({ photo }: { photo: Photo }) {
  return <ScanPhotoLabels photo={photo} items={[]} />;
}
