import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Divider, Field, InlineMessage, Row, Toggle } from '@/components/ui';
import type { NotificationPreferences } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

// ---- Notifications -------------------------------------------------------------------------------

export type DevicePermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

const DEVICE_TEXT: Record<DevicePermission, string> = {
  granted: 'Allowed on this device.',
  denied: "Blocked on this device. FORM can't notify you until you allow notifications in your device settings.",
  undetermined: "Not asked yet. Your device will ask the first time FORM needs to send one.",
  unsupported: "This build can't send notifications yet. Your choices are saved and will apply once it can.",
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** FORM's notification choices, shown separately from the device's permission (which only the OS grants). */
export function NotificationsView({
  prefs,
  device,
  onChange,
  saving,
  error,
}: {
  prefs: NotificationPreferences;
  device: DevicePermission;
  onChange: (patch: Partial<NotificationPreferences>) => void;
  saving: boolean;
  error: string | null;
}) {
  const [time, setTime] = useState(prefs.workoutReminderTime);
  const [quietStart, setQuietStart] = useState(prefs.quietHours?.start ?? '22:00');
  const [quietEnd, setQuietEnd] = useState(prefs.quietHours?.end ?? '07:00');
  const timeError = TIME.test(time) ? undefined : 'Use 24-hour HH:MM, e.g. 07:30';
  const quietError = TIME.test(quietStart) && TIME.test(quietEnd) ? undefined : 'Use 24-hour HH:MM';

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.xs }}>
        <Row gap={space.sm}>
          <Ionicons name="phone-portrait-outline" size={18} color={device === 'granted' ? colors.primary : colors.textMuted} />
          <AppText variant="bodyStrong">Device permission</AppText>
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          {DEVICE_TEXT[device]}
        </AppText>
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="bodyStrong">What FORM may notify you about</AppText>
        <Toggle label="Workout reminders" description="On your training days, at the time below." value={prefs.workoutReminders} disabled={saving} onChange={(v) => onChange({ workoutReminders: v })} />
        {prefs.workoutReminders ? (
          <Field label="Reminder time" value={time} onChangeText={setTime} onBlur={() => !timeError && time !== prefs.workoutReminderTime && onChange({ workoutReminderTime: time })} error={timeError} keyboardType="numbers-and-punctuation" maxLength={5} />
        ) : null}
        <Toggle label="Meal logging reminders" value={prefs.mealReminders} disabled={saving} onChange={(v) => onChange({ mealReminders: v })} />
        <Toggle label="Weekly summary" value={prefs.weeklySummary} disabled={saving} onChange={(v) => onChange({ weeklySummary: v })} />
        <Toggle label="Achievements and records" value={prefs.achievementAlerts} disabled={saving} onChange={(v) => onChange({ achievementAlerts: v })} />
        <Toggle label="Streak reminders" description="Gentle — rest days in your plan never trigger one." value={prefs.streakAlerts} disabled={saving} onChange={(v) => onChange({ streakAlerts: v })} />
        <Toggle label="Coach tips" value={prefs.coachTips} disabled={saving} onChange={(v) => onChange({ coachTips: v })} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Toggle label="Quiet hours" description="No notifications between these times." value={prefs.quietHours !== null} disabled={saving} onChange={(v) => onChange({ quietHours: v ? { start: quietStart, end: quietEnd } : null })} />
        {prefs.quietHours ? (
          <Row gap={space.sm}>
            <Field label="From" value={quietStart} onChangeText={setQuietStart} onBlur={() => !quietError && onChange({ quietHours: { start: quietStart, end: quietEnd } })} maxLength={5} style={{ flex: 1 }} />
            <Field label="Until" value={quietEnd} onChangeText={setQuietEnd} onBlur={() => !quietError && onChange({ quietHours: { start: quietStart, end: quietEnd } })} maxLength={5} style={{ flex: 1 }} />
          </Row>
        ) : null}
        {prefs.quietHours && quietError ? (
          <AppText variant="caption" color={colors.danger}>
            {quietError}
          </AppText>
        ) : null}
      </Card>
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
    </View>
  );
}

// ---- Password ------------------------------------------------------------------------------------

