import { NextResponse } from "next/server";
import { INSTAGRAM_OAUTH_SCOPES } from "@/collection/connectors/instagram/constants";
import { buildInstagramAuthorizationUrl, getInstagramOAuthConfigForSource } from "@/collection/connectors/instagram/graph-api";
import {
  createInstagramOAuthState,
  getInstagramOAuthStateCookieName,
  INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS,
} from "@/collection/connectors/instagram/oauth-state";
import { safeInstagramReturnPath } from "@/collection/connectors/instagram/source-policy";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
import { getDataSpaceBySlug, listDataSpaces } from "@/storage/repositories/data-spaces-repository";
import { getSource } from "@/storage/repositories/sources-repository";
import type { DataSpace, Source } from "@/storage/db/schema";

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

async function resolveInstagramSource(sourceId: string, dataSpaceSlug: string | null): Promise<{ source: Source; dataSpace: DataSpace } | null> {
  if (dataSpaceSlug) {
    const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
    if (!dataSpace) return null;
    const source = await getSource(sourceId, { dataSpaceId: dataSpace.id });
    return source ? { source, dataSpace } : null;
  }
  const source = await getSource(sourceId);
  if (!source) return null;
  const dataSpace = (await listDataSpaces()).find((space) => space.id === source.data_space_id);
  return dataSpace ? { source, dataSpace } : null;
}

export async function GET(request: Request) {
  if (!(await isDashboardRequestAuthenticated(request))) return loginRedirect(request);

  const requestUrl = new URL(request.url);
  const sourceId = requestUrl.searchParams.get("instagramSourceId");
  if (!sourceId) return jsonError("instagramSourceId is required for Meta Ads OAuth.", 400);
  const resolved = await resolveInstagramSource(sourceId, requestUrl.searchParams.get("dataSpaceSlug"));
  if (!resolved) return jsonError("Instagram source not found in the requested data space.", 404);
  const { source, dataSpace } = resolved;
  if (source.source_type_key !== "instagram") return jsonError("Meta Ads OAuth must start from an Instagram source.", 403);
  if (dataSpace.slug !== "moonarq") return jsonError("The first Story Meta Ads connection is only available in the MoonArq data space.", 403);

  try {
    const config = getInstagramOAuthConfigForSource(source);
    const returnPath = safeInstagramReturnPath(requestUrl.searchParams.get("returnPath"), dataSpace.slug, source.id);
    const state = createInstagramOAuthState({
      sourceId: source.id,
      dataSpaceSlug: dataSpace.slug,
      returnPath,
      metaAppProfile: config.profileKey,
      connectMetaAds: true,
    });
    const response = NextResponse.redirect(
      buildInstagramAuthorizationUrl(config, state, [...INSTAGRAM_OAUTH_SCOPES, "ads_read"]),
    );
    response.cookies.set({
      name: getInstagramOAuthStateCookieName(),
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: INSTAGRAM_OAUTH_STATE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Meta Ads OAuth setup is unavailable.", 503);
  }
}
