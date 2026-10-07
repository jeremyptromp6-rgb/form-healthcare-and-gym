import type { ProviderFailureCode } from "@form/domain";
import { HttpError } from "../http/errors";

/** Maps a provider failure to an honest HTTP error: 503 when not configured/available, never a fake success. */
export function providerFailure(result: { code: ProviderFailureCode; message: string; retryable: boolean }): HttpError {
  const status = result.code === "unconfigured" || result.code === "unavailable" ? 503 : result.code === "rate_limited" ? 429 : 502;
  return new HttpError(status, `provider_${result.code}`, result.message, { retryable: result.retryable });
}
