import type { ConnectorContext, ConnectorDefinition, SyncResult } from "@/collection/connectors/types";
import {
  EtsyApiError,
  etsyAppKeys,
  fetchEtsyReceipts,
  fetchEtsyShop,
  isEtsyAuthorizationFailure,
  refreshEtsyToken,
  type EtsyAuth,
  type EtsyTokenResponse,
} from "@/collection/connectors/etsy/api";
import {
  ETSY_DAILY_METRIC_KEYS,
  ETSY_FIELDS,
  ETSY_REFRESH_MARGIN_MS,
  ETSY_SCOPES,
} from "@/collection/connectors/etsy/constants";
import {
  aggregateEtsySnapshot,
  hashEtsySnapshot,
  isEtsySyncSnapshot,
  minimizeEtsyReceipt,
  type EtsyReceiptRecord,
  type EtsySyncSnapshot,
} from "@/collection/connectors/etsy/receipts";
import { detectEtsy } from "@/collection/connectors/etsy/detect";
import { ETSY_RECONNECT_MESSAGE, etsyFailureMessage } from "@/collection/connectors/etsy/errors";
import { etsySyncStartDate } from "@/collection/connectors/etsy/sync-window";
import { saveEtsyTokens } from "@/collection/connectors/etsy/tokens";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import type { JsonRecord } from "@/storage/db/schema";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { getSource, updateSource } from "@/storage/repositories/sources-repository";
import { dateKeyInAppTimeZone, startOfAppDateUtc } from "@/storage/runtime/app-time";

const DAY_SECONDS = 86_400;
/** No Etsy order is older than Etsy itself (2005). */
const ETSY_FIRST_ORDER_SECONDS = Date.UTC(2005, 0, 1) / 1000;
/** Receipts are requested a month at a time, as Etsy asks for long histories. */
const RECEIPT_WINDOW_SECONDS = 30 * DAY_SECONDS;

function etsyMetricDefinitions() {
  return metricDefinitions.filter((definition) => definition.source_type_key === "etsy");
}

function isTooManyReceipts(error: unknown) {
  return error instanceof EtsyApiError && error.code === "too_many_receipts";
}

/**
 * Calls Etsy as the connected shop, refreshing the one-hour access token when it
 * is about to expire or Etsy refuses it. Syncs hold the source lock, but a
 * connection test or a reconnect can replace the token pair at the same moment;
 * a refused refresh therefore checks for a newer saved pair before asking for a
 * reconnect. Null when the shop is not connected yet.
 */
function etsySession(ctx: ConnectorContext) {
  const { keystring, apiKey } = etsyAppKeys(ctx.credentials);
  let accessToken = ctx.credentials[ETSY_FIELDS.accessToken];
  let refreshToken = ctx.credentials[ETSY_FIELDS.refreshToken];
  const shopId = ctx.credentials[ETSY_FIELDS.shopId] ?? ctx.source.external_account_id ?? null;
  if (!accessToken || !refreshToken || !shopId) return null;
  let expiresAt = Date.parse(ctx.credentials[ETSY_FIELDS.tokenExpiresAt] ?? "");

  const refresh = async () => {
    let token: EtsyTokenResponse;
    try {
      token = await refreshEtsyToken({ keystring, refreshToken });
    } catch (error) {
      if (!isEtsyAuthorizationFailure(error)) throw new Error(etsyFailureMessage(error));
      const saved = await getDecryptedCredentialMap(ctx.source.id);
      const newerRefreshToken = saved[ETSY_FIELDS.refreshToken];
      const newerAccessToken = saved[ETSY_FIELDS.accessToken];
      if (!newerRefreshToken || !newerAccessToken || newerRefreshToken === refreshToken) throw new Error(ETSY_RECONNECT_MESSAGE);
      accessToken = newerAccessToken;
      refreshToken = newerRefreshToken;
      expiresAt = Date.parse(saved[ETSY_FIELDS.tokenExpiresAt] ?? "");
      return;
    }
    const saved = await saveEtsyTokens(ctx.source.id, token);
    accessToken = token.access_token;
    refreshToken = token.refresh_token;
    expiresAt = Date.parse(saved.expiresAt);
    const current = await getSource(ctx.source.id);
    await updateSource(ctx.source.id, {
      metadata: { ...(current?.metadata ?? ctx.source.metadata), token_expires_at: saved.expiresAt, refresh_expires_at: saved.refreshExpiresAt },
    });
    await recordConnectorEvent({
      source_id: ctx.source.id,
      event_type: "etsy_token_refreshed",
      severity: "info",
      message: "Etsy access token was refreshed server-side.",
      metadata: { sanitized: true },
    });
  };

  async function call<T>(request: (auth: EtsyAuth) => Promise<T>): Promise<T> {
    if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < ETSY_REFRESH_MARGIN_MS) await refresh();
    try {
      return await request({ apiKey, accessToken });
    } catch (error) {
      if (isTooManyReceipts(error)) throw error;
      if (!(error instanceof EtsyApiError) || error.status !== 401) throw new Error(etsyFailureMessage(error));
    }
    await refresh();
    try {
      return await request({ apiKey, accessToken });
    } catch (error) {
      if (isTooManyReceipts(error)) throw error;
      throw new Error(etsyFailureMessage(error));
    }
  }

  return { shopId, call };
}

