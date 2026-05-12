import { NextResponse } from "next/server";
import {
  exchangeTikTokCodeForToken,
  fetchTikTokUserInfo,
  getTikTokOAuthConfig,
  tokenExpiresAt,
} from "@/collection/connectors/tiktok/api";
import {
  TIKTOK_OAUTH_STATE_COOKIE,
  validateSignedTikTokOAuthState,
  validateTikTokOAuthState,
} from "@/collection/connectors/tiktok/oauth-state";
import { assertAutoLabTikTokSource, safeTikTokReturnPath } from "@/collection/connectors/tiktok/source-policy";
import { saveCredential } from "@/storage/repositories/credentials-repository";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { getSource, updateSource } from "@/storage/repositories/sources-repository";

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
    name: TIKTOK_OAUTH_STATE_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

async function saveTikTokCredentials(sourceId: string, credentials: Record<string, string | null | undefined>) {
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === "string" && value.trim()) await saveCredential(sourceId, key, value.trim());
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  let state;
  let usedSignedStateFallback = false;
  try {
    const stateParam = requestUrl.searchParams.get("state");
    const stateCookie = parseCookies(request)[TIKTOK_OAUTH_STATE_COOKIE];
    state = stateCookie
      ? validateTikTokOAuthState(stateParam, stateCookie)
      : validateSignedTikTokOAuthState(stateParam);
    usedSignedStateFallback = !stateCookie;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid TikTok OAuth state.", 400);
  }
  const returnPath = safeTikTokReturnPath(state.returnPath, state.dataSpaceSlug, state.sourceId);

  const oauthError = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  if (oauthError) {
    return sourceRedirect(request, returnPath, { tiktok_oauth: "error", message: "TikTok OAuth was cancelled or rejected." });
  }
  const code = requestUrl.searchParams.get("code");
  if (!code) return sourceRedirect(request, returnPath, { tiktok_oauth: "error", message: "Missing TikTok OAuth authorization code." });

  const dataSpace = await getDataSpaceBySlug(state.dataSpaceSlug);
  if (!dataSpace) return jsonError("TikTok OAuth data space is unavailable.", 404);
  const source = await getSource(state.sourceId, { dataSpaceId: dataSpace.id });
  if (!source) return jsonError("TikTok OAuth source was not found in Auto Lab.", 403);
  if (source.source_type_key !== "tiktok") return jsonError("TikTok OAuth callback rejected for this source.", 403);

  try {
    assertAutoLabTikTokSource(source);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "TikTok OAuth callback rejected for this source.", 403);
  }

  if (usedSignedStateFallback) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "tiktok_oauth_state_cookie_missing",
      severity: "warning",
      message: "TikTok OAuth callback used signed-state fallback because the state cookie was missing.",
      metadata: { sanitized: true, dataSpaceSlug: state.dataSpaceSlug },
    });
  }

  try {
    const connectedAt = new Date();
    const config = getTikTokOAuthConfig();
    const token = await exchangeTikTokCodeForToken(code, config);
    const expiresAt = tokenExpiresAt(token.expires_in, connectedAt);
    const refreshExpiresAt = tokenExpiresAt(token.refresh_expires_in, connectedAt);
    const user = await fetchTikTokUserInfo(token.access_token, config, token.scope);
    const openId = user.open_id ?? token.open_id ?? null;
    const displayName = user.display_name ?? null;
    const username = user.username ?? null;

    await saveTikTokCredentials(source.id, {
      tiktok_access_token: token.access_token,
      tiktok_refresh_token: token.refresh_token,
      token_type: token.token_type ?? "Bearer",
      expires_at: expiresAt,
      refresh_expires_at: refreshExpiresAt,
      open_id: openId,
      tiktok_open_id: openId,
      account_id: openId,
      username,
      tiktok_username: username,
      display_name: displayName,
      tiktok_display_name: displayName,
      scope: token.scope,
      tiktok_api_base_url: config.apiBaseUrl,
      connected_at: connectedAt.toISOString(),
    });

    await updateSource(source.id, {
      status: "healthy",
      external_account_id: openId,
      account_name: username ?? displayName ?? source.account_name,
      normalized_url: user.profile_deep_link ?? source.normalized_url,
      metadata: {
        ...source.metadata,
        scaffoldOnly: false,
        oauth_connected: true,
        tiktok_open_id: openId,
        tiktok_username: username ?? null,
        tiktok_display_name: displayName ?? null,
        profile_deep_link: user.profile_deep_link ?? null,
        tiktok_scopes: token.scope ?? null,
        connected_at: connectedAt.toISOString(),
        token_expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
      },
    });
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "tiktok_oauth_connected",
      severity: "info",
      message: `TikTok OAuth connected${displayName ? ` for ${displayName}` : ""}.`,
      metadata: { openId, username, displayName, scopes: token.scope ?? null },
    });
    return sourceRedirect(request, returnPath, { tiktok_oauth: "connected" });
  } catch (error) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "tiktok_oauth_error",
      severity: "error",
      message: error instanceof Error ? error.message : "TikTok OAuth callback failed.",
      metadata: { sanitized: true },
    });
    return sourceRedirect(request, returnPath, { tiktok_oauth: "error", message: "TikTok OAuth setup failed." });
  }
}
