import { NextResponse } from "next/server";
import { EtsyApiError, etsyAppKeys, etsyUserIdFromToken, exchangeEtsyCode, fetchEtsyMe, fetchEtsyShop, sanitizeEtsyMessage } from "@/collection/connectors/etsy/api";
import { detectEtsy } from "@/collection/connectors/etsy/detect";
import { saveEtsyTokens } from "@/collection/connectors/etsy/tokens";
import { ETSY_FIELDS } from "@/collection/connectors/etsy/constants";
import { EtsyOAuthError, etsyOAuthCookieName, etsyReturnPathFromState, safeEtsyReturnPath, validateEtsyCallback } from "@/collection/connectors/etsy/oauth";
import { EtsyShopMismatchError, etsyOAuthFailureReason, type EtsyOAuthReason } from "@/collection/connectors/etsy/oauth-results";
import { getDecryptedCredentialMap, saveCredential } from "@/storage/repositories/credentials-repository";
import { getDataSpaceBySlug } from "@/storage/repositories/data-spaces-repository";
import { recordConnectorEvent } from "@/storage/repositories/events-repository";
import { getSource, updateSource } from "@/storage/repositories/sources-repository";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

/** Back to the source page with a result code; the one-time PKCE cookie is cleared on every outcome. */
function sourceRedirect(request: Request, returnPath: string, result: { ok: true } | { ok: false; reason: EtsyOAuthReason }) {
  const url = new URL(returnPath, request.url);
  url.searchParams.set("etsy_oauth", result.ok ? "connected" : "error");
  if (!result.ok) url.searchParams.set("reason", result.reason);
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.set({
    name: etsyOAuthCookieName(),
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  let state: ReturnType<typeof validateEtsyCallback>;
  try {
    state = validateEtsyCallback(requestUrl.searchParams.get("state"), cookieValue(request, etsyOAuthCookieName()));
  } catch (error) {
    // A state this server signed still names a safe page to return to; the code is not used.
    const fallbackPath = etsyReturnPathFromState(requestUrl.searchParams.get("state"));
    if (fallbackPath) return sourceRedirect(request, fallbackPath, { ok: false, reason: "expired" });
    return jsonError(error instanceof EtsyOAuthError ? error.message : "Invalid Etsy OAuth state.", 400);
  }
  const { payload, verifier } = state;
  const returnPath = safeEtsyReturnPath(payload.returnPath, payload.dataSpaceSlug, payload.sourceId);

  if (requestUrl.searchParams.get("error")) return sourceRedirect(request, returnPath, { ok: false, reason: "denied" });
  const code = requestUrl.searchParams.get("code");
  if (!code) return sourceRedirect(request, returnPath, { ok: false, reason: "no_code" });

  const dataSpace = await getDataSpaceBySlug(payload.dataSpaceSlug);
  if (!dataSpace) return jsonError("Etsy OAuth data space is unavailable.", 404);
  const source = await getSource(payload.sourceId, { dataSpaceId: dataSpace.id });
  if (!source || source.source_type_key !== "etsy") return jsonError("Etsy OAuth callback rejected for this source.", 403);
  // Disabled while the seller was on Etsy: keep it disabled and store nothing.
  if (source.status === "disabled") return sourceRedirect(request, returnPath, { ok: false, reason: "disabled" });

  try {
    const connectedAt = new Date();
    const { keystring, apiKey } = etsyAppKeys(await getDecryptedCredentialMap(source.id));
    const token = await exchangeEtsyCode({ keystring, code, verifier, redirectUri: payload.redirectUri });
    const auth = { apiKey, accessToken: token.access_token };
    const me = await fetchEtsyMe(auth);
    const shopId = me.shop_id === null || me.shop_id === undefined || me.shop_id === "" ? null : String(me.shop_id);
    if (!shopId) throw new EtsyShopMismatchError("no_shop");
    const shop = await fetchEtsyShop(auth, shopId);
    const shopName = typeof shop.shop_name === "string" && shop.shop_name ? shop.shop_name : null;

    // A source belongs to one shop: refuse a different shop than the one it is already connected to or was added for.
    const expectedShopName = detectEtsy(source.normalized_url ?? source.input_url ?? "")?.accountName ?? null;
    if (source.external_account_id && source.external_account_id !== shopId) throw new EtsyShopMismatchError("different_shop");
    if (!source.external_account_id && expectedShopName && shopName && expectedShopName.toLowerCase() !== shopName.toLowerCase()) {
      throw new EtsyShopMismatchError("different_shop");
    }

    const { expiresAt, refreshExpiresAt } = await saveEtsyTokens(source.id, token, connectedAt);
    await saveCredential(source.id, ETSY_FIELDS.shopId, shopId);
    const userId = me.user_id === null || me.user_id === undefined ? etsyUserIdFromToken(token.access_token) : String(me.user_id);
    if (userId) await saveCredential(source.id, ETSY_FIELDS.userId, userId);
    await saveCredential(source.id, ETSY_FIELDS.connectedAt, connectedAt.toISOString());
    const currency = typeof shop.currency_code === "string" && /^[A-Za-z]{3}$/u.test(shop.currency_code) ? shop.currency_code.toLowerCase() : null;
    const shopUrl = shopName ? `https://www.etsy.com/shop/${encodeURIComponent(shopName)}` : source.normalized_url;
    await updateSource(source.id, {
      status: "healthy",
      // Whatever stopped the last sync was about this authorization; the next sync reports anything still wrong.
      last_error: null,
      external_account_id: shopId,
      account_name: shopName ?? source.account_name,
      normalized_url: shopUrl,
      metadata: {
        ...source.metadata,
        oauth_connected: true,
        etsy_shop_id: shopId,
        etsy_shop_name: shopName,
        etsy_currency: currency,
        etsy_scopes: token.scope ?? null,
        connected_at: connectedAt.toISOString(),
        token_expires_at: expiresAt,
        refresh_expires_at: refreshExpiresAt,
      },
    }, { dataSpaceId: dataSpace.id });
    await recordConnectorEvent({
      source_id: source.id,
      event_type: "etsy_oauth_connected",
      severity: "info",
      message: `Etsy OAuth connected${shopName ? ` for ${shopName}` : ""}.`,
      metadata: { sanitized: true, shopId, scopes: token.scope ?? null },
    });
    return sourceRedirect(request, returnPath, { ok: true });
  } catch (error) {
    const reason = etsyOAuthFailureReason(error);
    const mismatch = error instanceof EtsyShopMismatchError;
    await recordConnectorEvent({
      source_id: source.id,
      event_type: mismatch ? "etsy_oauth_shop_mismatch" : "etsy_oauth_error",
      severity: "error",
      // Etsy's own words, scrubbed of anything this request sent, so the Health page can explain a failure.
      message: mismatch
        ? `Etsy connection refused: ${error.message}`
        : `Etsy connection failed: ${sanitizeEtsyMessage(error instanceof Error ? error.message : null)}${error instanceof EtsyApiError && error.code ? ` (${error.code})` : ""}`,
      metadata: {
        sanitized: true,
        reason,
        errorType: error instanceof Error ? error.name : "UnknownError",
        status: error instanceof EtsyApiError ? error.status : null,
        code: error instanceof EtsyApiError ? error.code : null,
      },
    });
    return sourceRedirect(request, returnPath, { ok: false, reason });
  }
}
