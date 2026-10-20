import type { ReactNode } from 'react';
import { PrivacyCenterView } from '@/components/settings/SettingsViews';
import { DeleteProgressPhotosCard } from '@/components/progress/bodyProgress/DeleteAllPhotos';
import { Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { saveExport } from '@/lib/privateFiles';
import { deleteAllProgressPhotos } from '@/lib/progressPhotos';
import { useDataSummary } from '@/lib/queries';

/**
 * Privacy center: what's stored, a full export, and account deletion (re-authenticated).
 * Mounted from Profile → Settings and, for anyone who hasn't finished onboarding, from onboarding.
 */
export function PrivacyCenterScreen({ right }: { right?: ReactNode }) {
  const { authed, signOut } = useAuth();
  const summary = useDataSummary();
  return (
    <Screen title="Privacy center" subtitle="Your data, your call" right={right}>
      <PrivacyCenterView
        counts={summary.data?.counts ?? null}
        onExport={async (password) => {
          const data = await authed((t) => api.exportData(t, password));
          const date = new Date().toISOString().slice(0, 10);
          return saveExport(JSON.stringify(data, null, 2), `form-export-${date}.json`);
        }}
        onDelete={async (body) => {
          await authed((t) => api.deleteAccount(t, body));
          // Only reached when the server confirmed everything is gone. Progress photos live only on this
          // phone, so deleting the account removes them here too (best effort: never blocks the sign-out).
          await deleteAllProgressPhotos().catch(() => undefined);
          await signOut();
        }}
      />
      <DeleteProgressPhotosCard />
    </Screen>
  );
}