const SETUP = [
  "At etsy.com/developers/your-apps, create an app for your shop and add the callback URL shown on this source's page, exactly as written.",
  "Copy the app's keystring and shared secret into this source's encrypted fields. They stay on the server and are never shown again.",
  "Choose Connect Etsy and approve read-only access to your shop, listings, and orders. Access renews itself while syncs run; reconnect only when the dashboard asks.",
  "Every hour the sync reads orders, item sales, units, refunds, and active listings. Shop visits aren't part of it; traffic comes from the Website tracker.",
];

function skipped(reason: string, message = reason): SyncResult {
  return { rawPayloads: [], recordsFetched: 0, skippedReason: reason, message };
}

export const etsyConnector: ConnectorDefinition = {
  key: "etsy",
  displayName: "Etsy",
  description: "Orders, item sales, units, refunds, and active listings for your Etsy shop, through the official Etsy Open API v3 with read-only OAuth.",
  category: "Commerce",
  icon: "Store",
  availability: "live",
  setupKind: "oauth",
  defaultSyncMode: "hourly",
  urlPatterns: [
    /^https:\/\/((www|m)\.)?etsy\.com\/([a-z]{2}(-[a-z]{2})?\/)?(shop|listing)\/[^/?#]+/i,
    /^https:\/\/[a-z0-9][a-z0-9-]*\.etsy\.com\/?/i,
    /^https:\/\/etsy\.me\/[^/?#]+/i,
  ],
  requiredFields: [
    {
      key: ETSY_FIELDS.keystring,
      label: "Etsy app keystring",
      description: "From etsy.com/developers → Your apps. Encrypted server-side.",
      required: true,
      secret: true,
      type: "password",
    },
    {
      key: ETSY_FIELDS.sharedSecret,
      label: "Etsy app shared secret",
      description: "Shown next to the keystring on Etsy. Encrypted server-side; only a short hint is ever shown again.",
      required: true,
      secret: true,
      type: "password",
    },
  ],
  optionalFields: [],
  authType: "etsy_oauth2_pkce",
  docsUrl: "https://developers.etsy.com/documentation/",
  capabilities: {
    supportsWebhook: false,
    supportsPolling: true,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 60,
    canBackfill: true,
    canTestConnection: true,
  },
  detect(inputUrl) {
    const detected = detectEtsy(inputUrl);
    if (!detected) return null;
    return {
      sourceTypeKey: "etsy",
      displayName: "Etsy",
      availability: "live",
      setupKind: "oauth",
      confidence: detected.confidence,
      normalizedUrl: detected.normalizedUrl,
      accountName: detected.accountName ?? null,
      reasons: detected.reasons,
      requiredSetup: SETUP,
      possibleMetrics: etsyMetricDefinitions().map((definition) => definition.key),
      demoAvailable: false,
    };
  },
  async testConnection(ctx) {
    let session: ReturnType<typeof etsySession>;
    try {
      session = etsySession(ctx);
    } catch (error) {
      return { ok: false, status: "needs_credentials", message: etsyFailureMessage(error) };
    }
    if (!session) {
      return { ok: false, status: "needs_credentials", message: "Connect Etsy to authorize read-only access to your shop." };
    }
    const { shopId, call } = session;
    try {
      const shop = await call((auth) => fetchEtsyShop(auth, shopId));
      return {
        ok: true,
        status: "connected",
        message: `Connected to the Etsy shop ${shop.shop_name ?? shopId}.`,
        details: { shop_id: shopId, active_listings: shop.listing_active_count ?? null, scopes: [...ETSY_SCOPES] },
      };
    } catch (error) {
      return { ok: false, status: "error", message: error instanceof Error ? error.message : "Etsy connection test failed." };
    }
  },
  async sync(ctx): Promise<SyncResult> {
    let session: ReturnType<typeof etsySession>;
    try {
      session = etsySession(ctx);
    } catch (error) {
      return skipped(etsyFailureMessage(error));
    }
    if (!session) return skipped("Connect Etsy to start syncing.");
    const { shopId, call } = session;

    const now = new Date();
    const endDate = dateKeyInAppTimeZone(now);
    const startDate = etsySyncStartDate(endDate, ctx.source.last_success_at);
    const startSeconds = Math.floor(Date.parse(startOfAppDateUtc(startDate)) / 1000);
    const nowSeconds = Math.floor(now.getTime() / 1000);

    // Receipts placed between two times; a stretch with more than Etsy pages through is read in halves, down to a day.
    const createdBetween = async (from: number, to: number, filter: { minLastModified?: number } = {}): Promise<unknown[]> => {
      try {
        return await call((auth) => fetchEtsyReceipts(auth, shopId, { ...filter, minCreated: from, maxCreated: to }));
      } catch (error) {
        if (!isTooManyReceipts(error) || to - from < DAY_SECONDS) throw error;
        const middle = from + Math.floor((to - from) / 2);
        return [...await createdBetween(from, middle, filter), ...await createdBetween(middle + 1, to, filter)];
      }
    };

    const shop = await call((auth) => fetchEtsyShop(auth, shopId));
    const raw: unknown[] = [];
    for (let from = startSeconds; from <= nowSeconds; from += RECEIPT_WINDOW_SECONDS) {
      raw.push(...await createdBetween(from, Math.min(from + RECEIPT_WINDOW_SECONDS - 1, nowSeconds)));
    }
    // Older orders that changed since the window began carry refunds issued in it. Leaving the
    // last-modified filter open keeps an order that changes during the sync in the set, so paging never skips one.
    raw.push(...await createdBetween(ETSY_FIRST_ORDER_SECONDS, startSeconds - 1, { minLastModified: startSeconds }));

    const receipts = new Map<string, EtsyReceiptRecord>();
    for (const item of raw) {
      const receipt = minimizeEtsyReceipt(item);
      if (receipt) receipts.set(receipt.receiptId, receipt);
    }
    const currency = typeof shop.currency_code === "string" && /^[A-Za-z]{3}$/u.test(shop.currency_code) ? shop.currency_code.toLowerCase() : null;
    const snapshot: EtsySyncSnapshot = {
      kind: "etsy_sync_snapshot",
      fetchedAt: now.toISOString(),
      window: { startDate, endDate },
      shop: {
        shopId,
        shopName: typeof shop.shop_name === "string" ? shop.shop_name : null,
        currency,
        url: typeof shop.url === "string" ? shop.url : null,
        activeListings: typeof shop.listing_active_count === "number" ? shop.listing_active_count : null,
      },
      receipts: [...receipts.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    };
    return {
      rawPayloads: [{
        externalId: `etsy:${shopId}:${endDate}`,
        fetchedAt: snapshot.fetchedAt,
        payloadHash: hashEtsySnapshot(snapshot),
        payload: snapshot as unknown as JsonRecord,
        cursor: { startDate, endDate },
      }],
      recordsFetched: receipts.size,
      cursorAfter: { startDate, endDate, shopId },
      message: `Etsy sync read ${receipts.size} order${receipts.size === 1 ? "" : "s"} from ${startDate} to ${endDate}.`,
    };
  },
  async normalize(rawPayloads, source) {
    const snapshot = rawPayloads.map((rawPayload) => rawPayload.payload).filter(isEtsySyncSnapshot).at(-1);
    if (!snapshot) return { metrics: [] };
    const { metrics, snapshotMetrics } = aggregateEtsySnapshot(snapshot, source.id);
    return {
      metrics,
      // Every day of the window is rewritten, so orders that were canceled or refunded since the last sync leave nothing stale.
      replaceMetricWindow: { metricKeys: [...ETSY_DAILY_METRIC_KEYS], startDate: snapshot.window.startDate, endDate: snapshot.window.endDate },
      // The listing count is kept per sync date, outside the window, so earlier days keep theirs.
      snapshotMetrics,
    };
  },
  getMetricDefinitions() {
    return etsyMetricDefinitions();
  },
  getSetupInstructions() {
    return SETUP;
  },
};
