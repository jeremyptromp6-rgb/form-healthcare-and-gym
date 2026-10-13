import type { InterstitialAdProvider } from './provider';

/** How long the AdMob adapter waits on each set-up step (A2-23). A fresh module per test: set-up is cached per app run. */

type Consent = { gatherConsent: jest.Mock; getConsentInfo: jest.Mock };

function load(opts: { consent: () => Promise<unknown>; initialize?: () => Promise<unknown> }): { provider: InterstitialAdProvider; consent: Consent; initialize: jest.Mock; ad: { load: jest.Mock } } {
  const consent: Consent = { gatherConsent: jest.fn(opts.consent), getConsentInfo: jest.fn(() => Promise.resolve({ canRequestAds: false })) };
  const initialize = jest.fn(opts.initialize ?? (() => Promise.resolve([])));
  const ad = { load: jest.fn(), addAdEventListener: jest.fn(() => () => undefined), show: jest.fn() };
  let provider!: InterstitialAdProvider;
  jest.isolateModules(() => {
    jest.doMock('react-native-google-mobile-ads', () => ({
      __esModule: true,
      default: () => ({ initialize, setRequestConfiguration: jest.fn(() => Promise.resolve()) }),
      AdEventType: { LOADED: 'loaded', ERROR: 'error', OPENED: 'opened', CLOSED: 'closed' },
      AdsConsent: consent,
      InterstitialAd: { createForAdRequest: jest.fn(() => ad) },
      MaxAdContentRating: { PG: 'PG' },
      TestIds: { INTERSTITIAL: 'test-interstitial' },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module per test needs a synchronous require
    provider = require('./networkProvider').networkAdProvider;
  });
  return { provider, consent, initialize, ad };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('does not drop a user who takes a while with the consent form', async () => {
  // They read the form for 60 s, then agree: the old 8 s limit would have discarded that answer.
  const { provider, ad } = load({ consent: () => new Promise((r) => setTimeout(() => r({ canRequestAds: true }), 60_000)) });
  const loading = provider.load({ personalized: false, timeoutMs: 1000 });
  loading.catch(() => undefined);
  await jest.advanceTimersByTimeAsync(60_001);
  expect(ad.load).toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1001);
  await expect(loading).rejects.toMatchObject({ code: 'timeout' }); // the ad itself never answers; consent was not the failure
});

it('gives up on a consent step that never answers, and retries on the next workout', async () => {
  const { provider, consent } = load({ consent: () => new Promise(() => undefined) });
  const first = provider.load({ personalized: false, timeoutMs: 1000 });
  first.catch(() => undefined);
  await jest.advanceTimersByTimeAsync(120_001);
  await expect(first).rejects.toMatchObject({ code: 'consent_required' });
  const second = provider.load({ personalized: false, timeoutMs: 1000 });
  second.catch(() => undefined);
  await jest.advanceTimersByTimeAsync(0);
  expect(consent.gatherConsent).toHaveBeenCalledTimes(2);
});

it('times out an SDK start-up that never finishes instead of hanging', async () => {
  const { provider } = load({ consent: () => Promise.resolve({ canRequestAds: true }), initialize: () => new Promise(() => undefined) });
  const loading = provider.load({ personalized: false, timeoutMs: 1000 });
  loading.catch(() => undefined);
  await jest.advanceTimersByTimeAsync(15_001);
  await expect(loading).rejects.toMatchObject({ code: 'sdk_init_timeout' });
});
