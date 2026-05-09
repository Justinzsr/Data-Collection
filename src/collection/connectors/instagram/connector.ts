import type { ConnectionTestResult, ConnectorDefinition, NormalizedContentMetric, NormalizedMetric, RawPayload, SyncContext } from "@/collection/connectors/types";
import { AUTO_LAB_INSTAGRAM_USERNAME } from "@/collection/connectors/instagram/constants";
import {
  fetchInstagramAccountProfile,
  fetchInstagramMedia,
  fetchMediaInsights,
  getInstagramOAuthConfig,
  hashInstagramPayload,
  isTokenExpired,
  selectInstagramAccessToken,
  type InstagramSyncSnapshot,
} from "@/collection/connectors/instagram/graph-api";
import {
  expectedInstagramCopy,
  getInstagramAccountSelection,
  instagramSourceLabel,
  validateInstagramAccountForSource,
} from "@/collection/connectors/instagram/source-policy";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";

function validUrl(inputUrl: string) {
  try {
    return new URL(inputUrl);
  } catch {
    return null;
  }
}

function captionPreview(caption: string | undefined | null) {
  if (!caption) return null;
  return caption.length > 120 ? `${caption.slice(0, 117)}...` : caption;
}

function mediaMetric(date: string, source: Source, metricKey: string, metricValue: number, dimensions: JsonRecord = {}): NormalizedMetric {
  return {
    date,
    sourceId: source.id,
    sourceTypeKey: "instagram",
    metricKey,
    metricValue,
    unit: metricKey === "instagram_engagement_rate" ? "percent" : "count",
    dimensions,
  };
}

async function fetchSnapshot(ctx: SyncContext): Promise<{ snapshot: InstagramSyncSnapshot; failures: number }> {
  const config = getInstagramOAuthConfig();
  const accessToken = selectInstagramAccessToken(ctx.credentials);
  if (!accessToken) throw new Error("Instagram OAuth credentials are missing.");
  if (isTokenExpired(ctx.credentials)) throw new Error("Instagram OAuth token expired. Reconnect Instagram.");
  const account = await fetchInstagramAccountProfile(accessToken, config, getInstagramAccountSelection(ctx.source, ctx.credentials));
  validateInstagramAccountForSource(ctx.source, account);
  const media = await fetchInstagramMedia(accessToken, config, account.id);
  let failures = 0;
  const mediaWithInsights = [];
  for (const item of media) {
    const result = await fetchMediaInsights(accessToken, config, item.id);
    failures += result.failures.length;
    if (result.failures.length > 0) {
      await recordConnectorEvent({
        source_id: ctx.source.id,
        event_type: "instagram_insight_metric_unsupported",
        severity: "warning",
        message: "One or more Instagram media insight metrics were unavailable for a media item.",
        metadata: { mediaId: item.id, metrics: result.failures.map((failure) => failure.metric) },
      });
    }
    mediaWithInsights.push({ ...item, insights: result.insights, insightErrors: result.failures });
  }
  return {
    failures,
    snapshot: {
      kind: "instagram_sync_snapshot",
      account,
      media: mediaWithInsights,
      graphApiVersion: config.graphApiVersion,
      fetchedAt: new Date().toISOString(),
    },
  };
}

