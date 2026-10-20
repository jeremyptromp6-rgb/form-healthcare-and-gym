import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { AppText, Button, Card, ChipGroup, IconButton, InlineMessage, Row, SectionHeader, Toggle } from '@/components/ui';
import { formatTime, inQuietHours, parseTime, type ReminderPrefs } from '@/lib/reminders';
import { useReminderPermission, useReminderPrefs } from '@/lib/useReminders';
import { colors, space } from '@/theme/tokens';

const STEP_MINUTES = 30;
const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, i) => ({ key: String(i), label }));

type Switch = 'workout' | 'streak' | 'weekly' | 'rest';

/**
 * A time chosen in half-hour steps: no native picker, big touch targets, and it reads aloud as a time.
 * Times inside quiet hours are allowed but flagged: they're delivered just outside them.
 */
function TimeStepper({ label, value, onChange }: { label: string; value: string; onChange: (hhmm: string) => void }) {
  const minutes = parseTime(value, 18 * 60);
  return (
    <View style={{ gap: space.xs }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="body">{label}</AppText>
        <Row gap={space.sm}>
          <IconButton icon="remove-circle-outline" label={`Earlier ${label.toLowerCase()}`} onPress={() => onChange(formatTime(minutes - STEP_MINUTES))} />
          <AppText variant="bodyStrong" accessibilityLabel={`${label}: ${value}`}>
            {value}
          </AppText>
          <IconButton icon="add-circle-outline" label={`Later ${label.toLowerCase()}`} onPress={() => onChange(formatTime(minutes + STEP_MINUTES))} />
        </Row>
      </Row>
      {inQuietHours(minutes) ? (
        <AppText variant="caption" color={colors.warning}>
          That&apos;s in quiet hours (22:00–08:00), so FORM will send it just outside them.
        </AppText>
      ) : null}
    </View>
  );
}

/** Reminders: local to this phone, off until the user turns one on (which is also when the system asks for permission). */
export function RemindersSettings() {
  const { prefs, save } = useReminderPrefs();
  const { permission, request } = useReminderPermission();
  const [needsAllow, setNeedsAllow] = useState(false);

  // Nothing to set up on the web, or where the device can't notify.
  if (!prefs || permission === null || permission === 'unsupported') return null;

  const change = (patch: Partial<ReminderPrefs>) => void save({ ...prefs, ...patch });

  const setOn = async (key: Switch, on: boolean) => {
    if (on) {
      // The one place FORM asks: the moment a reminder is switched on.
      const result = await request();
      if (result !== 'granted') {
        setNeedsAllow(result === 'undetermined');
        return;
      }
      setNeedsAllow(false);
    }
    await save({ ...prefs, [key]: { ...prefs[key], on } });
  };

  const blocked = permission === 'blocked';
  const where = Platform.OS === 'android' ? 'Android settings' : 'your device settings';

  return (
    <>
      <SectionHeader title="Reminders" />
      <Card style={{ gap: space.md }}>
        <AppText variant="caption" color={colors.textMuted}>
          Kept on this phone. At most two a day, and never between 22:00 and 08:00.
        </AppText>

        {blocked ? (
          <View style={{ gap: space.sm }}>
            <InlineMessage tone="warning">{`Notifications are off in ${where}. Turn them on there for FORM to send reminders.`}</InlineMessage>
            <Button label="Open settings" variant="secondary" onPress={() => Linking.openSettings()} />
          </View>
        ) : null}
        {needsAllow ? <InlineMessage tone="info">Allow notifications to turn reminders on. You can change your mind any time.</InlineMessage> : null}

        <Toggle label="Workout reminder" description="A nudge at your time on the days you pick. Skipped once you've trained or hit your weekly goal." value={prefs.workout.on} onChange={(v) => void setOn('workout', v)} />
        {prefs.workout.on ? (
          <>
            <TimeStepper label="Workout reminder time" value={prefs.workout.time} onChange={(time) => change({ workout: { ...prefs.workout, time } })} />
            <ChipGroup
              label="Days"
              options={DAY_OPTIONS}
              selected={prefs.workout.days.map(String)}
              onToggle={(key) => {
                const day = Number(key);
                const days = prefs.workout.days.includes(day) ? prefs.workout.days.filter((d) => d !== day) : [...prefs.workout.days, day].sort();
                change({ workout: { ...prefs.workout, days } });
              }}
            />
          </>
        ) : null}

        <Toggle label="Streak at risk" description="One evening nudge when you have a streak of 2+ days and haven't trained yet. Never on rest days." value={prefs.streak.on} onChange={(v) => void setOn('streak', v)} />
        {prefs.streak.on ? <TimeStepper label="Streak reminder time" value={prefs.streak.time} onChange={(time) => change({ streak: { ...prefs.streak, time } })} /> : null}

        <Toggle label="Weekly recap" description="Sundays at 18:00: your workouts and XP for the week." value={prefs.weekly.on} onChange={(v) => void setOn('weekly', v)} />
        <Toggle label="Rest-day message" description="A short note on days your plan says to recover." value={prefs.rest.on} onChange={(v) => void setOn('rest', v)} />
      </Card>
    </>
  );
}
