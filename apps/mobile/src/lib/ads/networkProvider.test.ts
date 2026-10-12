import { AdsConsent, InterstitialAd } from 'react-native-google-mobile-ads';
import { networkAdProvider } from './networkProvider';

/** The AdMob adapter, against the SDK mock from test/setup.ts plus a scriptable interstitial. */

type Listener = (e?: unknown) => void;
function fakeInterstitial() {
  const listeners = new Map<string, Set<Listener>>();
  const ad = {
    load: jest.fn(),
    show: jest.fn(() => Promise.resolve()),
    addAdEventListener: jest.fn((type: string, fn: Listener) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
      return () => set.delete(fn);
    }),
    emit: (type: string, e?: unknown) => [...(listeners.get(type) ?? [])].forEach((fn) => fn(e)),
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  return ad;
}

const consent = AdsConsent as unknown as { gatherConsent: jest.Mock; getConsentInfo: jest.Mock };
const create = InterstitialAd.createForAdRequest as unknown as jest.Mock;

// Consent + SDK set-up is prepared once per app run (and retried after a failure), so the
// consent-denied case runs first, before a successful set-up is cached for the rest of the file.
const provider = async () => networkAdProvider;

beforeEach(() => {
  consent.gatherConsent.mockReset().mockResolvedValue({ canRequestAds: true });
  consent.getConsentInfo.mockReset().mockResolvedValue({ canRequestAds: false });
  create.mockReset();
});

it('serves nothing when consent says ads may not be requested', async () => {
  consent.gatherConsent.mockResolvedValue({ canRequestAds: false });
  const p = await provider();
  await expect(p.load({ personalized: false, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'consent_required' });
  expect(create).not.toHaveBeenCalled();
});

it('is available on the phone in a development build, with Google test ads only', async () => {
  const p = await provider();
  expect(p.availability()).toEqual({ available: true, network: 'admob', test: true });
});

it('asks for consent first, then requests a non-personalized test interstitial', async () => {
  const ad = fakeInterstitial();
  create.mockReturnValue(ad);
  const p = await provider();
  const loading = p.load({ personalized: false, timeoutMs: 1000 });
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  expect(consent.gatherConsent).toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith('test-interstitial', { requestNonPersonalizedAdsOnly: true });
  ad.emit('loaded');
  const loaded = await loading;
  const onShown = jest.fn();
  const showing = loaded.show({ onShown });
  ad.emit('opened');
  ad.emit('closed');
  await showing;
  expect(onShown).toHaveBeenCalledTimes(1);
  expect(ad.listenerCount()).toBe(0); // nothing left listening
});


it('maps SDK load errors to short codes and times out a load that never answers', async () => {
  const ad = fakeInterstitial();
  create.mockReturnValue(ad);
  const p = await provider();
  const failing = p.load({ personalized: true, timeoutMs: 1000 });
  await new Promise((r) => setTimeout(r, 0));
  ad.emit('error', { code: 'googleMobileAds/error-code-no-fill' });
  await expect(failing).rejects.toMatchObject({ code: 'no_fill' });

  const silent = fakeInterstitial();
  create.mockReturnValue(silent);
  await expect(p.load({ personalized: true, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  expect(silent.listenerCount()).toBe(0);
});

it('a show that fails or never opens rejects instead of hanging the user', async () => {
  const ad = fakeInterstitial();
  ad.show.mockRejectedValue(new Error('activity gone'));
  create.mockReturnValue(ad);
  const p = await provider();
  const loading = p.load({ personalized: false, timeoutMs: 1000 });
  await new Promise((r) => setTimeout(r, 0));
  ad.emit('loaded');
  const loaded = await loading;
  await expect(loaded.show({ onShown: jest.fn() })).rejects.toMatchObject({ code: 'show_failed' });
});
