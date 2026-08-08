import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import type {
  ConnectionTestResult,
  ConnectorDefinition,
  NormalizedMetric,
  RawPayload,
} from "@/collection/connectors/types";
import {
  fetchMetaAdAccounts,
  fetchMetaAdsSnapshot,
  getMetaAdsConfig,
  hashMetaAdsSnapshot,
  isMetaAdsSyncSnapshot,
  isMetaAdsTokenExpired,
  metaAdsActionValue,
  META_ADS_DEFAULT_LOOKBACK_DAYS,
  META_ADS_MAX_LOOKBACK_DAYS,
  normalizeMetaAdAccountId,
  parseMetaAdsUrlTags,
  sanitizeMetaAdsErrorMessage,
  selectMetaAdsAccessToken,
  type MetaAdAccount,
  type MetaAdMetadata,
  type MetaAdsInsightRow,
  type MetaAdsSyncSnapshot,
} from "@/collection/connectors/meta-ads/api";
import type { JsonRecord, Source } from "@/storage/db/schema";

export const META_ADS_METRIC_KEYS = [
  "meta_ads_spend",
  "meta_ads_impressions",
  "meta_ads_reach",
  "meta_ads_frequency",
  "meta_ads_clicks",
  "meta_ads_outbound_clicks",
  "meta_ads_inline_link_clicks",
  "meta_ads_ctr",
  "meta_ads_cpc",
  "meta_ads_cpm",
  "meta_ads_landing_page_views",
  "meta_ads_view_content",
  "meta_ads_add_to_cart",
  "meta_ads_initiate_checkout",
  "meta_ads_purchases",
  "meta_ads_purchase_value",
  "meta_ads_cost_per_purchase",
  "meta_ads_purchase_roas",
  "meta_ads_website_purchase_roas",
  "meta_ads_post_saves",
  "meta_ads_post_reactions",
  "meta_ads_comments",
  "meta_ads_post_engagements",
  "meta_ads_video_p25",
  "meta_ads_video_p50",
  "meta_ads_video_p75",
  "meta_ads_video_p95",
  "meta_ads_video_p100",
  "meta_ads_video_thruplay",
] as const;

const LANDING_PAGE_VIEW_ACTIONS = ["landing_page_view", "omni_landing_page_view"] as const;
const VIEW_CONTENT_ACTIONS = ["offsite_conversion.fb_pixel_view_content", "view_content", "omni_view_content"] as const;
const ADD_TO_CART_ACTIONS = ["offsite_conversion.fb_pixel_add_to_cart", "add_to_cart", "omni_add_to_cart"] as const;
const CHECKOUT_ACTIONS = ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout", "omni_initiated_checkout"] as const;
const PURCHASE_ACTIONS = ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase"] as const;
const POST_SAVE_ACTIONS = ["post_save", "onsite_conversion.post_save"] as const;
const POST_REACTION_ACTIONS = ["post_reaction"] as const;
const COMMENT_ACTIONS = ["comment"] as const;
const POST_ENGAGEMENT_ACTIONS = ["post_engagement"] as const;
const OUTBOUND_CLICK_ACTIONS = ["outbound_click"] as const;
const VIDEO_VIEW_ACTIONS = ["video_view"] as const;

