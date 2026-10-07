import { EtsyApiError, isEtsyAuthorizationFailure } from "@/collection/connectors/etsy/api";

/*
 * Etsy failures in words a seller can act on. Kept apart from the connector so
 * routes and tests can use them without loading the connector registry.
 */

export const ETSY_RECONNECT_MESSAGE = "Etsy authorization expired or was revoked. Reconnect Etsy.";
export const ETSY_APP_KEYS_MESSAGE = "Etsy rejected the app keystring or shared secret. Check both on the source page; the next sync uses the corrected keys.";

/** True when Etsy refused the app's keystring or shared secret rather than the seller's token. */
export function isEtsyAppKeyRejection(error: unknown) {
  if (!(error instanceof EtsyApiError)) return false;
  if (error.code === "invalid_client") return true;
  return (error.status === 401 || error.status === 403) && /api[ _-]?key|shared[ _-]?secret|keystring/iu.test(error.message);
}

/** A message for people, from an Etsy failure, with nothing secret in it. */
export function etsyFailureMessage(error: unknown) {
  if (error instanceof EtsyApiError) {
    if (error.code === "missing_app_keys" || error.code === "malformed_app_keys" || error.code === "too_many_receipts" || error.status === 429) return error.message;
    if (isEtsyAppKeyRejection(error)) return ETSY_APP_KEYS_MESSAGE;
    if (isEtsyAuthorizationFailure(error)) return ETSY_RECONNECT_MESSAGE;
    return `Etsy request failed: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Etsy request failed.";
}