export const instagramConnector: ConnectorDefinition = {
  key: "instagram",
  displayName: "Instagram",
  description: "Meta/Instagram Graph API connector for source-specific Instagram account, media, and insight metrics.",
  category: "Content",
  icon: "Instagram",
  urlPatterns: [/^https:\/\/(www\.)?instagram\.com\/[^/?#]+/i],
  authType: "meta_graph_api_oauth",
  docsUrl: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/",
  requiredFields: [
    {
      key: "instagram_long_lived_access_token",
      label: "Instagram long-lived access token",
      description: "Encrypted server-only Meta Graph API token from the OAuth flow.",
      required: false,
      secret: true,
      type: "password",
    },
    {
      key: "instagram_account_id",
      label: "Instagram account ID",
      description: "Instagram account ID resolved during OAuth.",
      required: true,
      secret: false,
      type: "text",
    },
  ],
  optionalFields: [
    {
      key: "instagram_access_token",
      label: "Instagram short-lived access token",
      description: "Encrypted short-lived token saved only when returned by Meta OAuth.",
      required: false,
      secret: true,
      type: "password",
    },
    { key: "token_type", label: "Token type", description: "Token type returned by Meta.", required: false, secret: false, type: "text" },
    { key: "expires_at", label: "Token expires at", description: "Token expiration timestamp when provided.", required: false, secret: false, type: "text" },
    { key: "page_id", label: "Facebook Page ID", description: "Facebook Page connected to the Instagram account.", required: false, secret: false, type: "text" },
    { key: "instagram_username", label: "Instagram username", description: "Resolved Instagram username.", required: false, secret: false, type: "text" },
    { key: "graph_api_version", label: "Graph API version", description: "Meta Graph API version used for this connection.", required: false, secret: false, type: "text" },
    { key: "connected_at", label: "Connected at", description: "Timestamp when OAuth completed.", required: false, secret: false, type: "text" },
  ],
  capabilities: {
    supportsWebhook: false,
    supportsPolling: true,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 60,
    canBackfill: false,
    canTestConnection: true,
  },
  detect(inputUrl) {
    const url = validUrl(inputUrl);
    if (!url || !url.hostname.includes("instagram.com")) return null;
    const account = url.pathname.split("/").filter(Boolean)[0];
    if (!account || ["p", "reel", "stories"].includes(account)) return null;
    return {
      sourceTypeKey: "instagram",
      displayName: account === AUTO_LAB_INSTAGRAM_USERNAME ? "Auto Lab Instagram" : "Instagram",
      confidence: 0.94,
      normalizedUrl: `https://www.instagram.com/${account}`,
      accountName: account,
      reasons: ["Instagram profile URL detected."],
      requiredSetup: this.getSetupInstructions(),
      possibleMetrics: this.getMetricDefinitions().map((metric) => metric.key),
      demoAvailable: account !== AUTO_LAB_INSTAGRAM_USERNAME,
    };
  },
  async testConnection(ctx): Promise<ConnectionTestResult> {
    const accessToken = selectInstagramAccessToken(ctx.credentials);
    if (!accessToken || !ctx.credentials.instagram_account_id) {
      return {
        ok: false,
        status: "needs_credentials",
        message: `Connect Instagram with OAuth before testing ${instagramSourceLabel(ctx.source)}.`,
        details: { required: ["instagram_long_lived_access_token", "instagram_account_id"] },
      };
    }
    if (isTokenExpired(ctx.credentials)) {
      return {
        ok: false,
        status: "error",
        message: "Instagram OAuth token expired. Reconnect Instagram.",
        details: { tokenExpired: true, expiresAt: ctx.credentials.expires_at },
      };
    }
    try {
      const config = getInstagramOAuthConfig();
      const account = await fetchInstagramAccountProfile(accessToken, config, getInstagramAccountSelection(ctx.source, ctx.credentials));
      validateInstagramAccountForSource(ctx.source, account);
      return {
        ok: true,
        status: "connected",
        message: `Instagram Graph API connected for ${account.username}.`,
        details: {
          instagramAccountId: account.id,
          username: account.username,
          followersCount: account.followers_count,
          mediaCount: account.media_count,
          pageId: account.page_id ?? null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        status: "error",
        message: error instanceof Error ? error.message : "Instagram Graph API test failed.",
        details: { sanitized: true },
      };
    }
  },
  async sync(ctx) {
    const { snapshot, failures } = await fetchSnapshot(ctx);
    return {
      rawPayloads: [
        {
          externalId: `instagram:${snapshot.account.id}:${snapshot.fetchedAt.slice(0, 10)}`,
          fetchedAt: snapshot.fetchedAt,
          payload: snapshot as unknown as JsonRecord,
          payloadHash: hashInstagramPayload(snapshot),
          cursor: { fetchedAt: snapshot.fetchedAt, accountId: snapshot.account.id },
        },
      ],
      cursorAfter: { fetchedAt: snapshot.fetchedAt, accountId: snapshot.account.id },
      recordsFetched: 1 + snapshot.media.length,
      message: failures > 0 ? `Instagram sync completed with ${failures} unsupported insight metric warning(s).` : "Instagram sync completed.",
    };
  },
  async normalize(rawPayloads: RawPayload[], source) {
    const metrics: NormalizedMetric[] = [];
    const contentMetrics: NormalizedContentMetric[] = [];
    for (const rawPayload of rawPayloads) {
      const payload = rawPayload.payload as Partial<InstagramSyncSnapshot>;
      if (payload.kind !== "instagram_sync_snapshot" || !payload.account) continue;
      const date = rawPayload.fetchedAt.slice(0, 10);
      const accountDimensions = {
        account_id: payload.account.id,
        username: payload.account.username,
        rollup: "snapshot",
      };
      metrics.push(
        mediaMetric(date, source, "instagram_followers", payload.account.followers_count, accountDimensions),
        mediaMetric(date, source, "instagram_media_count", payload.account.media_count, accountDimensions),
      );
      const totals = { reach: 0, likes: 0, comments: 0, saved: 0, totalInteractions: 0 };
      for (const media of payload.media ?? []) {
        const mediaDate = media.timestamp ? media.timestamp.slice(0, 10) : date;
        const reach = media.insights?.reach ?? 0;
        const saved = media.insights?.saved ?? 0;
        const totalInteractions = media.insights?.total_interactions ?? 0;
        const likes = media.like_count ?? 0;
        const comments = media.comments_count ?? 0;
        totals.reach += reach;
        totals.likes += likes;
        totals.comments += comments;
        totals.saved += saved;
        totals.totalInteractions += totalInteractions;
        const common = {
          date: mediaDate,
          sourceId: source.id,
          sourceTypeKey: "instagram" as const,
          externalContentId: media.id,
          contentType: media.media_type ?? "media",
          title: captionPreview(media.caption) ?? `Instagram media ${media.id}`,
          caption: media.caption ?? null,
          url: media.permalink ?? media.media_url ?? null,
          thumbnailUrl: null,
          publishedAt: media.timestamp ?? null,
          dimensions: { account_id: payload.account.id, media_type: media.media_type ?? "media" },
        };
        contentMetrics.push(
          { ...common, metricKey: "instagram_media_reach", metricValue: reach, unit: "count" },
          { ...common, metricKey: "instagram_media_likes", metricValue: likes, unit: "count" },
          { ...common, metricKey: "instagram_media_comments", metricValue: comments, unit: "count" },
          { ...common, metricKey: "instagram_media_saved", metricValue: saved, unit: "count" },
          { ...common, metricKey: "instagram_media_total_interactions", metricValue: totalInteractions, unit: "count" },
        );
      }
      metrics.push(
        mediaMetric(date, source, "instagram_media_reach", totals.reach, { ...accountDimensions, rollup: "media_sync_total" }),
        mediaMetric(date, source, "instagram_media_likes", totals.likes, { ...accountDimensions, rollup: "media_sync_total" }),
        mediaMetric(date, source, "instagram_media_comments", totals.comments, { ...accountDimensions, rollup: "media_sync_total" }),
        mediaMetric(date, source, "instagram_media_saved", totals.saved, { ...accountDimensions, rollup: "media_sync_total" }),
        mediaMetric(date, source, "instagram_media_total_interactions", totals.totalInteractions, { ...accountDimensions, rollup: "media_sync_total" }),
      );
      if (totals.reach > 0) {
        metrics.push(mediaMetric(date, source, "instagram_engagement_rate", (totals.totalInteractions / totals.reach) * 100, { ...accountDimensions, rollup: "media_sync_total" }));
      }
    }
    return { metrics, contentMetrics };
  },
  getMetricDefinitions() {
    return metricDefinitions.filter((metric) => metric.source_type_key === "instagram");
  },
  getSetupInstructions(source) {
    const expected = source ? expectedInstagramCopy(source) : "the selected Instagram account";
    return [
      "Use Connect Instagram to start the server-side Meta OAuth flow.",
      `Expected account: ${expected}.`,
      "The Meta app must include this valid OAuth redirect URI: https://moonarq-data-hub.vercel.app/api/oauth/instagram/callback",
      "Required server env vars: META_APP_ID, META_APP_SECRET, META_GRAPH_API_VERSION, and META_REDIRECT_URI.",
      "Use the official Meta/Instagram Graph API only. Do not scrape Instagram or Meta dashboards.",
    ];
  },
};
