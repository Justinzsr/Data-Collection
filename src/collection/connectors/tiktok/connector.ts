import type { ConnectionTestResult, ConnectorDefinition, NormalizedContentMetric, NormalizedMetric, RawPayload, SyncContext } from "@/collection/connectors/types";
import { TIKTOK_OAUTH_SCOPES } from "@/collection/connectors/tiktok/constants";
import {
  fetchTikTokUserInfo,
  fetchTikTokVideos,
  getTikTokOAuthConfig,
  hashTikTokPayload,
  isTikTokRefreshExpired,
  isTikTokTokenExpired,
  missingTikTokScopes,
  parseTikTokScopes,
  refreshTikTokAccessToken,
  selectTikTokAccessToken,
  tokenExpiresAt,
  type TikTokSyncSnapshot,
  type TikTokTokenResponse,
  type TikTokVideo,
} from "@/collection/connectors/tiktok/api";
import { assertAutoLabTikTokSource, isAutoLabTikTokSource, tiktokSourceLabel } from "@/collection/connectors/tiktok/source-policy";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { saveCredential } from "@/storage/repositories/credentials-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { updateSource } from "@/storage/repositories/sources-repository";

function validUrl(inputUrl: string) {
  try {
    return new URL(inputUrl);
  } catch {
    return null;
  }
}

