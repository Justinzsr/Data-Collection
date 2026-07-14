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

async function saveInstagramCredentials(sourceId: string, credentials: Record<string, string | null | undefined>) {
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === "string" && value.trim()) {
      await saveCredential(sourceId, key, value.trim());
    }
  }
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

  const oauthError = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  if (oauthError) {
    return sourceRedirect(request, returnPath, { instagram_oauth: "error", message: "Meta OAuth was cancelled or rejected." });
  }
  const code = requestUrl.searchParams.get("code");
  if (!code) return sourceRedirect(request, returnPath, { instagram_oauth: "error", message: "Missing Instagram OAuth authorization code." });

  const dataSpace = await getDataSpaceBySlug(state.dataSpaceSlug);
  if (!dataSpace) return jsonError("Instagram OAuth data space is unavailable.", 404);
  const source = await getSource(state.sourceId, { dataSpaceId: dataSpace.id });
  if (!source) return jsonError("Instagram OAuth source was not found in the requested data space.", 403);
  if (source.source_type_key !== "instagram") return jsonError("Instagram OAuth callback rejected for this source.", 403);

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
        message: error instanceof Error ? error.message : "Could not exchange Instagram token for a long-lived token.",
        metadata: { sanitized: true },
      });
    }
    const activeToken = longToken?.access_token ?? shortToken.access_token;
    const expiresAt = tokenExpiresAt(longToken?.expires_in ?? shortToken.expires_in, connectedAt);
    const profile = await fetchInstagramAccountProfile(activeToken, config, getInstagramAccountSelection(source));
    validateInstagramAccountForSource(source, profile);

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
    await updateSource(source.id, {
      status: "healthy",
      external_account_id: profile.id,
      account_name: profile.username,
      normalized_url: `https://www.instagram.com/${profile.username}`,
      metadata: {
        ...source.metadata,
        scaffoldOnly: false,
        oauth_connected: true,
        instagram_account_id: profile.id,
        instagram_username: profile.username,
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
    return sourceRedirect(request, returnPath, { instagram_oauth: "connected" });
  } catch (error) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "instagram_oauth_error",
      severity: "error",
      message: error instanceof Error ? error.message : "Instagram OAuth callback failed.",
      metadata: { sanitized: true },
    });
    return sourceRedirect(request, returnPath, { instagram_oauth: "error", message: "Instagram OAuth setup failed." });
  }
}
