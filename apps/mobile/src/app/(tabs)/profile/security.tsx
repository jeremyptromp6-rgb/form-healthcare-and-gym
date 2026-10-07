import { useState } from 'react';
import { ChangePasswordView } from '@/components/settings/SettingsViews';
import { AppText, Button, Card, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useMe } from '@/lib/queries';
import { colors, space } from '@/theme/tokens';

/** Account & security: password, and the devices signed in. */
export default function SecurityScreen() {
  const { changePassword, signOut, signOutEverywhere } = useAuth();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  return (
    <Screen title="Account & security" subtitle={me.data?.user.email}>
      <ChangePasswordView onSubmit={changePassword} />
      <Card style={{ gap: space.sm }}>
        <AppText variant="bodyStrong">Signed-in devices</AppText>
        <AppText variant="caption" color={colors.textMuted}>
          Each device keeps its own session until it signs out. Signing out everywhere ends every session at once, including this one — use it if you lost a phone or signed in somewhere you don&apos;t trust.
        </AppText>
        <Button label="Sign out of this device" variant="secondary" icon="log-out-outline" onPress={signOut} />
        <Button
          label="Sign out on all devices"
          variant="ghost"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await signOutEverywhere();
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
    </Screen>
  );
}
