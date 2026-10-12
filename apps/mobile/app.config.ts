import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json holds Google's published *sample* AdMob app ids, so development and test builds can only
 * ever serve Google test ads. A production build supplies the real ids from the build environment
 * (store/CI secrets) — they are never committed. Everything else comes from app.json unchanged.
 */
const ADS_PLUGIN = 'react-native-google-mobile-ads';

export default ({ config }: ConfigContext): ExpoConfig => {
  const androidAppId = process.env.ADMOB_ANDROID_APP_ID;
  const iosAppId = process.env.ADMOB_IOS_APP_ID;
  if (!androidAppId && !iosAppId) return config as ExpoConfig;
  return {
    ...config,
    plugins: (config.plugins ?? []).map((p) => {
      if (!Array.isArray(p) || p[0] !== ADS_PLUGIN) return p;
      const options = (p[1] ?? {}) as Record<string, unknown>;
      return [ADS_PLUGIN, { ...options, ...(androidAppId ? { androidAppId } : {}), ...(iosAppId ? { iosAppId } : {}) }];
    }),
  } as ExpoConfig;
};
