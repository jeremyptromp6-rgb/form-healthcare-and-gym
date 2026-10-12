// Tests run as if the OS "reduce motion" setting were on: every animation jumps straight to its end
// state (a path the app supports for real users), so no animation updates land outside act().
jest.mock('@/lib/a11y', () => ({ useReducedMotion: () => true }));

// The ad network's native SDK doesn't exist under Jest. Tests that care about ads inject their own
// provider into the AdService; everything else just needs the import to resolve. The mock never
// "serves" anything on its own.
jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({ initialize: jest.fn(() => Promise.resolve([])), setRequestConfiguration: jest.fn(() => Promise.resolve()) }),
  AdEventType: { LOADED: 'loaded', ERROR: 'error', OPENED: 'opened', CLOSED: 'closed' },
  AdsConsent: { gatherConsent: jest.fn(() => Promise.resolve({ canRequestAds: false })), getConsentInfo: jest.fn(() => Promise.resolve({ canRequestAds: false })) },
  InterstitialAd: { createForAdRequest: jest.fn() },
  MaxAdContentRating: { G: 'G', PG: 'PG', T: 'T', MA: 'MA' },
  TestIds: { INTERSTITIAL: 'test-interstitial' },
}));
