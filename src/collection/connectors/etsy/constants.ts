/*
 * Etsy Open API v3. A seller connects their own shop through a Seller App they
 * register at etsy.com/developers; every request carries the app's
 * "keystring:shared_secret" in x-api-key and the shop owner's OAuth token.
 * https://developers.etsy.com/documentation/essentials/authentication
 */

export const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
export const ETSY_API_BASE_URL = "https://api.etsy.com/v3/application";

/** Read-only: the shop, its listings, and its receipts (orders). */
export const ETSY_SCOPES = ["shops_r", "listings_r", "transactions_r"] as const;

/** Etsy access tokens last one hour; refresh tokens 90 days. */
export const ETSY_REFRESH_TOKEN_LIFETIME_DAYS = 90;
/** Refresh this long before the access token expires. */
export const ETSY_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Credential field keys. The app keys come from the seller; everything else is written by the OAuth callback. */
export const ETSY_FIELDS = {
  keystring: "etsy_keystring",
  sharedSecret: "etsy_shared_secret",
  accessToken: "etsy_access_token",
  refreshToken: "etsy_refresh_token",
  tokenExpiresAt: "etsy_token_expires_at",
  refreshExpiresAt: "etsy_refresh_expires_at",
  scope: "etsy_scope",
  userId: "etsy_user_id",
  shopId: "etsy_shop_id",
  connectedAt: "etsy_connected_at",
} as const;

export const ETSY_DAILY_METRIC_KEYS = ["etsy_orders", "etsy_sales", "etsy_units_sold", "etsy_refunds"] as const;
export const ETSY_SNAPSHOT_METRIC_KEYS = ["etsy_active_listings"] as const;
export const ETSY_METRIC_KEYS = [...ETSY_DAILY_METRIC_KEYS, ...ETSY_SNAPSHOT_METRIC_KEYS];
export const ETSY_DEFINITION_VERSION = "etsy-receipts-v1";

/** Days each sync recomputes; the first sync of a shop reaches back a year. */
export const ETSY_SYNC_WINDOW_DAYS = 35;
export const ETSY_BACKFILL_DAYS = 365;
