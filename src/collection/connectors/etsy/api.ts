import { ETSY_API_BASE_URL, ETSY_FIELDS, ETSY_TOKEN_URL } from "@/collection/connectors/etsy/constants";

export class EtsyApiError extends Error {
  status: number;
  code: string | null;
  retryAfterSeconds: number | null;
  constructor(message: string, options: { status: number; code?: string | null; retryAfterSeconds?: number | null }) {
    super(message);
    this.name = "EtsyApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export type EtsyTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
};

export type EtsyAuth = { apiKey: string; accessToken: string };

/** The app keys a seller saved, checked for the usual paste mistakes before anything reaches Etsy. */
export function etsyAppKeys(credentials: Record<string, string>) {
  const keystring = credentials[ETSY_FIELDS.keystring]?.trim() ?? "";
  const sharedSecret = credentials[ETSY_FIELDS.sharedSecret]?.trim() ?? "";
  if (!keystring || !sharedSecret) {
    throw new EtsyApiError("Add your Etsy app keystring and shared secret first.", { status: 0, code: "missing_app_keys" });
  }
  if (keystring.includes(":") || /\s/u.test(keystring) || /\s/u.test(sharedSecret)) {
    throw new EtsyApiError("The Etsy keystring and shared secret go in separate fields, without spaces or a colon.", { status: 0, code: "malformed_app_keys" });
  }
  return { keystring, sharedSecret, apiKey: `${keystring}:${sharedSecret}` };
}

/** Etsy prefixes each token with the numeric id of the user who granted it. */
export function etsyUserIdFromToken(accessToken: string) {
  const prefix = accessToken.split(".")[0];
  return prefix && /^\d+$/u.test(prefix) ? prefix : null;
}

/** Removes anything token-like before a message is stored or shown. */
export function sanitizeEtsyMessage(value: unknown) {
  const message = typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : "Etsy request failed.";
  return message
    .replace(/(access_token|refresh_token|code_verifier|code|client_secret)=[^&\s]+/giu, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]")
    .replace(/\b\d{5,}\.[A-Za-z0-9._~-]{20,}/gu, "[redacted]");
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function retryAfter(response: Response) {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Removes each value this request sent, in case Etsy repeats one back in an error. */
function withoutSentValues(message: string, sent: string[]) {
  return sent
    .filter((value) => value.length >= 6)
    .sort((left, right) => right.length - left.length)
    .reduce((text, value) => text.split(value).join("[redacted]"), message);
}

function errorFromResponse(response: Response, body: unknown, sent: string[]) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const code = typeof record.error === "string" && /^[a-z_]{1,64}$/u.test(record.error) ? record.error : null;
  const description = typeof record.error_description === "string" ? record.error_description : typeof record.error === "string" ? record.error : null;
  if (response.status === 429) {
    return new EtsyApiError("Etsy's rate limit was reached; the next sync will try again.", { status: 429, code, retryAfterSeconds: retryAfter(response) });
  }
  const message = sanitizeEtsyMessage(withoutSentValues(description ?? `Etsy answered with status ${response.status}.`, sent));
  return new EtsyApiError(message, { status: response.status, code });
}

async function requestToken(form: URLSearchParams): Promise<EtsyTokenResponse> {
  const response = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form,
  });
  const body = await readBody(response);
  if (!response.ok) throw errorFromResponse(response, body, ["code", "code_verifier", "refresh_token"].map((key) => form.get(key) ?? ""));
  const token = body as Partial<EtsyTokenResponse>;
  if (typeof token.access_token !== "string" || typeof token.refresh_token !== "string") {
    throw new EtsyApiError("Etsy did not return the tokens it should have.", { status: response.status, code: "invalid_token_response" });
  }
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_in: typeof token.expires_in === "number" && token.expires_in > 0 ? token.expires_in : 3600,
    token_type: token.token_type,
    scope: typeof token.scope === "string" ? token.scope : undefined,
  };
}

/** Exchanges the authorization code; Etsy checks the PKCE verifier and the exact redirect URI. */
export function exchangeEtsyCode(input: { keystring: string; code: string; verifier: string; redirectUri: string }) {
  return requestToken(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.keystring,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  }));
}

export function refreshEtsyToken(input: { keystring: string; refreshToken: string }) {
  return requestToken(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.keystring,
    refresh_token: input.refreshToken,
  }));
}

/** True when Etsy refused the token itself, so a refresh (or, failing that, a reconnect) is the fix. */
export function isEtsyAuthorizationFailure(error: unknown) {
  if (!(error instanceof EtsyApiError)) return false;
  return error.status === 401 || error.code === "invalid_grant" || error.code === "invalid_token";
}

export async function etsyGet<T>(path: string, auth: EtsyAuth, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${ETSY_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      "x-api-key": auth.apiKey,
      authorization: `Bearer ${auth.accessToken}`,
      accept: "application/json",
    },
  });
  const body = await readBody(response);
  if (!response.ok) throw errorFromResponse(response, body, [auth.apiKey, ...auth.apiKey.split(":"), auth.accessToken]);
  return body as T;
}

export type EtsyMe = { user_id: number | string; shop_id: number | string | null };

export type EtsyShop = {
  shop_id: number | string;
  shop_name?: string | null;
  currency_code?: string | null;
  url?: string | null;
  listing_active_count?: number | null;
};

export function fetchEtsyMe(auth: EtsyAuth) {
  return etsyGet<EtsyMe>("/users/me", auth);
}

export function fetchEtsyShop(auth: EtsyAuth, shopId: string) {
  return etsyGet<EtsyShop>(`/shops/${encodeURIComponent(shopId)}`, auth);
}

const PAGE_SIZE = 100;
/** Etsy refuses offsets beyond 12,000, so one filter can page through 12,100 receipts at most. */
const MAX_OFFSET = 12_000;

function tooManyReceipts() {
  return new EtsyApiError("Etsy reports more orders for one stretch of time than its API can page through (over 12,100).", { status: 0, code: "too_many_receipts" });
}

/**
 * Receipts in one time filter, every page. Large histories are fetched in
 * windows by the caller, as Etsy asks; a filter that matches more receipts than
 * the offset cap allows fails on its first page, so the caller can split it.
 */
export async function fetchEtsyReceipts(
  auth: EtsyAuth,
  shopId: string,
  filter: { minCreated?: number; maxCreated?: number; minLastModified?: number; maxLastModified?: number },
): Promise<unknown[]> {
  const receipts: unknown[] = [];
  for (let offset = 0; offset <= MAX_OFFSET; offset += PAGE_SIZE) {
    const page = await etsyGet<{ count?: number; results?: unknown[] }>(`/shops/${encodeURIComponent(shopId)}/receipts`, auth, {
      min_created: filter.minCreated,
      max_created: filter.maxCreated,
      min_last_modified: filter.minLastModified,
      max_last_modified: filter.maxLastModified,
      sort_on: "created",
      sort_order: "asc",
      limit: PAGE_SIZE,
      offset,
    });
    const results = Array.isArray(page.results) ? page.results : [];
    const count = typeof page.count === "number" ? page.count : null;
    if (count !== null && count > MAX_OFFSET + PAGE_SIZE) throw tooManyReceipts();
    receipts.push(...results);
    if (results.length < PAGE_SIZE || receipts.length >= (count ?? Number.POSITIVE_INFINITY)) return receipts;
  }
  throw tooManyReceipts();
}
