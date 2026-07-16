import { NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchInstagramAccountProfile,
  getInstagramOAuthConfigForSource,
  tokenExpiresAt,
  type InstagramTokenResponse,
} from "@/collection/connectors/instagram/graph-api";
import {
  getInstagramOAuthStateCookieName,
  validateSignedInstagramOAuthState,
  validateInstagramOAuthState,
} from "@/collection/connectors/instagram/oauth-state";
import {
  getInstagramAccountSelection,
  safeInstagramReturnPath,
  validateInstagramAccountForSource,
} from "@/collection/connectors/instagram/source-policy";
import { fetchMetaAdAccounts, normalizeMetaAdAccountId, type MetaAdAccount } from "@/collection/connectors/meta-ads/api";
import { MOONARQ_FIRST_STORY_CAMPAIGN_NAME, MOONARQ_FIRST_STORY_UTM_TAGS } from "@/collection/connectors/meta-ads/constants";
import { isWebsiteSourceKey } from "@/collection/tracking/website-sources";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
import { isRuntimeDatabaseConfigured, query, withDatabaseTransaction, type DatabaseExecutor } from "@/storage/db/client";
import { deleteCredential, saveCredential } from "@/storage/repositories/credentials-repository";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { createSource, getSource, listSources, updateSource } from "@/storage/repositories/sources-repository";
import type { Source } from "@/storage/db/schema";

export const runtime = "nodejs";

function parseCookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.split("=");
        return [key, decodeURIComponent(value.join("="))];
      }),
  );
}

