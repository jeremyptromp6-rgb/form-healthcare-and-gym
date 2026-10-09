import Ionicons from '@expo/vector-icons/Ionicons';
import { useCameraPermissions } from 'expo-camera';
import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { AppText, Badge, Button, Card, GradientCard, ErrorState, Field, InlineMessage, ListRow, Row, Screen, SectionHeader, Segmented, StateView, Toggle } from '@/components/ui';
import { AppearancePicker } from '@/components/settings/AppearancePicker';
import { useAuth } from '@/lib/auth';
import { useCoachStatus, useEntitlements, useLegal, useMe, useUpdateSettings } from '@/lib/queries';
import { deviceTimeZone } from '@/lib/timezone';
import { openPaywall, STATE_LABEL, statusLine } from '@/lib/pro';
import type { Entitlements, Me } from '@/lib/types';
import { colors, gradients, space } from '@/theme/tokens';

/** Settings: units and dates, notifications, the coach, camera, scanner, privacy, account. */
export default function SettingsScreen() {
  const { signOut, signOutEverywhere } = useAuth();
  const me = useMe();
  const entitlements = useEntitlements();
  const [signingOutAll, setSigningOutAll] = useState(false);

  return (
    <Screen title="Settings" subtitle="Your private control center" refreshing={me.isRefetching} onRefresh={me.refetch}>
      {me.isError && !me.data ? <ErrorState error={me.error} onRetry={me.refetch} /> : null}
      {!me.data && !me.isError ? <StateView kind="loading" /> : null}
      {me.data ? (
        <>
          {entitlements.data ? <ProCard e={entitlements.data} /> : null}
          <SectionHeader title="Appearance" />
          <AppearancePicker />
          <UnitsAndDates me={me.data} />

          <SectionHeader title="Notifications" />
          <Card style={{ paddingVertical: space.xs }}>
            <ListRow title="Notification preferences" subtitle="What FORM may remind you about — separate from your device's permission" icon="notifications-outline" onPress={() => router.push('/profile/notifications' as Href)} />
          </Card>

          <CoachSettings me={me.data} />
          <CameraPrivacy />
          <ScannerPrivacy me={me.data} />
          <AdsAndAnalytics me={me.data} />

          <SectionHeader title="Account & data" />
          <Card style={{ paddingVertical: space.xs }}>
            <ListRow title="Account & security" subtitle="Password and signed-in devices" icon="key-outline" onPress={() => router.push('/profile/security' as Href)} />
            <ListRow title="Privacy center" subtitle="See what's stored, download it, or delete your account" icon="shield-checkmark-outline" onPress={() => router.push('/profile/privacy' as Href)} />
          </Card>
          <LegalLinks />

          <Button label="Sign out" icon="log-out-outline" variant="secondary" onPress={signOut} />
          <Button
            label="Sign out on all devices"
            variant="ghost"
            loading={signingOutAll}
            onPress={async () => {
              setSigningOutAll(true);
              try {
                await signOutEverywhere();
              } finally {
                setSigningOutAll(false);
              }
            }}
          />
        </>
      ) : null}
    </Screen>
  );
}

/** Where the subscription stands, from the server; the paywall explains Pro and handles purchase, restore and management. */
function ProCard({ e }: { e: Entitlements }) {
  const pro = e.tier === 'pro';
  const status = statusLine(e);
  return (
    <GradientCard colorsOverride={gradients.pro} style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="star" size={16} color={colors.onPrimary} />
          </View>
          <AppText variant="heading" header>
            FORM Pro
          </AppText>
        </Row>
        <Badge label={STATE_LABEL[e.state]} tone={pro ? 'primary' : e.state === 'PRO_BILLING_ISSUE' ? 'warning' : 'neutral'} />
      </Row>
      <AppText variant="body" color={colors.textMuted}>
        {status ?? 'Adaptive training, form intelligence, weekly reports, advanced planning and progress.'}
      </AppText>
      {e.environment === 'development' ? (
        <AppText variant="caption" color={colors.warning}>
          Development store purchase — no real payment.
        </AppText>
      ) : null}
      <Button label={pro ? 'Manage FORM Pro' : 'See FORM Pro'} variant={pro ? 'secondary' : 'primary'} onPress={() => openPaywall()} />
    </GradientCard>
  );
}

function UnitsAndDates({ me }: { me: Me }) {
  const update = useUpdateSettings();
  const s = me.settings;
  const [zone, setZone] = useState(s.timezone ?? '');
  const [zoneError, setZoneError] = useState<string | null>(null);
  const device = deviceTimeZone();
  return (
    <>
      <SectionHeader title="Units & dates" />
      <Card style={{ gap: space.md }}>
        <Segmented
          label="Units"
          options={[
            { value: 'metric', label: 'Metric (kg, cm)' },
            { value: 'imperial', label: 'Imperial (lb, ft)' },
          ]}
          value={s.units}
          onChange={(units) => update.mutate({ units })}
        />
        <AppText variant="caption" color={colors.textFaint}>
          Everything is stored in metric; this only changes how numbers are shown and entered.
        </AppText>
        <Segmented
          label="Dates"
          options={[
            { value: 'system', label: 'Device' },
            { value: 'day_month', label: '30 Sep' },
            { value: 'month_day', label: 'Sep 30' },
            { value: 'iso', label: '2026-09-30' },
          ]}
          value={s.dateFormat}
          onChange={(dateFormat) => update.mutate({ dateFormat })}
        />
        <Toggle
          label="Use this device's time zone"
          description={`Your days start and end at local midnight${s.timezone ? ` (now ${s.timezone})` : ''}.`}
          value={s.timezoneAuto}
          disabled={update.isPending}
          onChange={(v) => update.mutate(v && device ? { timezoneAuto: true, timezone: device } : { timezoneAuto: v })}
        />
        {!s.timezoneAuto ? (
          <Field
            label="Time zone"
            value={zone}
            onChangeText={setZone}
            placeholder="e.g. Europe/London"
            autoCapitalize="none"
            autoCorrect={false}
            error={zoneError ?? undefined}
            onBlur={() => {
              if (!zone || zone === s.timezone) return;
              setZoneError(null);
              update.mutate({ timezone: zone }, { onError: () => setZoneError("That isn't a time zone FORM knows. Use a name like Europe/London.") });
            }}
          />
        ) : null}
      </Card>
    </>
  );
}