function validUrl(inputUrl: string) {
  try {
    return new URL(inputUrl);
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMetric(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function utcDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateKeyInTimeZone(value: Date, timeZone?: string) {
  if (!timeZone) return utcDateKey(value);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
  } catch {
    throw new Error("Meta ad account returned an invalid IANA time zone.");
  }
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) throw new Error("Could not calculate the Meta ad account local date.");
  return `${year}-${month}-${day}`;
}

function syncNow() {
  const configured = process.env.DEMO_NOW?.trim();
  const date = configured ? new Date(configured) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function lookbackDays(credentials: Record<string, string>) {
  const requested = Number.parseInt(credentials.meta_ads_lookback_days || "", 10);
  if (!Number.isFinite(requested)) return META_ADS_DEFAULT_LOOKBACK_DAYS;
  return Math.min(META_ADS_MAX_LOOKBACK_DAYS, Math.max(1, requested));
}

function metricWindow(credentials: Record<string, string>, accountTimeZone?: string, now = syncNow()) {
  const endDate = dateKeyInTimeZone(now, accountTimeZone);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (lookbackDays(credentials) - 1));
  return { startDate: utcDateKey(start), endDate };
}

function chooseAccount(accounts: MetaAdAccount[], requestedId?: string | null) {
  if (requestedId) {
    const normalized = normalizeMetaAdAccountId(requestedId);
    const account = accounts.find((candidate) => normalizeMetaAdAccountId(candidate.id) === normalized);
    if (!account) throw new Error("The selected Meta ad account is not available to this OAuth connection.");
    return account;
  }
  if (accounts.length === 0) throw new Error("No Meta ad accounts are available to this OAuth connection.");
  if (accounts.length > 1) throw new Error("Multiple Meta ad accounts are available. Select an ad account before syncing.");
  return accounts[0];
}

function selectedAccountId(credentials: Record<string, string>) {
  return credentials.meta_ad_account_id || credentials.meta_ads_account_id || "";
}

function accountDetails(account: MetaAdAccount): JsonRecord {
  return {
    adAccountId: account.id,
    accountName: account.name ?? null,
    accountStatus: account.account_status ?? null,
    currency: account.currency ?? null,
    timezone: account.timezone_name ?? null,
  };
}

function connectionFailure(error: unknown): ConnectionTestResult {
  return {
    ok: false,
    status: "error",
    message: sanitizeMetaAdsErrorMessage(error instanceof Error ? error.message : error),
    details: { sanitized: true },
  };
}

function metadataByAdId(snapshot: MetaAdsSyncSnapshot) {
  return new Map(snapshot.ads.map((ad) => [ad.id, ad]));
}

function stableText(value: unknown, maxLength = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function utmDimensions(ad: MetaAdMetadata | undefined): JsonRecord {
  const creativeUtm = parseMetaAdsUrlTags(ad?.creative?.url_tags);
  const value = (key: "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term") =>
    stableText(creativeUtm[key]);
  return {
    utm_source: value("utm_source"),
    utm_medium: value("utm_medium"),
    utm_campaign: value("utm_campaign"),
    utm_content: value("utm_content"),
    utm_term: value("utm_term"),
  };
}

function creativeType(ad: MetaAdMetadata | undefined, utm: JsonRecord) {
  const semanticHint = [stableText(utm.utm_content), stableText(ad?.name), stableText(ad?.creative?.name)]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  if (/(^|[^a-z])story([^a-z]|$)/iu.test(semanticHint)) return { type: "story", source: "utm_or_name" };
  if (/(^|[^a-z])reel([^a-z]|$)/iu.test(semanticHint)) return { type: "reel", source: "utm_or_name" };
  if (/(^|[^a-z])video([^a-z]|$)/iu.test(semanticHint)) return { type: "video", source: "utm_or_name" };
  if (/(^|[^a-z])(image|png|jpe?g)([^a-z]|$)/iu.test(semanticHint)) return { type: "image", source: "utm_or_name" };
  return {
    type: ad?.creative?.object_type?.toLowerCase() ?? null,
    source: ad?.creative?.object_type ? "meta_object_type" : null,
  };
}

function metricDimensions(snapshot: MetaAdsSyncSnapshot, source: Source, row: MetaAdsInsightRow, ad: MetaAdMetadata | undefined): JsonRecord {
  const creative = ad?.creative;
  const utm = utmDimensions(ad);
  const creativeClassification = creativeType(ad, utm);
  return {
    rollup: "ad_daily",
    definition_version: "meta-ads-v1",
    attribution_setting: stableText(row.attribution_setting) ?? "account",
    account_id: stableText(row.account_id) ?? snapshot.account.account_id ?? snapshot.account.id.replace(/^act_/u, ""),
    account_name: stableText(row.account_name) ?? snapshot.account.name ?? null,
    account_currency: snapshot.account.currency ?? null,
    account_timezone: snapshot.account.timezone_name ?? null,
    account_status: snapshot.account.account_status ?? null,
    campaign_id: stableText(row.campaign_id) ?? ad?.campaign?.id ?? null,
    campaign_name: stableText(row.campaign_name) ?? ad?.campaign?.name ?? null,
    campaign_status: ad?.campaign?.effective_status ?? ad?.campaign?.status ?? null,
    campaign_objective: ad?.campaign?.objective ?? null,
    adset_id: stableText(row.adset_id) ?? ad?.adset?.id ?? null,
    adset_name: stableText(row.adset_name) ?? ad?.adset?.name ?? null,
    adset_status: ad?.adset?.effective_status ?? ad?.adset?.status ?? null,
    ad_id: stableText(row.ad_id) ?? ad?.id ?? null,
    ad_name: stableText(row.ad_name) ?? ad?.name ?? null,
    ad_status: ad?.effective_status ?? ad?.status ?? null,
    delivery_status: ad?.effective_status ?? ad?.status ?? null,
    creative_id: creative?.id ?? null,
    creative_name: creative?.name ?? null,
    creative_type: creativeClassification.type,
    creative_type_source: creativeClassification.source,
    meta_creative_object_type: creative?.object_type ?? null,
    quality_ranking: stableText(row.quality_ranking),
    engagement_rate_ranking: stableText(row.engagement_rate_ranking),
    conversion_rate_ranking: stableText(row.conversion_rate_ranking),
    ...utm,
  };
}

function normalizedMetric(
  date: string,
  source: Source,
  metricKey: (typeof META_ADS_METRIC_KEYS)[number],
  value: number,
  unit: string,
  dimensions: JsonRecord,
): NormalizedMetric {
  return {
    date,
    sourceId: source.id,
    sourceTypeKey: "meta_ads",
    metricKey,
    metricValue: roundMetric(value),
    unit,
    dimensions,
  };
}

function actionOrZero(actions: MetaAdsInsightRow["actions"], actionTypes: readonly string[]) {
  return metaAdsActionValue(actions, actionTypes) ?? 0;
}

function videoOrZero(actions: MetaAdsActionArray) {
  return metaAdsActionValue(actions, VIDEO_VIEW_ACTIONS) ?? 0;
}

type MetaAdsActionArray = MetaAdsInsightRow["actions"];

function normalizeInsightRow(snapshot: MetaAdsSyncSnapshot, source: Source, row: MetaAdsInsightRow, ad: MetaAdMetadata | undefined) {
  const date = stableText(row.date_start, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) return [];
  const dimensions = metricDimensions(snapshot, source, row, ad);
  const currencyUnit = snapshot.account.currency?.toLowerCase() || "currency";
  const spend = finiteNumber(row.spend) ?? 0;
  const impressions = finiteNumber(row.impressions) ?? 0;
  const reach = finiteNumber(row.reach) ?? 0;
  const clicks = finiteNumber(row.clicks) ?? 0;
  const inlineLinkClicks = finiteNumber(row.inline_link_clicks) ?? 0;
  const outboundClicks = metaAdsActionValue(row.outbound_clicks, OUTBOUND_CLICK_ACTIONS) ?? 0;
  const landingPageViews = actionOrZero(row.actions, LANDING_PAGE_VIEW_ACTIONS);
  const viewContent = actionOrZero(row.actions, VIEW_CONTENT_ACTIONS);
  const addToCart = actionOrZero(row.actions, ADD_TO_CART_ACTIONS);
  const initiateCheckout = actionOrZero(row.actions, CHECKOUT_ACTIONS);
  const purchases = actionOrZero(row.actions, PURCHASE_ACTIONS);
  const purchaseValue = actionOrZero(row.action_values, PURCHASE_ACTIONS);
  const postSaves = actionOrZero(row.actions, POST_SAVE_ACTIONS);
  const postReactions = actionOrZero(row.actions, POST_REACTION_ACTIONS);
  const comments = actionOrZero(row.actions, COMMENT_ACTIONS);
  const postEngagements = actionOrZero(row.actions, POST_ENGAGEMENT_ACTIONS);
  const metrics: NormalizedMetric[] = [
    normalizedMetric(date, source, "meta_ads_spend", spend, currencyUnit, dimensions),
    normalizedMetric(date, source, "meta_ads_impressions", impressions, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_reach", reach, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_clicks", clicks, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_outbound_clicks", outboundClicks, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_inline_link_clicks", inlineLinkClicks, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_landing_page_views", landingPageViews, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_view_content", viewContent, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_add_to_cart", addToCart, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_initiate_checkout", initiateCheckout, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_purchases", purchases, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_purchase_value", purchaseValue, currencyUnit, dimensions),
    normalizedMetric(date, source, "meta_ads_post_saves", postSaves, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_post_reactions", postReactions, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_comments", comments, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_post_engagements", postEngagements, "count", dimensions),
    normalizedMetric(date, source, "meta_ads_video_p25", videoOrZero(row.video_p25_watched_actions), "count", dimensions),
    normalizedMetric(date, source, "meta_ads_video_p50", videoOrZero(row.video_p50_watched_actions), "count", dimensions),
    normalizedMetric(date, source, "meta_ads_video_p75", videoOrZero(row.video_p75_watched_actions), "count", dimensions),
    normalizedMetric(date, source, "meta_ads_video_p95", videoOrZero(row.video_p95_watched_actions), "count", dimensions),
    normalizedMetric(date, source, "meta_ads_video_p100", videoOrZero(row.video_p100_watched_actions), "count", dimensions),
    normalizedMetric(date, source, "meta_ads_video_thruplay", videoOrZero(row.video_thruplay_watched_actions), "count", dimensions),
  ];

  if (reach > 0) {
    metrics.push(normalizedMetric(date, source, "meta_ads_frequency", finiteNumber(row.frequency) ?? impressions / reach, "ratio", dimensions));
  }
  if (impressions > 0) {
    metrics.push(
      normalizedMetric(date, source, "meta_ads_ctr", finiteNumber(row.ctr) ?? (clicks / impressions) * 100, "percent", dimensions),
      normalizedMetric(date, source, "meta_ads_cpm", finiteNumber(row.cpm) ?? (spend / impressions) * 1_000, currencyUnit, dimensions),
    );
  }
  if (clicks > 0) {
    metrics.push(normalizedMetric(date, source, "meta_ads_cpc", finiteNumber(row.cpc) ?? spend / clicks, currencyUnit, dimensions));
  }
  if (purchases > 0) {
    metrics.push(
      normalizedMetric(
        date,
        source,
        "meta_ads_cost_per_purchase",
        metaAdsActionValue(row.cost_per_action_type, PURCHASE_ACTIONS) ?? spend / purchases,
        currencyUnit,
        dimensions,
      ),
    );
  }
  if (spend > 0) {
    const purchaseRoas = metaAdsActionValue(row.purchase_roas, PURCHASE_ACTIONS);
    const websitePurchaseRoas = metaAdsActionValue(row.website_purchase_roas, PURCHASE_ACTIONS);
    if (purchaseRoas !== null || purchaseValue > 0) {
      metrics.push(normalizedMetric(date, source, "meta_ads_purchase_roas", purchaseRoas ?? purchaseValue / spend, "ratio", dimensions));
    }
    if (websitePurchaseRoas !== null) {
      metrics.push(normalizedMetric(date, source, "meta_ads_website_purchase_roas", websitePurchaseRoas, "ratio", dimensions));
    }
  }
  return metrics;
}

function normalizeSnapshot(snapshot: MetaAdsSyncSnapshot, source: Source) {
  const byAdId = metadataByAdId(snapshot);
  return [...snapshot.insights]
    .sort((left, right) => {
      const leftKey = `${left.date_start ?? ""}:${left.campaign_id ?? ""}:${left.adset_id ?? ""}:${left.ad_id ?? ""}`;
      const rightKey = `${right.date_start ?? ""}:${right.campaign_id ?? ""}:${right.adset_id ?? ""}:${right.ad_id ?? ""}`;
      return leftKey.localeCompare(rightKey);
    })
    .flatMap((row) => normalizeInsightRow(snapshot, source, row, row.ad_id ? byAdId.get(row.ad_id) : undefined));
}

export const metaAdsConnector: ConnectorDefinition = {
  key: "meta_ads",
  displayName: "Meta Ads",
  description: "Read-only Meta Marketing API connector for ad delivery, cost, conversion, revenue, ROAS, and creative-level UTM attribution.",
  category: "Marketing",
  icon: "Megaphone",
  availability: "live",
  setupKind: "oauth",
  defaultSyncMode: "hourly",
  urlPatterns: [/^https:\/\/(?:business\.|www\.|adsmanager\.)?facebook\.com\/adsmanager\//iu],
  authType: "meta_marketing_api_oauth",
  docsUrl: "https://developers.facebook.com/docs/marketing-api/insights/",
  requiredFields: [
    {
      key: "meta_ads_long_lived_access_token",
      label: "Meta Ads access token",
      description: "Encrypted server-only OAuth token with ads_read plus the existing read-only Instagram/Page scopes used by this shared Meta connection.",
      required: false,
      secret: true,
      type: "password",
    },
    {
      key: "meta_ad_account_id",
      label: "Meta ad account ID",
      description: "Ad account selected during OAuth, stored as act_<account-id>.",
      required: true,
      secret: false,
      type: "text",
    },
  ],
  optionalFields: [
    { key: "meta_ads_access_token", label: "Short-lived access token", description: "Encrypted short-lived token when returned by OAuth.", required: false, secret: true, type: "password" },
    { key: "meta_ads_expires_at", label: "Token expires at", description: "OAuth token expiration timestamp when provided.", required: false, secret: false, type: "text" },
    { key: "meta_ads_graph_api_version", label: "Graph API version", description: "Pinned Meta Graph API version; defaults to v25.0.", required: false, secret: false, type: "text" },
    { key: "meta_ads_lookback_days", label: "Attribution lookback", description: "Overlapping daily window to recompute, from 1 to 90 days; defaults to 30.", required: false, secret: false, type: "text" },
  ],
  capabilities: {
    supportsWebhook: false,
    supportsPolling: true,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 60,
    canBackfill: true,
    canTestConnection: true,
  },
  detect(inputUrl) {
    const url = validUrl(inputUrl);
    if (!url || !this.urlPatterns.some((pattern) => pattern.test(url.toString()))) return null;
    const accountId = url.searchParams.get("act");
    return {
      sourceTypeKey: "meta_ads",
      displayName: "Meta Ads",
      availability: "live",
      setupKind: "oauth",
      confidence: 0.98,
      normalizedUrl: "https://business.facebook.com/adsmanager/manage/campaigns",
      externalAccountId: accountId && /^\d+$/u.test(accountId) ? `act_${accountId}` : null,
      reasons: ["Meta Ads Manager URL detected."],
      requiredSetup: this.getSetupInstructions(),
      possibleMetrics: this.getMetricDefinitions().map((definition) => definition.key),
      demoAvailable: false,
    };
  },
  async testConnection(ctx): Promise<ConnectionTestResult> {
    const accessToken = selectMetaAdsAccessToken(ctx.credentials);
    if (!accessToken) {
      return {
        ok: false,
        status: "needs_credentials",
        message: "Connect Meta Ads with OAuth before testing this source.",
        details: { required: ["meta_ads_long_lived_access_token", "meta_ad_account_id"], permission: "ads_read + read-only Instagram/Page scopes" },
      };
    }
    if (isMetaAdsTokenExpired(ctx.credentials)) {
      return {
        ok: false,
        status: "error",
        message: "Meta Ads OAuth token expired. Reconnect Meta Ads.",
        details: { tokenExpired: true, expiresAt: ctx.credentials.meta_ads_expires_at },
      };
    }
    try {
      const accounts = await fetchMetaAdAccounts(accessToken, getMetaAdsConfig(ctx.credentials));
      const account = chooseAccount(accounts, selectedAccountId(ctx.credentials));
      return {
        ok: true,
        status: "connected",
        message: `Meta Marketing API connected for ${account.name || account.id}.`,
        details: accountDetails(account),
      };
    } catch (error) {
      return connectionFailure(error);
    }
  },
  async sync(ctx) {
    const accessToken = selectMetaAdsAccessToken(ctx.credentials);
    if (!accessToken) throw new Error("Meta Ads OAuth credentials are missing.");
    if (isMetaAdsTokenExpired(ctx.credentials)) throw new Error("Meta Ads OAuth token expired. Reconnect Meta Ads.");
    const config = getMetaAdsConfig(ctx.credentials);
    const account = chooseAccount(await fetchMetaAdAccounts(accessToken, config), selectedAccountId(ctx.credentials));
    const window = metricWindow(ctx.credentials, account.timezone_name);
    const fetchedAt = syncNow().toISOString();
    const snapshot = await fetchMetaAdsSnapshot({
      accessToken,
      config,
      account,
      ...window,
      fetchedAt,
    });
    return {
      rawPayloads: [
        {
          externalId: `meta_ads:${account.id}:${window.startDate}:${window.endDate}`,
          fetchedAt,
          payload: snapshot as unknown as JsonRecord,
          payloadHash: hashMetaAdsSnapshot(snapshot),
          cursor: {
            accountId: account.id,
            accountTimeZone: account.timezone_name ?? null,
            ...window,
            fetchedAt,
          },
        },
      ],
      cursorAfter: {
        accountId: account.id,
        accountTimeZone: account.timezone_name ?? null,
        ...window,
        fetchedAt,
      },
      recordsFetched: snapshot.ads.length + snapshot.insights.length,
      message: `Synced ${snapshot.insights.length} Meta Ads ad/day insight row(s) across an overlapping ${lookbackDays(ctx.credentials)}-day window.`,
    };
  },
  async normalize(rawPayloads: RawPayload[], source: Source) {
    const latest = rawPayloads
      .map((rawPayload) => rawPayload.payload)
      .filter(isMetaAdsSyncSnapshot)
      .sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt))
      .at(-1);
    if (!latest) return { metrics: [] };
    return {
      metrics: normalizeSnapshot(latest, source),
      replaceMetricWindow: {
        metricKeys: [...META_ADS_METRIC_KEYS],
        startDate: latest.windowStartDate,
        endDate: latest.windowEndDate,
      },
    };
  },
  getMetricDefinitions() {
    return metricDefinitions.filter((definition) => definition.source_type_key === "meta_ads");
  },
  getSetupInstructions() {
    return [
      "Use Connect Meta Ads to authorize ads_read together with the existing read-only Instagram and Page scopes used by the shared Meta OAuth connection; no ad editing or publishing scope is requested.",
      "Select the intended ad account when more than one account is available to the Meta user.",
      "MoonArq reads official Marketing API ad metadata, creative URL tags, and daily ad-level insights; it never scrapes Ads Manager.",
      "The access token stays encrypted and server-only. Raw snapshots and errors never contain access tokens.",
      "Daily insight windows overlap so delayed attribution and conversion revisions replace stale values idempotently.",
    ];
  },
};
