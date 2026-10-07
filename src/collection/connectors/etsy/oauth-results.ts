import { EtsyApiError } from "@/collection/connectors/etsy/api";
import { isEtsyAppKeyRejection } from "@/collection/connectors/etsy/errors";

/*
 * How an Etsy connection attempt ended, as the source page explains it. The
 * OAuth routes put only a reason code in the URL and the page maps it to fixed
 * text, so a crafted link cannot put its own words on the dashboard.
 */

export const ETSY_OAUTH_REASONS = [
  "denied",
  "expired",
  "no_code",
  "no_shop",
  "different_shop",
  "callback_mismatch",
  "app_keys_missing",
  "app_keys_malformed",
  "app_keys_rejected",
  "rate_limited",
  "disabled",
  "failed",
] as const;

export type EtsyOAuthReason = (typeof ETSY_OAUTH_REASONS)[number];

export function isEtsyOAuthReason(value: unknown): value is EtsyOAuthReason {
  return typeof value === "string" && (ETSY_OAUTH_REASONS as readonly string[]).includes(value);
}

/** Raised when the Etsy account that approved access does not own this source's shop. */
export class EtsyShopMismatchError extends Error {
  reason: "no_shop" | "different_shop";
  constructor(reason: "no_shop" | "different_shop") {
    super(reason === "no_shop" ? "The Etsy account has no shop." : "The Etsy account owns a different shop than this source's.");
    this.name = "EtsyShopMismatchError";
    this.reason = reason;
  }
}

export function etsyOAuthFailureReason(error: unknown): EtsyOAuthReason {
  if (error instanceof EtsyShopMismatchError) return error.reason;
  if (!(error instanceof EtsyApiError)) return "failed";
  if (error.code === "missing_app_keys") return "app_keys_missing";
  if (error.code === "malformed_app_keys") return "app_keys_malformed";
  if (isEtsyAppKeyRejection(error)) return "app_keys_rejected";
  // A wrong callback URL, a code used twice, or one that expired all come back as invalid_grant.
  if (error.code === "invalid_grant") return "callback_mismatch";
  if (error.status === 429) return "rate_limited";
  return "failed";
}

/** The sentence the source page shows for a failed attempt. `shopName` is the shop this source is for, when known. */
export function etsyOAuthErrorMessage(reason: EtsyOAuthReason, shopName: string | null) {
  switch (reason) {
    case "denied":
      return "Etsy access wasn't granted, so nothing changed.";
    case "expired":
      return "The Etsy sign-in took too long, or finished in a different browser than it started in. Connect Etsy again.";
    case "no_code":
      return "Etsy didn't send an authorization code. Connect Etsy again.";
    case "no_shop":
      return "The Etsy account you approved with has no shop. Sign in to Etsy as the shop owner, then connect again.";
    case "different_shop":
      return shopName
        ? `The Etsy account you approved with doesn't own ${shopName}. Sign in to Etsy as the owner of ${shopName}, or add a new Etsy source for the other shop.`
        : "The Etsy account you approved with owns a different shop than this source's. Sign in to Etsy as this shop's owner, or add a new Etsy source for the other shop.";
    case "callback_mismatch":
      return "Etsy didn't accept the authorization. Check that your Etsy app's callback URL is exactly the one shown below, then connect again.";
    case "app_keys_missing":
      return "Add your Etsy app's keystring and shared secret below, then connect Etsy.";
    case "app_keys_malformed":
      return "The keystring and shared secret go in separate fields, without spaces or a colon. Check both below, then connect Etsy.";
    case "app_keys_rejected":
      return "Etsy rejected the app's keystring or shared secret. Check both below, then connect again.";
    case "rate_limited":
      return "Etsy's rate limit was reached. Wait a minute, then connect again.";
    case "disabled":
      return "This source is disabled, so it can't be connected.";
    case "failed":
      return "Connecting to Etsy didn't finish. Try again; if it keeps failing, the Health page shows the error Etsy returned.";
  }
}
