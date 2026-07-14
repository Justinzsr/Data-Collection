import { NextResponse } from "next/server";
import {
  exchangeTikTokCodeForToken,
  fetchTikTokUserInfo,
  getTikTokOAuthConfig,
  tokenExpiresAt,
} from "@/collection/connectors/tiktok/api";
import {
  getTikTokOAuthStateCookieName,
  validateSignedTikTokOAuthState,
  validateTikTokOAuthState,
} from "@/collection/connectors/tiktok/oauth-state";
import {
  canonicalTikTokProfileUrl,
  checkTikTokOAuthIdentity,
  getTikTokAppProfileKeyForSource,
  safeTikTokReturnPath,
} from "@/collection/connectors/tiktok/source-policy";
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
    name: getTikTokOAuthStateCookieName(),
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
    const stateCookie = parseCookies(request)[getTikTokOAuthStateCookieName()];
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
  if (!source) return jsonError("TikTok OAuth source was not found in the requested data space.", 403);
  if (source.source_type_key !== "tiktok") return jsonError("TikTok OAuth callback rejected for this source.", 403);

  if (usedSignedStateFallback) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "tiktok_oauth_state_cookie_missing",
      severity: "warning",
      message: "TikTok OAuth callback used signed-state fallback because the state cookie was missing.",
      metadata: { sanitized: true, dataSpaceSlug: state.dataSpaceSlug, tiktokAppProfile: state.tiktokAppProfile ?? null },
    });
  }

  try {
    const connectedAt = new Date();
    const config = getTikTokOAuthConfig({ profileKey: getTikTokAppProfileKeyForSource(source) });
    if (state.tiktokAppProfile && state.tiktokAppProfile !== config.profileKey) {
      throw new Error(`TikTok OAuth state was issued for ${state.tiktokAppProfile} app profile, but this source now resolves to ${config.profileKey}.`);
    }
    const token = await exchangeTikTokCodeForToken(code, config);
    const expiresAt = tokenExpiresAt(token.expires_in, connectedAt);
    const refreshExpiresAt = tokenExpiresAt(token.refresh_expires_in, connectedAt);
    const user = await fetchTikTokUserInfo(token.access_token, config, token.scope);
    const openId = user.open_id ?? token.open_id ?? null;
    const displayName = user.display_name ?? null;
    const username = user.username ?? null;
    const identityCheck = checkTikTokOAuthIdentity(source, { openId, username });
    if (!identityCheck.ok) {
      await recordConnectorEvent({
        source_id: source.id,
        event_type: "tiktok_oauth_account_mismatch",
        severity: "error",
        message: "TikTok OAuth account did not match the account already connected to this source.",
        metadata: { sanitized: true, reason: identityCheck.reason },
      });
      return sourceRedirect(request, returnPath, {
        tiktok_oauth: "error",
        message: "That TikTok account does not match this connected source.",
      });
    }
    const canonicalProfileUrl = canonicalTikTokProfileUrl(username, user.profile_deep_link);

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
      tiktok_app_profile: config.profileKey,
      connected_at: connectedAt.toISOString(),
    });

    await updateSource(source.id, {
      status: "healthy",
      input_url: canonicalProfileUrl ?? source.input_url,
      external_account_id: openId,
      account_name: username ?? displayName ?? source.account_name,
      normalized_url: canonicalProfileUrl ?? source.normalized_url,
      metadata: {
        ...source.metadata,
        scaffoldOnly: false,
        oauth_connected: true,
        tiktok_open_id: openId,
        tiktok_username: username ?? null,
        tiktok_display_name: displayName ?? null,
        profile_deep_link: canonicalProfileUrl,
        tiktok_scopes: token.scope ?? null,
        tiktok_app_profile: config.profileKey,
        tiktok_app_profile_label: config.profileLabel,
        tiktok_uses_default_app_fallback: config.usesDefaultFallback,
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
      metadata: { openId, username, displayName, scopes: token.scope ?? null, tiktokAppProfile: config.profileKey },
    });
    return sourceRedirect(request, returnPath, { tiktok_oauth: "connected" });
  } catch (error) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "tiktok_oauth_error",
      severity: "error",
      message: "TikTok OAuth callback failed.",
      metadata: { sanitized: true, errorType: error instanceof Error ? error.name : "UnknownError" },
    });
    return sourceRedirect(request, returnPath, { tiktok_oauth: "error", message: "TikTok OAuth setup failed." });
  }
}
