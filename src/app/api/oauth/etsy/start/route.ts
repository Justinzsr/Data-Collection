import { NextResponse } from "next/server";
import { etsyAppKeys } from "@/collection/connectors/etsy/api";
import {
  buildEtsyAuthorizationUrl,
  createEtsyOAuthState,
  createPkcePair,
  ETSY_OAUTH_MAX_AGE_SECONDS,
  etsyOAuthCookieName,
  etsyRedirectUri,
  safeEtsyReturnPath,
  sealEtsyOAuthCookie,
} from "@/collection/connectors/etsy/oauth";
import { etsyOAuthFailureReason, type EtsyOAuthReason } from "@/collection/connectors/etsy/oauth-results";
import { isDashboardRequestAuthenticated } from "@/storage/auth/dashboard-session";
import { getDecryptedCredentialMap } from "@/storage/repositories/credentials-repository";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { getSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

function loginRedirect(request: Request) {
  const url = new URL(request.url);
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${url.pathname}${url.search}`);
  return NextResponse.redirect(loginUrl);
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Back to the source page with a reason code, which it explains above the Etsy connection steps. */
function returnWithError(request: Request, returnPath: string, reason: EtsyOAuthReason) {
  const url = new URL(returnPath, request.url);
  url.searchParams.set("etsy_oauth", "error");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, { status: 303 });
}

/**
 * Starts Etsy OAuth for one Etsy source: checks that its app keys are saved,
 * sends the seller to Etsy with a signed state and a PKCE challenge, and keeps
 * the verifier in an encrypted, HttpOnly cookie for the callback.
 */
export async function GET(request: Request) {
  if (!(await isDashboardRequestAuthenticated(request))) return loginRedirect(request);

  const requestUrl = new URL(request.url);
  const sourceId = requestUrl.searchParams.get("sourceId");
  const dataSpaceSlug = requestUrl.searchParams.get("dataSpaceSlug");
  if (!sourceId || !dataSpaceSlug) return jsonError("sourceId and dataSpaceSlug are required for Etsy OAuth.", 400);
  const dataSpace = await getDataSpaceBySlug(dataSpaceSlug);
  if (!dataSpace) return jsonError("Unknown data space.", 404);
  const source = await getSource(sourceId, { dataSpaceId: dataSpace.id });
  if (!source) return jsonError("Etsy source not found in the requested data space.", 404);
  if (source.source_type_key !== "etsy") return jsonError("Etsy OAuth can only be started for Etsy sources.", 403);
  const returnPath = safeEtsyReturnPath(requestUrl.searchParams.get("returnPath"), dataSpace.slug, source.id);
  if (source.status === "disabled") return returnWithError(request, returnPath, "disabled");

  let keystring: string;
  try {
    ({ keystring } = etsyAppKeys(await getDecryptedCredentialMap(source.id)));
  } catch (error) {
    return returnWithError(request, returnPath, etsyOAuthFailureReason(error));
  }

  try {
    const redirectUri = etsyRedirectUri(request.url);
    const state = createEtsyOAuthState({ sourceId: source.id, dataSpaceSlug: dataSpace.slug, returnPath, redirectUri });
    const { verifier, challenge } = createPkcePair();
    const response = NextResponse.redirect(buildEtsyAuthorizationUrl({ keystring, redirectUri, state, challenge }));
    response.cookies.set({
      name: etsyOAuthCookieName(),
      value: sealEtsyOAuthCookie({ state, verifier }),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ETSY_OAUTH_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Etsy OAuth setup is unavailable.", 503);
  }
}
