import type { ProviderBase, ProviderResult } from "../providers/result";

export interface AdCreative {
  adId: string;
  network: string;
  placement: string;
}

export interface AdProvider extends ProviderBase {
  readonly kind: "ads";
  requestAd(req: { placement: string; personalized: boolean }): Promise<ProviderResult<AdCreative>>;
}
