import { AdFailure, type InterstitialAdProvider } from './provider';

/** The ad network is mobile-only. On the web there is no ad — the app reports it and simply continues. */
export const networkAdProvider: InterstitialAdProvider = {
  availability: () => ({ available: false, reason: 'unsupported_platform' }),
  load: async () => {
    throw new AdFailure('unsupported_platform');
  },
};
