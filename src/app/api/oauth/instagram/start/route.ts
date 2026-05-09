import { NextResponse } from "next/server";
import { buildInstagramAuthorizationUrl, getInstagramOAuthConfig } from "@/collection/connectors/instagram/graph-api";
import {
  createInstagramOAuthState,
  INSTAGRAM_OAUTH_STATE_COOKIE,
  INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS,
} from "@/collection/connectors/instagram/oauth-state";
import { AUTO_LAB_INSTAGRAM_SOURCE_ID } from "@/collection/connectors/instagram/constants";
import { AUTO_LAB_DATA_SPACE_SLUG } from "@/storage/data-spaces";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
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
  const sourceId = requestUrl.searchParams.get("sourceId") ?? AUTO_LAB_INSTAGRAM_SOURCE_ID;
  const autoLab = await getDataSpaceBySlug(AUTO_LAB_DATA_SPACE_SLUG);
  if (!autoLab) return jsonError("Auto Lab data space is unavailable.", 404);
  const source = await getSource(sourceId, { dataSpaceId: autoLab.id });
  if (!source) return jsonError("Auto Lab Instagram source not found.", 404);
  if (source.id !== AUTO_LAB_INSTAGRAM_SOURCE_ID || source.source_type_key !== "instagram") {
    return jsonError("Instagram OAuth is available only for the existing Auto Lab Instagram source.", 403);
  }

  try {
    const config = getInstagramOAuthConfig();
    const state = createInstagramOAuthState(source.id);
    const response = NextResponse.redirect(buildInstagramAuthorizationUrl(config, state));
    response.cookies.set({
      name: INSTAGRAM_OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Instagram OAuth setup is unavailable.", 503);
  }
}
