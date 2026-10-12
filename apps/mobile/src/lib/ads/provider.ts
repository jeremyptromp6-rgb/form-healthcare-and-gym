/**
 * The app's ad-provider boundary. Screens and the AdService only see this interface — never an ad
 * SDK — so the network can change (or be absent) without touching any screen.
 */

export type AdAvailability = { available: true; network: string; test: boolean } | { available: false; reason: 'not_configured' | 'unsupported_platform' };

export interface LoadedInterstitial {
  /** Shows the ad full screen. Resolves when the user closes it; rejects with a short code if it can't be shown. */
  show(events: { onShown: () => void }): Promise<void>;
  /** Releases the ad without showing it. */
  dispose(): void;
}

export interface InterstitialAdProvider {
  availability(): AdAvailability;
  /**
   * Loads one interstitial (asking for consent first where the network requires it). Rejects with a
   * short reason code — e.g. "consent_required", "no_fill", "network", "timeout" — never throws raw.
   */
  load(opts: { personalized: boolean; timeoutMs: number }): Promise<LoadedInterstitial>;
}

/** An Error whose message is a short reason code, safe to report (no SDK text, no user data). */
export class AdFailure extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function failureCode(e: unknown): string {
  if (e instanceof AdFailure) return e.code;
  return 'provider_error';
}
