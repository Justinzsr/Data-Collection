import { NextResponse } from "next/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchInstagramAccountProfile,
  getInstagramOAuthConfig,
  tokenExpiresAt,
  type InstagramTokenResponse,
} from "@/collection/connectors/instagram/graph-api";
import {
  INSTAGRAM_OAUTH_STATE_COOKIE,
  validateInstagramOAuthState,
} from "@/collection/connectors/instagram/oauth-state";
import {
  AUTO_LAB_INSTAGRAM_ACCOUNT_ID,
  AUTO_LAB_INSTAGRAM_SOURCE_ID,
  AUTO_LAB_INSTAGRAM_USERNAME,
} from "@/collection/connectors/instagram/constants";
import { AUTO_LAB_DATA_SPACE_SLUG } from "@/storage/data-spaces";
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

function sourceRedirect(request: Request, sourceId = AUTO_LAB_INSTAGRAM_SOURCE_ID, params: Record<string, string> = {}) {
  const url = new URL(`/w/${AUTO_LAB_DATA_SPACE_SLUG}/dashboard/sources/${sourceId}`, request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.set({
    name: INSTAGRAM_OAUTH_STATE_COOKIE,
    value: "",
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
  const oauthError = requestUrl.searchParams.get("error_description") ?? requestUrl.searchParams.get("error");
  if (oauthError) {
    return sourceRedirect(request, AUTO_LAB_INSTAGRAM_SOURCE_ID, { instagram_oauth: "error", message: "Meta OAuth was cancelled or rejected." });
  }
  const code = requestUrl.searchParams.get("code");
  if (!code) return jsonError("Missing Instagram OAuth authorization code.", 400);

  let state;
  try {
    state = validateInstagramOAuthState(requestUrl.searchParams.get("state"), parseCookies(request)[INSTAGRAM_OAUTH_STATE_COOKIE]);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid Instagram OAuth state.", 400);
  }

  const autoLab = await getDataSpaceBySlug(AUTO_LAB_DATA_SPACE_SLUG);
  if (!autoLab) return jsonError("Auto Lab data space is unavailable.", 404);
  const source = await getSource(state.sourceId, { dataSpaceId: autoLab.id });
  if (!source) return jsonError("Auto Lab Instagram source not found.", 404);
  if (source.id !== AUTO_LAB_INSTAGRAM_SOURCE_ID || source.source_type_key !== "instagram") {
    return jsonError("Instagram OAuth callback rejected for this source.", 403);
  }

  try {
    const connectedAt = new Date();
    const config = getInstagramOAuthConfig();
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
    const profile = await fetchInstagramAccountProfile(activeToken, config, AUTO_LAB_INSTAGRAM_ACCOUNT_ID);
    if (profile.id !== AUTO_LAB_INSTAGRAM_ACCOUNT_ID) {
      throw new Error("Connected Instagram account ID does not match Auto Lab.");
    }
    if (profile.username !== AUTO_LAB_INSTAGRAM_USERNAME) {
      throw new Error("Connected Instagram username does not match just.4is.");
    }

    await saveInstagramCredentials(source.id, {
      instagram_access_token: shortToken.access_token,
      instagram_long_lived_access_token: longToken?.access_token,
      token_type: longToken?.token_type ?? shortToken.token_type ?? "bearer",
      expires_at: expiresAt,
      page_id: profile.page_id,
      instagram_account_id: profile.id,
      instagram_username: profile.username,
      graph_api_version: config.graphApiVersion,
      connected_at: connectedAt.toISOString(),
    });
    await updateSource(source.id, {
      status: "healthy",
      external_account_id: profile.id,
      account_name: profile.username,
      normalized_url: `https://www.instagram.com/${profile.username}`,
      metadata: {
        ...source.metadata,
        oauth_connected: true,
        instagram_account_id: profile.id,
        instagram_username: profile.username,
        page_id: profile.page_id ?? null,
        graph_api_version: config.graphApiVersion,
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
    return sourceRedirect(request, source.id, { instagram_oauth: "connected" });
  } catch (error) {
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "instagram_oauth_error",
      severity: "error",
      message: error instanceof Error ? error.message : "Instagram OAuth callback failed.",
      metadata: { sanitized: true },
    });
    return sourceRedirect(request, source.id, { instagram_oauth: "error", message: "Instagram OAuth setup failed." });
  }
}
