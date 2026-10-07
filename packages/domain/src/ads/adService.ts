import { hasFeature, type Entitlements } from "../subscriptions/entitlements";
import type { AdCreative, AdProvider } from "./adProvider";

/**
 * AdService — Free-tier advertising.
 *
 * Pro users never see ads. Ads never appear during an active workout or camera
 * session. If the ad provider fails, FORM reports that no ad was served — it never
 * records a phantom impression.
 */

export const AD_PLACEMENTS = ["home_feed", "progress_footer", "recipe_list"] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export type AdDecision =
  | { served: true; creative: AdCreative }
  | {
      served: false;
      reason: "pro_user" | "placement_not_allowed" | "provider_unconfigured" | "provider_error";
      retryable: boolean;
    };

export async function requestAd(opts: {
  entitlements: Entitlements;
  placement: string;
  personalizedConsent: boolean;
  provider: AdProvider;
}): Promise<AdDecision> {
  if (hasFeature(opts.entitlements, "AD_FREE")) return { served: false, reason: "pro_user", retryable: false };
  if (!(AD_PLACEMENTS as readonly string[]).includes(opts.placement)) {
    return { served: false, reason: "placement_not_allowed", retryable: false };
  }

  const result = await opts.provider.requestAd({ placement: opts.placement, personalized: opts.personalizedConsent });
  if (!result.ok) {
    return {
      served: false,
      reason: result.code === "unconfigured" ? "provider_unconfigured" : "provider_error",
      retryable: result.retryable,
    };
  }
  return { served: true, creative: result.value };
}
