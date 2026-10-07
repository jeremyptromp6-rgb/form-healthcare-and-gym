import { router, type Href } from 'expo-router';
import { PrivacyCenterScreen } from '@/components/settings/PrivacyCenterScreen';
import { IconButton } from '@/components/ui';

/** The privacy center outside the tabs, so export and deletion work before onboarding is finished. */
export default function RootPrivacyScreen() {
  const close = <IconButton icon="close" label="Close privacy center" onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))} />;
  return <PrivacyCenterScreen right={close} />;
}
