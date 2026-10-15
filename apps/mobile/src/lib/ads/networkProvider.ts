import { AdFailure, type InterstitialAdProvider } from './provider';

/**
 * FORM ships without ads. This is the app's only InterstitialAdProvider and it is never available, so
 * usePostWorkoutAd never asks the server for an ad and Done goes straight Home. There is no ad SDK in
 * the build (no advertising ID, no consent form, no ad network traffic).
 *
 * To bring ads back later: install a network SDK, implement InterstitialAdProvider against it here
 * (availability() true when configured, load() returning a LoadedInterstitial), and add its config
 * plugin. The hook, the server's AdEligibilityService and the summary copy are already in place.
 */
export const networkAdProvider: InterstitialAdProvider = {
  availability: () => ({ available: false, reason: 'not_configured' }),
  load: async () => {
    throw new AdFailure('not_configured');
  },
};
