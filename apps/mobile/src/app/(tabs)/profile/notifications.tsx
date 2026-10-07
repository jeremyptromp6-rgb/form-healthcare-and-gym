import { NotificationsView } from '@/components/settings/SettingsViews';
import { ErrorState, Screen, StateView } from '@/components/ui';
import { useNotificationPrefs, useUpdateNotifications } from '@/lib/queries';

/**
 * Notification preferences. This build has no push integration, so the device permission is
 * reported honestly as unsupported; the choices are saved for when it does.
 */
export default function NotificationsScreen() {
  const prefs = useNotificationPrefs();
  const update = useUpdateNotifications();
  return (
    <Screen title="Notifications" subtitle="Only what you ask for">
      {prefs.isPending ? <StateView kind="loading" /> : null}
      {prefs.isError && !prefs.data ? <ErrorState error={prefs.error} onRetry={prefs.refetch} /> : null}
      {prefs.data ? (
        <NotificationsView prefs={prefs.data} device="unsupported" onChange={(patch) => update.mutate(patch)} saving={update.isPending} error={update.isError ? "Couldn't save that. Try again." : null} />
      ) : null}
    </Screen>
  );
}