function captionPreview(value: string | undefined | null) {
  if (!value) return null;
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function numberValue(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function videoPublishedAt(video: TikTokVideo) {
  return typeof video.create_time === "number" && Number.isFinite(video.create_time)
    ? new Date(video.create_time * 1000).toISOString()
    : null;
}

function metric(date: string, source: Source, metricKey: string, metricValue: number, unit = "count", dimensions: JsonRecord = {}): NormalizedMetric {
  return {
    date,
    sourceId: source.id,
    sourceTypeKey: "tiktok",
    metricKey,
    metricValue,
    unit,
    dimensions,
  };
}

async function saveTikTokTokenFields(sourceId: string, token: TikTokTokenResponse, connectedAt = new Date()) {
  const expiresAt = tokenExpiresAt(token.expires_in, connectedAt);
  const refreshExpiresAt = tokenExpiresAt(token.refresh_expires_in, connectedAt);
  const fields: Record<string, string | null | undefined> = {
    tiktok_access_token: token.access_token,
    tiktok_refresh_token: token.refresh_token,
    token_type: token.token_type ?? "Bearer",
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
    open_id: token.open_id,
    tiktok_open_id: token.open_id,
    scope: token.scope,
    connected_at: connectedAt.toISOString(),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim()) await saveCredential(sourceId, key, value.trim());
  }
  return { expiresAt, refreshExpiresAt };
}

async function ensureAccessToken(ctx: SyncContext | { source: Source; credentials: Record<string, string> }) {
  let accessToken = selectTikTokAccessToken(ctx.credentials);
  if (!accessToken) throw new Error("TikTok OAuth credentials are missing. Connect TikTok first.");
  if (!isTikTokTokenExpired(ctx.credentials)) return accessToken;
  const refreshToken = ctx.credentials.tiktok_refresh_token;
  if (!refreshToken || isTikTokRefreshExpired(ctx.credentials)) {
    throw new Error("TikTok OAuth token expired. Reconnect TikTok.");
  }
  const config = getTikTokOAuthConfig();
  const refreshed = await refreshTikTokAccessToken(refreshToken, config);
  const now = new Date();
  const { expiresAt, refreshExpiresAt } = await saveTikTokTokenFields(ctx.source.id, refreshed, now);
  await updateSource(ctx.source.id, {
    metadata: {
      ...ctx.source.metadata,
      token_expires_at: expiresAt,
      refresh_expires_at: refreshExpiresAt,
      tiktok_scopes: refreshed.scope ?? ctx.credentials.scope ?? null,
    },
  });
  accessToken = refreshed.access_token;
  await recordConnectorEvent({
    source_id: ctx.source.id,
    event_type: "tiktok_token_refreshed",
    severity: "info",
    message: "TikTok access token was refreshed server-side.",
    metadata: { sanitized: true },
  });
  return accessToken;
}

async function fetchSnapshot(ctx: SyncContext): Promise<TikTokSyncSnapshot> {
  assertAutoLabTikTokSource(ctx.source);
  const config = getTikTokOAuthConfig();
  const accessToken = await ensureAccessToken(ctx);
  const scopes = [...parseTikTokScopes(ctx.credentials.scope)];
  const missingVideoScopes = missingTikTokScopes(ctx.credentials.scope, ["video.list"]);
  if (missingVideoScopes.length > 0) {
    throw new Error("TikTok OAuth is connected, but the video.list scope is missing. Reconnect after enabling the scope in TikTok Developer.");
  }
  const account = await fetchTikTokUserInfo(accessToken, config, ctx.credentials.scope);
  const { videos } = await fetchTikTokVideos(accessToken, config);
  return {
    kind: "tiktok_sync_snapshot",
    sourceId: ctx.source.id,
    fetchedAt: new Date().toISOString(),
    account,
    videos,
    scopes,
    apiBaseUrl: config.apiBaseUrl,
  };
}

export const tiktokConnector: ConnectorDefinition = {
  key: "tiktok",
  displayName: "TikTok",
  description: "Official TikTok Login Kit and Display API connector for Auto Lab video/account metrics.",
  category: "Content",
  icon: "Video",
  urlPatterns: [/^https:\/\/(www\.)?tiktok\.com\/@/i],
  authType: "tiktok_oauth",
  docsUrl: "https://developers.tiktok.com/doc/login-kit-web",
  requiredFields: [
    {
      key: "tiktok_access_token",
      label: "TikTok access token",
      description: "Encrypted server-only OAuth token saved by Connect TikTok.",
      required: true,
      secret: true,
      type: "password",
    },
  ],
  optionalFields: [
    { key: "tiktok_refresh_token", label: "TikTok refresh token", description: "Encrypted refresh token from TikTok OAuth.", required: false, secret: true, type: "password" },
    { key: "token_type", label: "Token type", description: "Token type returned by TikTok.", required: false, secret: false, type: "text" },
    { key: "expires_at", label: "Token expires at", description: "Access token expiration timestamp.", required: false, secret: false, type: "text" },
    { key: "refresh_expires_at", label: "Refresh expires at", description: "Refresh token expiration timestamp.", required: false, secret: false, type: "text" },
    { key: "open_id", label: "Open ID", description: "TikTok open_id resolved during OAuth.", required: false, secret: false, type: "text" },
    { key: "username", label: "Username", description: "TikTok username when the profile scope is granted.", required: false, secret: false, type: "text" },
    { key: "display_name", label: "Display name", description: "TikTok display name from the user info endpoint.", required: false, secret: false, type: "text" },
    { key: "scope", label: "Granted scopes", description: "Comma-separated scopes TikTok returned for this source.", required: false, secret: false, type: "text" },
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
    if (!url || !url.hostname.includes("tiktok.com") || !url.pathname.startsWith("/@")) return null;
    const accountName = url.pathname.split("/").filter(Boolean)[0];
    return {
      sourceTypeKey: "tiktok",
      displayName: "TikTok",
      confidence: 0.96,
      normalizedUrl: `${url.origin}/${accountName}`,
      accountName,
      reasons: ["TikTok profile URL detected."],
      requiredSetup: this.getSetupInstructions(),
      possibleMetrics: this.getMetricDefinitions().map((item) => item.key),
      demoAvailable: false,
    };
  },
  async testConnection(ctx): Promise<ConnectionTestResult> {
    if (!isAutoLabTikTokSource(ctx.source)) {
      return {
        ok: false,
        status: "unsupported",
        message: "TikTok OAuth/API sync is currently enabled only for Auto Lab TikTok.",
        details: { sanitized: true },
      };
    }
    if (!selectTikTokAccessToken(ctx.credentials)) {
      return {
        ok: false,
        status: "needs_credentials",
        message: `Connect TikTok with OAuth before testing ${tiktokSourceLabel(ctx.source)}.`,
        details: { required: ["tiktok_access_token"], scopes: TIKTOK_OAUTH_SCOPES },
      };
    }
    try {
      const config = getTikTokOAuthConfig();
      const accessToken = await ensureAccessToken(ctx);
      const user = await fetchTikTokUserInfo(accessToken, config, ctx.credentials.scope);
      const missingVideo = missingTikTokScopes(ctx.credentials.scope, ["video.list"]);
      const missingStats = missingTikTokScopes(ctx.credentials.scope, ["user.info.stats"]);
      if (missingVideo.length > 0) {
        return {
          ok: false,
          status: "unsupported",
          message: "TikTok OAuth connected, but video.list scope is missing. Reconnect after enabling video.list in TikTok Developer.",
          details: { connected: true, missingScopes: missingVideo },
        };
      }
      return {
        ok: true,
        status: "connected",
        message: `TikTok API connected${user.display_name ? ` for ${user.display_name}` : ""}.`,
        details: {
          openId: user.open_id ?? ctx.credentials.open_id ?? null,
          username: user.username ?? null,
          displayName: user.display_name ?? null,
          followerCount: user.follower_count ?? null,
          likesCount: user.likes_count ?? null,
          videoCount: user.video_count ?? null,
          missingOptionalScopes: missingStats,
        },
      };
    } catch (error) {
      return {
        ok: false,
        status: "error",
        message: error instanceof Error ? error.message : "TikTok API test failed.",
        details: { sanitized: true },
      };
    }
  },
  async sync(ctx) {
    const snapshot = await fetchSnapshot(ctx);
    return {
      rawPayloads: [
        {
          externalId: `tiktok:${snapshot.account.open_id ?? ctx.source.id}:${snapshot.fetchedAt.slice(0, 10)}`,
          fetchedAt: snapshot.fetchedAt,
          payload: snapshot as unknown as JsonRecord,
          payloadHash: hashTikTokPayload(snapshot),
          cursor: { fetchedAt: snapshot.fetchedAt, openId: snapshot.account.open_id ?? null },
        },
      ],
      cursorAfter: { fetchedAt: snapshot.fetchedAt, openId: snapshot.account.open_id ?? null },
      recordsFetched: 1 + snapshot.videos.length,
      message: "TikTok sync completed.",
    };
  },
  async normalize(rawPayloads: RawPayload[], source) {
    const metrics: NormalizedMetric[] = [];
    const contentMetrics: NormalizedContentMetric[] = [];
    for (const rawPayload of rawPayloads) {
      const payload = rawPayload.payload as Partial<TikTokSyncSnapshot>;
      if (payload.kind !== "tiktok_sync_snapshot" || !payload.account) continue;
      const date = rawPayload.fetchedAt.slice(0, 10);
      const accountDimensions = {
        open_id: payload.account.open_id ?? source.external_account_id ?? "unknown",
        username: payload.account.username ?? source.account_name ?? null,
        display_name: payload.account.display_name ?? source.account_name ?? null,
        rollup: "account_snapshot",
      };
      if (typeof payload.account.follower_count === "number") metrics.push(metric(date, source, "tiktok_followers", payload.account.follower_count, "count", accountDimensions));
      if (typeof payload.account.video_count === "number") metrics.push(metric(date, source, "tiktok_video_count", payload.account.video_count, "count", accountDimensions));
      if (typeof payload.account.likes_count === "number") metrics.push(metric(date, source, "tiktok_profile_likes", payload.account.likes_count, "count", accountDimensions));

      const totals = { views: 0, likes: 0, comments: 0, shares: 0 };
      for (const video of payload.videos ?? []) {
        const views = numberValue(video.view_count);
        const likes = numberValue(video.like_count);
        const comments = numberValue(video.comment_count);
        const shares = numberValue(video.share_count);
        const engagementRate = views > 0 ? ((likes + comments + shares) / views) * 100 : 0;
        totals.views += views;
        totals.likes += likes;
        totals.comments += comments;
        totals.shares += shares;
        const publishedAt = videoPublishedAt(video);
        const videoDate = publishedAt?.slice(0, 10) ?? date;
        const common = {
          date: videoDate,
          sourceId: source.id,
          sourceTypeKey: "tiktok" as const,
          externalContentId: video.id,
          contentType: "video",
          title: captionPreview(video.title ?? video.video_description) ?? `TikTok video ${video.id}`,
          caption: video.video_description ?? video.title ?? null,
          url: video.share_url ?? video.embed_link ?? null,
          thumbnailUrl: video.cover_image_url ?? null,
          publishedAt,
          dimensions: {
            open_id: payload.account.open_id ?? source.external_account_id ?? "unknown",
            duration: numberValue(video.duration),
            width: numberValue(video.width),
            height: numberValue(video.height),
          },
        };
        contentMetrics.push(
          { ...common, metricKey: "tiktok_video_views", metricValue: views, unit: "count" },
          { ...common, metricKey: "tiktok_likes", metricValue: likes, unit: "count" },
          { ...common, metricKey: "tiktok_comments", metricValue: comments, unit: "count" },
          { ...common, metricKey: "tiktok_shares", metricValue: shares, unit: "count" },
          { ...common, metricKey: "tiktok_engagement_rate", metricValue: engagementRate, unit: "percent" },
        );
      }
      const totalEngagementRate = totals.views > 0 ? ((totals.likes + totals.comments + totals.shares) / totals.views) * 100 : 0;
      metrics.push(
        metric(date, source, "tiktok_video_views", totals.views, "count", { ...accountDimensions, rollup: "video_sync_total" }),
        metric(date, source, "tiktok_likes", totals.likes, "count", { ...accountDimensions, rollup: "video_sync_total" }),
        metric(date, source, "tiktok_comments", totals.comments, "count", { ...accountDimensions, rollup: "video_sync_total" }),
        metric(date, source, "tiktok_shares", totals.shares, "count", { ...accountDimensions, rollup: "video_sync_total" }),
        metric(date, source, "tiktok_engagement_rate", totalEngagementRate, "percent", { ...accountDimensions, rollup: "video_sync_total" }),
      );
    }
    return { metrics, contentMetrics };
  },
  getMetricDefinitions() {
    return metricDefinitions.filter((item) => item.source_type_key === "tiktok");
  },
  getSetupInstructions(source) {
    const sourceLabel = source ? tiktokSourceLabel(source) : "Auto Lab TikTok";
    return [
      "Use Connect TikTok to start the server-side TikTok Login Kit OAuth flow.",
      `${sourceLabel} uses official TikTok APIs only and is currently limited to the Auto Lab data space.`,
      "Required TikTok OAuth redirect URI: https://moonarq-data-hub.vercel.app/api/oauth/tiktok/callback",
      "Required Vercel env vars: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI, and optionally TIKTOK_API_BASE_URL.",
      `Requested scopes: ${TIKTOK_OAUTH_SCOPES.join(", ")}.`,
      "TikTok may require app review before user.info.stats or video.list can return profile stats and public video metrics.",
      "Do not paste TikTok passwords, scrape dashboards, or expose token values. Tokens are stored encrypted server-side.",
    ];
  },
};
