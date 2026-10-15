import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Everything comes from app.json unchanged. FORM ships without ads, so there is no ads plugin and no
 * AdMob app id to inject. (This file stays as the place for build-time config if it's ever needed.)
 */
export default ({ config }: ConfigContext): ExpoConfig => config as ExpoConfig;