export function ChangePasswordView({ onSubmit }: { onSubmit: (current: string, next: string) => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const mismatch = again.length > 0 && again !== next;
  const tooShort = next.length > 0 && next.length < 10;

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      await onSubmit(current, next);
      setResult({ ok: true, text: 'Password changed. Other devices have been signed out.' });
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (e) {
      const code = (e as { code?: string }).code;
      setResult({ ok: false, text: code === 'password_incorrect' ? 'Your current password is incorrect.' : code === 'password_unchanged' ? 'Choose a password you haven’t used here.' : 'Couldn’t change your password. Nothing was changed — try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="bodyStrong">Change password</AppText>
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" error={tooShort ? 'At least 10 characters' : undefined} />
      <Field label="New password again" value={again} onChangeText={setAgain} secureTextEntry autoComplete="new-password" error={mismatch ? 'Doesn’t match' : undefined} />
      {result ? <InlineMessage tone={result.ok ? 'success' : 'danger'}>{result.text}</InlineMessage> : null}
      <Button label="Change password" onPress={submit} loading={busy} disabled={!current || next.length < 10 || mismatch || again !== next} />
    </Card>
  );
}

// ---- Privacy center ------------------------------------------------------------------------------

const TABLE_LABEL: Record<string, string> = {
  profiles: 'Profile',
  nutrition_preferences: 'Food preferences',
  user_settings: 'Settings',
  notification_preferences: 'Notification choices',
  goal_history: 'Goal history',
  body_measurements: 'Weight entries',
  profile_photos: 'Profile photo',
  workouts: 'Workouts',
  workout_sessions: 'Workout sessions',
  workout_plans: 'Workout plans',
  personal_records: 'Personal records',
  food_logs: 'Food log entries',
  user_foods: 'Your foods',
  food_scans: 'Food scan results (photos are never kept)',
  water_logs: 'Water entries',
  meal_plans: 'Meal plans',
  saved_recipes: 'Saved recipes',
  grocery_items: 'Grocery items',
  nutrition_targets: 'Nutrition targets',
  xp_events: 'XP history',
  user_quests: 'Quest progress',
  user_achievements: 'Achievements',
  body_quest_snapshots: 'Body Quest snapshots',
  progression_state: 'Progress bookkeeping',
  domain_events: 'Activity events',
  celebration_seen: 'Seen celebrations',
  coach_messages: 'Coach chat',
  coach_insights: 'Coach tips (cached)',
  coach_calls: 'Coach usage (no content)',
  subscriptions: 'Subscription',
  body_quests: 'Body goals',
  food_entries: 'Food entries (legacy)',
};
const labelFor = (t: string) => TABLE_LABEL[t] ?? t.replace(/_/g, ' ');

export interface PrivacyCenterProps {
  counts: Record<string, number> | null;
  onExport: (password: string) => Promise<{ where: 'download' | 'shared' }>;
  onDelete: (body: { password: string; confirm: string; acknowledgeSubscription?: boolean }) => Promise<void>;
}

/** What FORM stores, a full export, and account deletion — each honest about what happened. */
export function PrivacyCenterView({ counts, onExport, onDelete }: PrivacyCenterProps) {
  const stored = counts ? Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => labelFor(a[0]).localeCompare(labelFor(b[0]))) : null;
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.sm }}>
        <AppText variant="bodyStrong">What FORM stores about you</AppText>
        <AppText variant="caption" color={colors.textMuted}>
          Only you can see it. Camera video never leaves your phone — only joint positions are sent to verify reps. Meal photos you scan are analysed and not kept.
        </AppText>
        {stored === null ? null : stored.length === 0 ? (
          <AppText variant="caption" color={colors.textFaint}>
            Nothing stored yet.
          </AppText>
        ) : (
          stored.map(([t, n], i) => (
            <View key={t}>
              {i > 0 ? <Divider /> : null}
              <Row style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <AppText variant="body">{labelFor(t)}</AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {n.toLocaleString()}
                </AppText>
              </Row>
            </View>
          ))
        )}
      </Card>
      <ExportCard onExport={onExport} />
      <DeleteCard onDelete={onDelete} />
    </View>
  );
}

function ExportCard({ onExport }: { onExport: PrivacyCenterProps['onExport'] }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await onExport(password);
      setPassword('');
      setResult({ ok: true, text: r.where === 'download' ? 'Your export has downloaded as a JSON file.' : 'Your export was handed to the place you chose. FORM doesn’t keep a copy on this phone.' });
    } catch (e) {
      const { code, kind } = e as { code?: string; kind?: string };
      setResult({ ok: false, text: code === 'password_incorrect' ? 'Password is incorrect.' : kind === 'rate_limited' ? 'You’ve exported a few times recently. Try again in an hour.' : 'The export didn’t complete. Nothing was saved — try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="bodyStrong">Download your data</AppText>
      <AppText variant="caption" color={colors.textMuted}>
        A complete copy of everything above as a structured JSON file, including your photo. Keep it somewhere safe — it contains your health and body data.
      </AppText>
      <Field label="Confirm with your password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      {result ? <InlineMessage tone={result.ok ? 'success' : 'danger'}>{result.text}</InlineMessage> : null}
      <Button label="Export my data" icon="download-outline" variant="secondary" onPress={run} loading={busy} disabled={!password} />
    </Card>
  );
}

function DeleteCard({ onDelete }: { onDelete: PrivacyCenterProps['onDelete'] }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState(false);

  if (!open) return <Button label="Delete my account" variant="danger" icon="trash-outline" onPress={() => setOpen(true)} />;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete({ password, confirm, ...(subscription ? { acknowledgeSubscription: true } : {}) });
      // Success signs out; this card goes away with the session.
    } catch (e) {
      const { code, message } = e as { code?: string; message?: string };
      if (code === 'subscription_active') {
        setSubscription(true);
        setError(message ?? 'You have an active subscription.');
      } else
        setError(
          code === 'password_incorrect'
            ? 'Password is incorrect. Nothing was deleted.'
            : code === 'confirmation_required'
              ? 'Type DELETE to confirm.'
              : 'Your account couldn’t be deleted, so nothing was deleted. Try again, or contact support if it keeps happening.',
        );
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.md, borderColor: 'rgba(255,93,110,0.4)' }}>
      <AppText variant="heading" color={colors.danger} header>
        Delete account
      </AppText>
      <AppText variant="caption" color={colors.textMuted}>
        This permanently deletes your account and everything listed above — profile, photo, weight, workouts, meals, records, XP and coach chat. It can&apos;t be undone. Download your data first if you want a copy.
      </AppText>
      <AppText variant="caption" color={colors.textFaint}>
        Requests already sent to outside services (meal photo recognition, the AI coach) aren&apos;t stored by FORM; those services handle them under their own retention terms.
      </AppText>
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      <Field label="Type DELETE to confirm" value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} />
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
      {subscription ? (
        <InlineMessage tone="warning">Deleting your account won&apos;t cancel store billing. Cancel the subscription in your store first, then delete — or delete anyway below.</InlineMessage>
      ) : null}
      <Row>
        <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={{ flex: 1 }} />
        <Button label={subscription ? 'Delete anyway' : 'Delete forever'} variant="danger" onPress={run} loading={busy} disabled={!password || confirm !== 'DELETE'} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}
