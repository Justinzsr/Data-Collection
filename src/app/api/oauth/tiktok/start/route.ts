import { NextResponse } from "next/server";
import { buildTikTokAuthorizationUrl, getTikTokOAuthConfig } from "@/collection/connectors/tiktok/api";
import {
  createTikTokOAuthState,
  TIKTOK_OAUTH_STATE_COOKIE,
  TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS,
} from "@/collection/connectors/tiktok/oauth-state";
import { assertAutoLabTikTokSource, safeTikTokReturnPath } from "@/collection/connectors/tiktok/source-policy";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
import { AUTO_LAB_DATA_SPACE_SLUG } from "@/storage/data-spaces";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

function loginRedirect(request: Request) {
  const url = new URL(request.url);
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${url.pathname}${url.search}`);
  return NextResponse.redirect(loginUrl);
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  if (!(await isDashboardRequestAuthenticated(request))) return loginRedirect(request);

  const requestUrl = new URL(request.url);
  const sourceId = requestUrl.searchParams.get("sourceId");
  if (!sourceId) return jsonError("sourceId is required for TikTok OAuth.", 400);
  const dataSpaceSlug = requestUrl.searchParams.get("dataSpaceSlug") ?? AUTO_LAB_DATA_SPACE_SLUG;
  if (dataSpaceSlug !== AUTO_LAB_DATA_SPACE_SLUG) return jsonError("TikTok OAuth is currently enabled only for Auto Lab.", 403);
  const dataSpace = await getDataSpaceBySlug(AUTO_LAB_DATA_SPACE_SLUG);
  if (!dataSpace) return jsonError("Auto Lab data space is unavailable.", 404);
  const source = await getSource(sourceId, { dataSpaceId: dataSpace.id });
  if (!source) return jsonError("Auto Lab TikTok source not found.", 404);

  try {
    assertAutoLabTikTokSource(source);
    const config = getTikTokOAuthConfig();
    const returnPath = safeTikTokReturnPath(requestUrl.searchParams.get("returnPath"), AUTO_LAB_DATA_SPACE_SLUG, source.id);
    const state = createTikTokOAuthState({ sourceId: source.id, dataSpaceSlug: AUTO_LAB_DATA_SPACE_SLUG, returnPath });
    const response = NextResponse.redirect(buildTikTokAuthorizationUrl(config, state));
    response.cookies.set({
      name: TIKTOK_OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: TIKTOK_OAUTH_STATE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "TikTok OAuth setup is unavailable.", 503);
  }
}
