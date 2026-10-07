import type { ProviderBase, ProviderResult } from "../providers/result";

export interface NotificationProvider extends ProviderBase {
  readonly kind: "notifications";
  /** Messages must not contain health, body or nutrition details (they appear on lock screens). */
  send(msg: { userId: string; title: string; body: string }): Promise<ProviderResult<void>>;
}
