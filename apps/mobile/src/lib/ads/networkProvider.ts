import { Platform } from 'react-native';
import mobileAds, { AdEventType, AdsConsent, InterstitialAd, MaxAdContentRating, TestIds } from 'react-native-google-mobile-ads';
import { config, type AdsSettings } from '../config';
import { AdFailure, type AdAvailability, type InterstitialAdProvider, type LoadedInterstitial } from './provider';

/**
 * Google AdMob, behind the app's InterstitialAdProvider boundary. Nothing here runs until the
 * AdService has an eligible post-workout ad: the SDK isn't initialised at launch, so it never costs
 * start-up time, battery or network during a workout or a camera session.
 *
 * Test mode always uses Google's official test unit ids. Production ids come only from the build's
 * environment (EXPO_PUBLIC_ADMOB_INTERSTITIAL_*). No fitness, nutrition or camera data is ever
 * passed to the network — the ad request carries no keywords and no content URL.
 */

function unitIdFor(settings: AdsSettings): string | null {
  if (settings.mode === 'test') return TestIds.INTERSTITIAL;
  if (settings.mode !== 'production') return null;
  if (Platform.OS === 'android') return settings.interstitial.android;
  if (Platform.OS === 'ios') return settings.interstitial.ios;
  return null;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, code: string) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new AdFailure(code)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

let ready: Promise<void> | null = null;
/** Consent first (Google's UMP form, only where the user's region requires it), then the SDK — once per app run. */
function prepare(): Promise<void> {
  ready ??= (async () => {
    let canRequest = true;
    try {
      const info = await withTimeout(AdsConsent.gatherConsent(), 8000, 'consent_timeout');
      canRequest = info.canRequestAds;
    } catch {
      // No consent answer (offline, or the consent form isn't set up for this app): only proceed if
      // a previous answer already allows ads; otherwise serve nothing.
      canRequest = await AdsConsent.getConsentInfo().then((i) => i.canRequestAds).catch(() => false);
    }
    if (!canRequest) throw new AdFailure('consent_required');
    await mobileAds().setRequestConfiguration({ maxAdContentRating: MaxAdContentRating.PG, tagForChildDirectedTreatment: false });
    await mobileAds().initialize();
  })().catch((e) => {
    ready = null; // let a later workout try again
    throw e instanceof AdFailure ? e : new AdFailure('sdk_init_failed');
  });
  return ready;
}

function errorCode(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  if (/no-fill/.test(code)) return 'no_fill';
  if (/network/.test(code)) return 'network';
  if (/timeout/.test(code)) return 'timeout';
  return 'provider_error';
}

export const networkAdProvider: InterstitialAdProvider = {
  availability(): AdAvailability {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') return { available: false, reason: 'unsupported_platform' };
    const unit = unitIdFor(config.ads);
    if (!unit) return { available: false, reason: 'not_configured' };
    return { available: true, network: 'admob', test: config.ads.mode === 'test' };
  },

  async load({ personalized, timeoutMs }): Promise<LoadedInterstitial> {
    const unit = unitIdFor(config.ads);
    if (!unit) throw new AdFailure('not_configured');
    await prepare();
    const ad = InterstitialAd.createForAdRequest(unit, { requestNonPersonalizedAdsOnly: !personalized });
    const off: (() => void)[] = [];
    const cleanup = () => off.splice(0).forEach((f) => f());

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        off.push(ad.addAdEventListener(AdEventType.LOADED, () => resolve()));
        off.push(ad.addAdEventListener(AdEventType.ERROR, (e) => reject(new AdFailure(errorCode(e)))));
        ad.load();
      }),
      timeoutMs,
      'timeout',
    ).catch((e) => {
      cleanup();
      throw e;
    });
    cleanup();

    return {
      show: ({ onShown }) =>
        new Promise<void>((resolve, reject) => {
          let opened = false;
          const fail = (code: string) => (cleanup(), reject(new AdFailure(code)));
          // If the full-screen ad never opens, don't leave the user waiting on it.
          const guard = setTimeout(() => !opened && fail('show_timeout'), 5000);
          off.push(
            ad.addAdEventListener(AdEventType.OPENED, () => {
              opened = true;
              clearTimeout(guard);
              onShown();
            }),
          );
          off.push(ad.addAdEventListener(AdEventType.CLOSED, () => (clearTimeout(guard), cleanup(), resolve())));
          off.push(ad.addAdEventListener(AdEventType.ERROR, () => (clearTimeout(guard), fail('show_failed'))));
          ad.show().catch(() => (clearTimeout(guard), fail('show_failed')));
        }),
      dispose: cleanup,
    };
  },
};
