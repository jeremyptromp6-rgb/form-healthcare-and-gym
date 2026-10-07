/**
 * Shared contract for every external capability. A provider reports its own status and
 * returns a ProviderResult; an unconfigured provider says so and never fabricates output.
 */

export type ProviderKind = "ai" | "pose" | "food_recognition" | "billing" | "ads" | "analytics" | "notifications";

export type ProviderFailureCode =
  | "unconfigured"
  | "unavailable"
  | "permission_denied"
  | "network"
  | "invalid_input"
  | "rate_limited";

export type ProviderResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ProviderFailureCode; message: string; retryable: boolean };

export type ProviderStatus =
  | { state: "ready"; provider: string }
  | { state: "unconfigured"; provider: string; missing: string[] }
  | { state: "degraded"; provider: string; reason: string };

export interface ProviderBase {
  readonly kind: ProviderKind;
  status(): ProviderStatus;
}

export function fail<T = never>(
  code: ProviderFailureCode,
  message: string,
  retryable = code === "network" || code === "unavailable" || code === "rate_limited",
): ProviderResult<T> {
  return { ok: false, code, message, retryable };
}