function CoachSettings({ me }: { me: Me }) {
  const update = useUpdateSettings();
  const status = useCoachStatus();
  const s = me.settings;
  const aiAvailable = status.data?.aiAvailable ?? false;
  return (
    <>
      <SectionHeader title="Coach" />
      <Card style={{ gap: space.md }}>
        <Toggle label="Coaching" description="Tips on Home, after workouts and in Coach chat." value={s.aiCoachEnabled} disabled={update.isPending} onChange={(v) => update.mutate({ aiCoachEnabled: v })} />
        {s.aiCoachEnabled ? (
          <>
            <Toggle
              label="Let the AI coach use my data"
              description={
                aiAvailable
                  ? 'Sends a summary of your training, food and progress (no name, email, photos or video) to the AI provider to write your coaching. Off: rule-based tips that never leave FORM.'
                  : 'This server only offers rule-based tips, which never leave FORM.'
              }
              value={s.aiCoachConsent}
              disabled={update.isPending || !aiAvailable}
              onChange={(v) => update.mutate({ aiCoachConsent: v })}
            />
            <Toggle
              label="Keep chat history"
              description={s.coachKeepHistory ? 'Kept for 30 days so the coach can follow the conversation.' : 'Chats aren’t stored. Turning this off also deletes your chat history.'}
              value={s.coachKeepHistory}
              disabled={update.isPending}
              onChange={(v) => update.mutate({ coachKeepHistory: v })}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}

function CameraPrivacy() {
  const [permission, request] = useCameraPermissions();
  const state = permission?.granted ? 'Allowed' : permission?.canAskAgain === false ? 'Blocked' : 'Not asked yet';
  return (
    <>
      <SectionHeader title="Camera" />
      <Card style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <AppText variant="bodyStrong">Camera access</AppText>
          <Badge label={state} tone={permission?.granted ? 'primary' : 'neutral'} />
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          Rep counting runs on your phone. Video is never recorded or uploaded — only the joint positions FORM needs to verify each rep are sent.
        </AppText>
        {permission && !permission.granted ? (
          permission.canAskAgain ? (
            <Button label="Allow camera" variant="secondary" onPress={request} />
          ) : Platform.OS !== 'web' ? (
            <Button label="Open device settings" variant="secondary" onPress={() => Linking.openSettings()} />
          ) : (
            <AppText variant="caption" color={colors.textFaint}>
              Allow the camera in your browser&apos;s site settings.
            </AppText>
          )
        ) : null}
      </Card>
    </>
  );
}

function ScannerPrivacy({ me }: { me: Me }) {
  const update = useUpdateSettings();
  return (
    <>
      <SectionHeader title="Food scanner" />
      <Card style={{ gap: space.md }}>
        <Toggle
          label="Allow meal photo recognition"
          description="When you scan a meal, the photo (with its location data removed) is sent to the recognition service to identify the food. FORM doesn't keep the photo; the service handles it under its own terms and may use it to improve its products. Off: scanning asks first."
          value={me.settings.foodScanConsent}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ foodScanConsent: v })}
        />
      </Card>
    </>
  );
}

function AdsAndAnalytics({ me }: { me: Me }) {
  const update = useUpdateSettings();
  const s = me.settings;
  return (
    <>
      <SectionHeader title="Privacy" />
      <Card style={{ gap: space.md }}>
        <Row gap={space.sm}>
          <Ionicons name="lock-closed" size={16} color={colors.primary} />
          <AppText variant="bodyStrong">Private by default</AppText>
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          Your profile, photo, weight, workouts, meals, records and XP are visible only to you.
        </AppText>
        <Toggle label="Personalized ads" description="Off: free-tier ads aren't based on your activity." value={s.personalizedAdsConsent} disabled={update.isPending} onChange={(v) => update.mutate({ personalizedAdsConsent: v })} />
        <Toggle label="Share usage analytics" description="Anonymous app usage only. Never health, body or food data." value={s.analyticsConsent} disabled={update.isPending} onChange={(v) => update.mutate({ analyticsConsent: v })} />
        {update.isError ? <InlineMessage tone="danger">Couldn&apos;t save that setting. Try again.</InlineMessage> : null}
      </Card>
    </>
  );
}

/** Only the documents the operator has published; nothing invented. */
function LegalLinks() {
  const legal = useLegal();
  const links = [
    legal.data?.termsUrl ? { label: 'Terms of service', url: legal.data.termsUrl } : null,
    legal.data?.privacyUrl ? { label: 'Privacy policy', url: legal.data.privacyUrl } : null,
  ].filter((l): l is { label: string; url: string } => l !== null);
  if (links.length === 0) return null;
  return (
    <Card style={{ paddingVertical: space.xs }}>
      {links.map((l) => (
        <ListRow key={l.url} title={l.label} icon="document-text-outline" onPress={() => Linking.openURL(l.url)} />
      ))}
    </Card>
  );
}