function sourceRedirect(request: Request, returnPath: string, params: Record<string, string> = {}) {
  const url = new URL(returnPath, request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.set({
    name: getInstagramOAuthStateCookieName(),
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function jsonError(message: string, status = 400) {
  const response = Response.json({ error: message }, { status });
  return response;
}

function sanitizedOAuthEventMessage(error: unknown, fallback: string) {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
  return message
    .replace(/(access_token|client_secret|fb_exchange_token|appsecret_proof)=[^&\s]+/giu, "$1=[redacted]")
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .slice(0, 500);
}

async function saveInstagramCredentials(sourceId: string, credentials: Record<string, string | null | undefined>) {
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === "string" && value.trim()) {
      await saveCredential(sourceId, key, value.trim());
    }
  }
}

const META_ADS_ROTATING_CREDENTIAL_KEYS = [
  "meta_ads_access_token",
  "meta_ads_long_lived_access_token",
  "meta_ads_expires_at",
  "meta_ad_account_id",
] as const;

async function replaceMetaAdsCredentials(input: {
  sourceId: string;
  activeToken: string;
  expiresAt: string | null;
  graphApiVersion: string;
  accountId: string | null;
}, executor?: DatabaseExecutor) {
  for (const key of META_ADS_ROTATING_CREDENTIAL_KEYS) {
    await deleteCredential(input.sourceId, key, executor);
  }
  await saveCredential(input.sourceId, "meta_ads_access_token", input.activeToken, executor);
  if (input.expiresAt) await saveCredential(input.sourceId, "meta_ads_expires_at", input.expiresAt, executor);
  await saveCredential(input.sourceId, "meta_ads_graph_api_version", input.graphApiVersion, executor);
  await saveCredential(input.sourceId, "meta_ads_lookback_days", "30", executor);
  if (input.accountId) await saveCredential(input.sourceId, "meta_ad_account_id", input.accountId, executor);
}

function safeAdAccount(account: MetaAdAccount) {
  return {
    id: account.id,
    name: account.name ?? null,
    account_status: account.account_status ?? null,
    currency: account.currency ?? null,
    timezone_name: account.timezone_name ?? null,
  };
}

async function connectMetaAds(input: {
  instagramSource: Source;
  shortToken: InstagramTokenResponse;
  longToken: InstagramTokenResponse | null;
  activeToken: string;
  expiresAt: string | null;
  graphApiVersion: string;
  connectedAt: string;
}) {
  const accounts = await fetchMetaAdAccounts(input.activeToken, { graphApiVersion: input.graphApiVersion });
  if (accounts.length === 0) throw new Error("No Meta ad account is available to this OAuth connection.");
  const persistConnection = async (executor?: DatabaseExecutor) => {
  if (executor) {
    await query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`meta_ads:${input.instagramSource.id}`], executor);
  }
  const scopedSources = await listSources({ dataSpaceId: input.instagramSource.data_space_id }, executor);
  const existing = scopedSources.find(
    (source) => source.source_type_key === "meta_ads" && source.metadata.linked_instagram_source_id === input.instagramSource.id,
  ) ?? null;
  const shopifySources = scopedSources.filter((source) => source.source_type_key === "shopify" && source.status !== "disabled");
  const websiteSources = scopedSources.filter((source) => isWebsiteSourceKey(source.source_type_key) && source.status !== "disabled");
  const existingShopifyLink = typeof existing?.metadata.linked_shopify_source_id === "string" ? existing.metadata.linked_shopify_source_id : null;
  const existingWebsiteLink = typeof existing?.metadata.linked_website_source_id === "string" ? existing.metadata.linked_website_source_id : null;
  const previouslySelectedId = existing?.external_account_id
    ?? (typeof existing?.metadata.selected_ad_account_id === "string" ? existing.metadata.selected_ad_account_id : null);
  const selected = previouslySelectedId
    ? accounts.find((account) => normalizeMetaAdAccountId(account.id) === normalizeMetaAdAccountId(previouslySelectedId)) ?? null
    : accounts.length === 1
      ? accounts[0]
      : null;
  const selectedAccountOperational = Boolean(
    selected && (selected.account_status === undefined || selected.account_status === 1),
  );
  const metadata = {
    ...(existing?.metadata ?? {}),
    demo: false,
    linked_instagram_source_id: input.instagramSource.id,
    linked_shopify_source_id: existingShopifyLink && shopifySources.some((source) => source.id === existingShopifyLink)
      ? existingShopifyLink
      : shopifySources.length === 1 ? shopifySources[0].id : null,
    linked_website_source_id: existingWebsiteLink && websiteSources.some((source) => source.id === existingWebsiteLink)
      ? existingWebsiteLink
      : websiteSources.length === 1 ? websiteSources[0].id : null,
    meta_app_profile: input.instagramSource.metadata.meta_app_profile ?? "moonarq",
    oauth_connected: true,
    connected_at: input.connectedAt,
    token_expires_at: input.expiresAt,
    graph_api_version: input.graphApiVersion,
    tracked_utm: MOONARQ_FIRST_STORY_UTM_TAGS,
    campaign_name: MOONARQ_FIRST_STORY_CAMPAIGN_NAME,
    candidate_ad_accounts: accounts.map(safeAdAccount),
    selected_ad_account_id: selected?.id ?? null,
    selected_ad_account_name: selected?.name ?? null,
    account_currency: selected?.currency ?? null,
    account_timezone: selected?.timezone_name ?? null,
  };
  let metaSource = existing
    ? await updateSource(existing.id, {
        status: "needs_credentials",
        external_account_id: selected?.id ?? null,
        account_name: selected?.name ?? null,
        metadata,
        last_error: "Meta Ads authorization is being finalized.",
        last_error_at: null,
      }, { dataSpaceId: input.instagramSource.data_space_id }, executor)
    : await createSource({
        data_space_id: input.instagramSource.data_space_id,
        source_type_key: "meta_ads",
        display_name: selected?.name ? `Meta Ads: ${selected.name}` : "MoonArq Meta Ads",
        input_url: "https://business.facebook.com/adsmanager/manage/campaigns",
        normalized_url: "https://business.facebook.com/adsmanager/manage/campaigns",
        external_account_id: selected?.id ?? null,
        account_name: selected?.name ?? null,
        status: "needs_credentials",
        sync_mode: "hourly",
        sync_frequency_minutes: 60,
        metadata,
      }, executor);
  if (!metaSource) throw new Error("Meta Ads source could not be saved.");

  await replaceMetaAdsCredentials({
    sourceId: metaSource.id,
    activeToken: input.activeToken,
    expiresAt: input.expiresAt,
    graphApiVersion: input.graphApiVersion,
    accountId: selected?.id ?? null,
  }, executor);
  metaSource = await updateSource(metaSource.id, {
    status: selectedAccountOperational ? "healthy" : "warning",
    external_account_id: selected?.id ?? null,
    account_name: selected?.name ?? null,
    metadata,
    last_error: selectedAccountOperational
      ? null
      : selected
        ? "The selected Meta ad account is not active. Sync will verify whether Insights are readable."
        : "Multiple Meta ad accounts are available. Select one before syncing.",
    last_error_at: selectedAccountOperational ? null : new Date().toISOString(),
  }, { dataSpaceId: input.instagramSource.data_space_id }, executor);
  if (!metaSource) throw new Error("Meta Ads authorization could not be finalized.");
  await updateSource(input.instagramSource.id, {
    metadata: {
      ...input.instagramSource.metadata,
      meta_ads_source_id: metaSource.id,
      meta_ads_connected: Boolean(selected),
      meta_ads_account_id: selected?.id ?? null,
    },
  }, { dataSpaceId: input.instagramSource.data_space_id }, executor);
  await recordConnectorEvent({
    source_id: metaSource.id,
    event_type: selected ? "meta_ads_oauth_connected" : "meta_ads_account_selection_required",
    severity: selectedAccountOperational ? "info" : "warning",
    message: selected
      ? `Meta Ads OAuth connected for ${selected.name ?? selected.id}${selectedAccountOperational ? "." : "; the account state requires verification."}`
      : "Meta Ads OAuth connected, but an ad account must be selected before syncing.",
    metadata: { accountCount: accounts.length, selectedAccountId: selected?.id ?? null, sanitized: true },
  }, executor);
  return { source: metaSource, selected };
  };
  return isRuntimeDatabaseConfigured()
    ? withDatabaseTransaction((client) => persistConnection(client))
    : persistConnection();
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  let state;
  let usedSignedStateFallback = false;
  try {
    const stateParam = requestUrl.searchParams.get("state");
    const stateCookie = parseCookies(request)[getInstagramOAuthStateCookieName()];
    state = stateCookie
      ? validateInstagramOAuthState(stateParam, stateCookie)
      : validateSignedInstagramOAuthState(stateParam);
    usedSignedStateFallback = !stateCookie;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Instagram OAuth state.", 400);
  }
  const returnPath = safeInstagramReturnPath(state.returnPath, state.dataSpaceSlug, state.sourceId);
  if (state.connectMetaAds && (usedSignedStateFallback || !(await isDashboardRequestAuthenticated(request)))) {
    return sourceRedirect(request, returnPath, {
      meta_ads_oauth: "error",
      message: "Meta Ads authorization must finish in the same signed-in browser session. Please try again.",
    });
  }

  const oauthError = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  if (oauthError) {
    return sourceRedirect(request, returnPath, {
      [state.connectMetaAds ? "meta_ads_oauth" : "instagram_oauth"]: "error",
      message: "Meta OAuth was cancelled or rejected.",
    });
  }
  const code = requestUrl.searchParams.get("code");
  if (!code) return sourceRedirect(request, returnPath, {
    [state.connectMetaAds ? "meta_ads_oauth" : "instagram_oauth"]: "error",
    message: "Missing Meta OAuth authorization code.",
  });

  const dataSpace = await getDataSpaceBySlug(state.dataSpaceSlug);
  if (!dataSpace) return jsonError("Instagram OAuth data space is unavailable.", 404);
  const source = await getSource(state.sourceId, { dataSpaceId: dataSpace.id });
  if (!source) return jsonError("Instagram OAuth source was not found in the requested data space.", 403);
  if (source.source_type_key !== "instagram") return jsonError("Instagram OAuth callback rejected for this source.", 403);
  if (state.connectMetaAds && dataSpace.slug !== "moonarq") {
    return sourceRedirect(request, returnPath, {
      meta_ads_oauth: "error",
      message: "The first Story Meta Ads connection is only available in the MoonArq data space.",
    });
  }

  if (usedSignedStateFallback) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "instagram_oauth_state_cookie_missing",
      severity: "warning",
      message: "Instagram OAuth callback used signed-state fallback because the state cookie was missing.",
      metadata: { sanitized: true, dataSpaceSlug: state.dataSpaceSlug, metaAppProfile: state.metaAppProfile ?? null },
    });
  }

  try {
    const connectedAt = new Date();
    const config = getInstagramOAuthConfigForSource(source, process.env, state.metaAppProfile);
    const shortToken = await exchangeCodeForToken(code, config);
    let longToken: InstagramTokenResponse | null = null;
    try {
      longToken = await exchangeForLongLivedToken(shortToken.access_token, config);
    } catch (error) {
      await recordConnectorEvent({
        source_id: source.id,
        event_type: "instagram_long_lived_token_exchange_failed",
        severity: "warning",
        message: sanitizedOAuthEventMessage(error, "Could not exchange Instagram token for a long-lived token."),
        metadata: { sanitized: true },
      });
    }
    const activeToken = longToken?.access_token ?? shortToken.access_token;
    const expiresAt = tokenExpiresAt(longToken?.expires_in ?? shortToken.expires_in, connectedAt);
    const profile = await fetchInstagramAccountProfile(activeToken, config, getInstagramAccountSelection(source));
    validateInstagramAccountForSource(source, profile);
    const canonicalProfileUrl = `https://www.instagram.com/${profile.username}/`;

    await saveInstagramCredentials(source.id, {
      instagram_access_token: shortToken.access_token,
      instagram_long_lived_access_token: longToken?.access_token,
      token_type: longToken?.token_type ?? shortToken.token_type ?? "bearer",
      expires_at: expiresAt,
      page_id: profile.page_id,
      instagram_account_id: profile.id,
      instagram_username: profile.username,
      graph_api_version: config.graphApiVersion,
      meta_app_profile: config.profileKey,
      connected_at: connectedAt.toISOString(),
    });
    const updatedInstagramSource = await updateSource(source.id, {
      status: "healthy",
      external_account_id: profile.id,
      account_name: profile.username,
      input_url: canonicalProfileUrl,
      normalized_url: canonicalProfileUrl,
      metadata: {
        ...source.metadata,
        scaffoldOnly: false,
        oauth_connected: true,
        instagram_account_id: profile.id,
        instagram_username: profile.username,
        profile_url: canonicalProfileUrl,
        page_id: profile.page_id ?? null,
        graph_api_version: config.graphApiVersion,
        meta_app_profile: config.profileKey,
        connected_at: connectedAt.toISOString(),
        token_expires_at: expiresAt,
      },
    });
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "instagram_oauth_connected",
      severity: "info",
      message: `Instagram OAuth connected for ${profile.username}.`,
      metadata: { instagramAccountId: profile.id, username: profile.username, pageId: profile.page_id ?? null },
    });
    if (state.connectMetaAds && updatedInstagramSource) {
      try {
        const meta = await connectMetaAds({
          instagramSource: updatedInstagramSource,
          shortToken,
          longToken,
          activeToken,
          expiresAt,
          graphApiVersion: config.graphApiVersion,
          connectedAt: connectedAt.toISOString(),
        });
        return sourceRedirect(request, returnPath, {
          instagram_oauth: "connected",
          meta_ads_oauth: meta.selected ? "connected" : "select_account",
        });
      } catch (error) {
        await recordConnectorEvent({
          source_id: source.id,
          event_type: "meta_ads_oauth_error",
          severity: "error",
          message: sanitizedOAuthEventMessage(error, "Meta Ads OAuth connection failed."),
          metadata: { sanitized: true },
        });
        return sourceRedirect(request, returnPath, {
          instagram_oauth: "connected",
          meta_ads_oauth: "error",
          message: "Instagram stayed connected, but Meta Ads needs attention.",
        });
      }
    }
    return sourceRedirect(request, returnPath, { instagram_oauth: "connected" });
  } catch (error) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "instagram_oauth_error",
      severity: "error",
      message: sanitizedOAuthEventMessage(error, "Instagram OAuth callback failed."),
      metadata: { sanitized: true },
    });
    return sourceRedirect(request, returnPath, { instagram_oauth: "error", message: "Instagram OAuth setup failed." });
  }
}
