import "server-only";

import { createHash } from "node:crypto";
import type { JsonRecord, Source } from "@/storage/db/schema";

export const SHOPIFY_ADMIN_API_VERSION = "2026-07";
export const SHOPIFY_REQUIRED_SCOPES = ["read_orders"] as const;
export const SHOPIFY_ORDER_LOOKBACK_DAYS = 60;
export const SHOPIFY_SHOP_ID_METADATA_KEY = "shopify_shop_id";
export const SHOPIFY_ATTRIBUTION_VERSION = "customer-journey-v1" as const;

const SHOPIFY_ORDER_PAGE_SIZE = 25;
const SHOPIFY_MAX_ORDER_PAGES = 100;
const SHOPIFY_LINE_ITEM_PAGE_SIZE = 100;
const SHOPIFY_MAX_LINE_ITEM_PAGES = 100;
const SHOPIFY_GRAPHQL_MAX_RETRIES = 5;
const SHOPIFY_STORE_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.myshopify\.com$/i;

export type ShopifyMoney = {
  amount: string;
  currencyCode: string;
};

export type ShopifyMoneyBag = {
  shopMoney: ShopifyMoney;
};

export type ShopifyLineItem = {
  id: string;
  name: string;
  quantity: number;
  originalUnitPriceSet: ShopifyMoneyBag;
};

export type ShopifyUtmParameters = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
};

export type ShopifyCustomerVisit = {
  landingPage: string | null;
  referrerUrl: string | null;
  source: string;
  sourceType: string | null;
  utmParameters: ShopifyUtmParameters | null;
};

export type ShopifyCustomerJourneySummary = {
  ready: boolean;
  daysToConversion: number | null;
  customerOrderIndex: number | null;
  firstVisit: ShopifyCustomerVisit | null;
  lastVisit: ShopifyCustomerVisit | null;
};

export type ShopifyOrder = {
  id: string;
  createdAt: string;
  test: boolean;
  currencyCode: string;
  subtotalPriceSet: ShopifyMoneyBag | null;
  totalDiscountsSet: ShopifyMoneyBag | null;
  currentTotalPriceSet: ShopifyMoneyBag;
  netPaymentSet: ShopifyMoneyBag;
  totalRefundedSet: ShopifyMoneyBag;
  customerJourneySummary: ShopifyCustomerJourneySummary | null;
  lineItems: {
    nodes: ShopifyLineItem[];
    pageInfo: { hasNextPage: boolean };
  };
};

export type ShopifyShop = {
  id: string;
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  ianaTimezone: string;
};

export type ShopifySyncSnapshot = {
  kind: "shopify_orders_snapshot";
  attributionVersion: typeof SHOPIFY_ATTRIBUTION_VERSION;
  fetchedAt: string;
  apiVersion: string;
  lookbackDays: number;
  windowStartDate: string;
  queryStartAt: string;
  shop: ShopifyShop;
  orders: ShopifyOrder[];
};

type ShopifyTokenResponse = {
  access_token?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type ShopifyGraphResponse<T> = {
  data?: T;
  errors?: Array<{ message?: unknown; extensions?: { code?: unknown } }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: unknown;
      actualQueryCost?: unknown;
      throttleStatus?: {
        maximumAvailable?: unknown;
        currentlyAvailable?: unknown;
        restoreRate?: unknown;
      };
    };
  };
};

export class ShopifyApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "ShopifyApiError";
    this.status = options.status ?? 500;
    this.code = options.code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeShopifyMessage(value: unknown, secrets: string[] = []) {
  let message = typeof value === "string" && value.trim() ? value.trim() : "Shopify API request failed.";
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join("[redacted]");
  return message
    .replace(/client_secret(?:=|%3D)[^&\s]+/giu, "client_secret=[redacted]")
    .replace(/access_token(?:=|%3D)[^&\s]+/giu, "access_token=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gu, "Bearer [redacted]")
    .replace(/shpat_[A-Za-z0-9_-]+/gu, "[redacted-token]");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export function normalizeShopifyStoreUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const hostname = url.hostname.toLowerCase();
  const direct = SHOPIFY_STORE_PATTERN.exec(hostname);
  if (direct) {
    const storeHandle = direct[1].toLowerCase();
    const shopDomain = `${storeHandle}.myshopify.com`;
    return { storeHandle, shopDomain, normalizedUrl: `https://${shopDomain}` };
  }
  if (hostname !== "admin.shopify.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "store") return null;
  const storeHandle = parts[1].toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(storeHandle)) return null;
  const shopDomain = `${storeHandle}.myshopify.com`;
  return { storeHandle, shopDomain, normalizedUrl: `https://${shopDomain}` };
}

export function getShopifyStoreForSource(source: Pick<Source, "normalized_url" | "input_url">) {
  for (const candidate of [source.normalized_url, source.input_url]) {
    const store = candidate ? normalizeShopifyStoreUrl(candidate) : null;
    if (store) return store;
  }
  throw new ShopifyApiError("Shopify source must use the store's canonical https://*.myshopify.com URL.", {
    status: 400,
    code: "invalid_shop_domain",
  });
}

export function getPinnedShopifyShopId(source: Pick<Source, "metadata">) {
  const value = source.metadata[SHOPIFY_SHOP_ID_METADATA_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function assertShopifyShopIdentity(
  source: Pick<Source, "metadata">,
  shop: Pick<ShopifyShop, "id">,
) {
  const pinnedShopId = getPinnedShopifyShopId(source);
  if (pinnedShopId && pinnedShopId !== shop.id) {
    throw new ShopifyApiError(
      "The Shopify app resolved to a different store than this source's pinned Shopify identity. Create a new source to connect another store.",
      { status: 409, code: "shop_identity_mismatch" },
    );
  }
}

function parseScopes(value: unknown) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(/[,\s]+/u).map((scope) => scope.trim()).filter(Boolean))].sort();
}

export function missingShopifyScopes(value: unknown) {
  const granted = new Set(parseScopes(value));
  return SHOPIFY_REQUIRED_SCOPES.filter((scope) => !granted.has(scope));
}

export async function exchangeShopifyClientCredentials(
  shopDomain: string,
  credentials: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
) {
  if (!SHOPIFY_STORE_PATTERN.test(shopDomain)) {
    throw new ShopifyApiError("Invalid Shopify store domain.", { status: 400, code: "invalid_shop_domain" });
  }
  const clientId = credentials.shopify_client_id?.trim();
  const clientSecret = credentials.shopify_client_secret?.trim();
  if (!clientId || !clientSecret) {
    throw new ShopifyApiError("Shopify Client ID and Client secret are required.", {
      status: 400,
      code: "missing_credentials",
    });
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  let response: Response;
  try {
    response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    throw new ShopifyApiError(sanitizeShopifyMessage(error instanceof Error ? error.message : error, [clientId, clientSecret]), {
      code: "token_request_failed",
    });
  }
  const payload = (await readJson(response)) as ShopifyTokenResponse;
  const errorCode = typeof payload.error === "string" ? payload.error : undefined;
  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
    const description = typeof payload.error_description === "string" ? payload.error_description : errorCode;
    const fallback = `Shopify credential exchange failed (HTTP ${response.status}).`;
    throw new ShopifyApiError(sanitizeShopifyMessage(description ?? fallback, [clientId, clientSecret]), {
      status: response.status,
      code: errorCode ?? "token_exchange_failed",
    });
  }
  const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) ? payload.expires_in : null;
  return {
    accessToken: payload.access_token,
    scopes: parseScopes(payload.scope),
    expiresIn,
  };
}

async function shopifyGraphql<T>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: JsonRecord,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  for (let attempt = 0; attempt <= SHOPIFY_GRAPHQL_MAX_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(`https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-access-token": accessToken,
          "Shopify-GraphQL-Cost-Debug": "1",
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        redirect: "error",
      });
    } catch (error) {
      throw new ShopifyApiError(sanitizeShopifyMessage(error instanceof Error ? error.message : error, [accessToken]), {
        code: "graphql_request_failed",
      });
    }
    const payload = (await readJson(response)) as ShopifyGraphResponse<T>;
    const throttled = response.status === 429 || payload.errors?.some((item) => item.extensions?.code === "THROTTLED") === true;
    if (throttled && attempt < SHOPIFY_GRAPHQL_MAX_RETRIES) {
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const requested = Number(payload.extensions?.cost?.requestedQueryCost);
      const available = Number(payload.extensions?.cost?.throttleStatus?.currentlyAvailable);
      const restoreRate = Number(payload.extensions?.cost?.throttleStatus?.restoreRate);
      const costDelay = Number.isFinite(requested) && Number.isFinite(available) && Number.isFinite(restoreRate) && restoreRate > 0
        ? Math.ceil((Math.max(1, requested - available) / restoreRate) * 1_000)
        : 1_000;
      const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1_000
        : costDelay;
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, Math.max(1_000, retryDelay))));
      continue;
    }
    const graphMessage = Array.isArray(payload.errors)
      ? payload.errors.map((item) => sanitizeShopifyMessage(item.message, [accessToken])).join(" ")
      : null;
    if (!response.ok || graphMessage || !payload.data) {
      throw new ShopifyApiError(graphMessage || `Shopify GraphQL request failed (HTTP ${response.status}).`, {
        status: response.status,
        code: throttled ? "throttled" : "graphql_error",
      });
    }
    return payload.data;
  }
  throw new ShopifyApiError("Shopify GraphQL request remained throttled after bounded retries.", {
    status: 429,
    code: "throttled",
  });
}

const SHOP_QUERY = `#graphql
  query MoonArqShopifyConnection {
    shop {
      id
      name
      myshopifyDomain
      currencyCode
      ianaTimezone
    }
  }
`;

const ORDERS_QUERY = `#graphql
  query MoonArqShopifyOrders($first: Int!, $after: String, $search: String!) {
    orders(first: $first, after: $after, query: $search, sortKey: CREATED_AT) {
      nodes {
        id
        createdAt
        test
        currencyCode
        subtotalPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        netPaymentSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        customerJourneySummary {
          ready
          daysToConversion
          customerOrderIndex
          firstVisit {
            landingPage
            referrerUrl
            source
            sourceType
            utmParameters { source medium campaign content term }
          }
          lastVisit {
            landingPage
            referrerUrl
            source
            sourceType
            utmParameters { source medium campaign content term }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function sanitizeAttributionUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 2_048);
  } catch {
    return null;
  }
}

function sanitizeAttributionText(value: string | null, maxLength = 512) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function sanitizeShopifyVisit(visit: ShopifyCustomerVisit | null) {
  if (!visit) return null;
  return {
    landingPage: sanitizeAttributionUrl(visit.landingPage),
    referrerUrl: sanitizeAttributionUrl(visit.referrerUrl),
    source: sanitizeAttributionText(visit.source) ?? "unknown",
    sourceType: sanitizeAttributionText(visit.sourceType, 80),
    utmParameters: visit.utmParameters
      ? {
          source: sanitizeAttributionText(visit.utmParameters.source),
          medium: sanitizeAttributionText(visit.utmParameters.medium),
          campaign: sanitizeAttributionText(visit.utmParameters.campaign),
          content: sanitizeAttributionText(visit.utmParameters.content),
          term: sanitizeAttributionText(visit.utmParameters.term),
        }
      : null,
  } satisfies ShopifyCustomerVisit;
}

function sanitizeShopifyJourney(journey: ShopifyCustomerJourneySummary | null) {
  if (!journey) return null;
  return {
    ready: journey.ready === true,
    daysToConversion: Number.isInteger(journey.daysToConversion) && Number(journey.daysToConversion) >= 0
      ? journey.daysToConversion
      : null,
    customerOrderIndex: Number.isInteger(journey.customerOrderIndex) && Number(journey.customerOrderIndex) >= 0
      ? journey.customerOrderIndex
      : null,
    firstVisit: sanitizeShopifyVisit(journey.firstVisit),
    lastVisit: sanitizeShopifyVisit(journey.lastVisit),
  } satisfies ShopifyCustomerJourneySummary;
}

const ORDER_LINE_ITEMS_QUERY = `#graphql
  query MoonArqShopifyOrderLineItems($orderId: ID!, $first: Int!, $after: String) {
    order(id: $orderId) {
      id
      lineItems(first: $first, after: $after) {
        nodes {
          id
          name
          quantity
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export async function fetchShopifyShop(
  shopDomain: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  const data = await shopifyGraphql<{ shop?: ShopifyShop }>(shopDomain, accessToken, SHOP_QUERY, {}, fetchImpl);
  const shop = data.shop;
  if (
    !shop ||
    typeof shop.id !== "string" ||
    !shop.id.startsWith("gid://shopify/Shop/") ||
    typeof shop.myshopifyDomain !== "string" ||
    !SHOPIFY_STORE_PATTERN.test(shop.myshopifyDomain) ||
    typeof shop.ianaTimezone !== "string"
  ) {
    throw new ShopifyApiError("Shopify returned an incomplete shop profile.", { code: "invalid_shop_response" });
  }
  // A merchant can rename the public *.myshopify.com URL while Shopify keeps
  // returning the original permanent myshopifyDomain as the stable shop ID.
  // Successful token exchange and GraphQL access on shopDomain already prove
  // that the installed app belongs to the configured store, so both valid
  // aliases must be accepted here.
  return shop;
}

async function fetchShopifyOrders(
  shopDomain: string,
  accessToken: string,
  queryStartAt: string,
  fetchImpl: typeof fetch = fetch,
) {
  const orders: ShopifyOrder[] = [];
  const seenOrderIds = new Set<string>();
  let after: string | null = null;
  let complete = false;
  for (let page = 1; page <= SHOPIFY_MAX_ORDER_PAGES; page += 1) {
    const data: {
      orders?: {
        nodes?: Array<Omit<ShopifyOrder, "lineItems">>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      };
    } = await shopifyGraphql(
      shopDomain,
      accessToken,
      ORDERS_QUERY,
      {
        first: SHOPIFY_ORDER_PAGE_SIZE,
        after,
        search: `created_at:>='${queryStartAt}'`,
      },
      fetchImpl,
    );
    const connection = data.orders;
    if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
      throw new ShopifyApiError("Shopify returned an incomplete orders page.", { code: "invalid_orders_response" });
    }
    for (const order of connection.nodes) {
      if (seenOrderIds.has(order.id)) {
        throw new ShopifyApiError(`Shopify returned duplicate order ${order.id} while paginating.`, {
          code: "duplicate_order",
        });
      }
      seenOrderIds.add(order.id);
      const lineItems = order.test
        ? { nodes: [], pageInfo: { hasNextPage: false } }
        : await fetchShopifyOrderLineItems(shopDomain, accessToken, order.id, fetchImpl);
      orders.push({
        ...order,
        customerJourneySummary: sanitizeShopifyJourney(order.customerJourneySummary),
        lineItems,
      });
    }
    if (!connection.pageInfo.hasNextPage) {
      complete = true;
      break;
    }
    if (!connection.pageInfo.endCursor) {
      throw new ShopifyApiError("Shopify order pagination did not return a continuation cursor.", {
        code: "missing_order_cursor",
      });
    }
    after = connection.pageInfo.endCursor;
  }
  if (!complete) {
    throw new ShopifyApiError(
      `Shopify sync exceeded ${SHOPIFY_MAX_ORDER_PAGES * SHOPIFY_ORDER_PAGE_SIZE} orders in the overlapping lookback window; no partial metrics were stored.`,
      { code: "order_page_limit_exceeded" },
    );
  }
  return orders.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

async function fetchShopifyOrderLineItems(
  shopDomain: string,
  accessToken: string,
  orderId: string,
  fetchImpl: typeof fetch,
): Promise<ShopifyOrder["lineItems"]> {
  const nodes: ShopifyLineItem[] = [];
  const seenLineItemIds = new Set<string>();
  let after: string | null = null;
  let complete = false;
  for (let page = 1; page <= SHOPIFY_MAX_LINE_ITEM_PAGES; page += 1) {
    const data: {
      order?: {
        id?: string;
        lineItems?: {
          nodes?: ShopifyLineItem[];
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      } | null;
    } = await shopifyGraphql(
      shopDomain,
      accessToken,
      ORDER_LINE_ITEMS_QUERY,
      { orderId, first: SHOPIFY_LINE_ITEM_PAGE_SIZE, after },
      fetchImpl,
    );
    if (!data.order || data.order.id !== orderId || !data.order.lineItems) {
      throw new ShopifyApiError(`Shopify could not return line items for order ${orderId}.`, {
        code: "invalid_line_items_response",
      });
    }
    const connection = data.order.lineItems;
    if (!Array.isArray(connection.nodes) || !connection.pageInfo) {
      throw new ShopifyApiError(`Shopify returned an incomplete line-item page for order ${orderId}.`, {
        code: "invalid_line_items_response",
      });
    }
    for (const item of connection.nodes) {
      if (seenLineItemIds.has(item.id)) {
        throw new ShopifyApiError(`Shopify returned duplicate line item ${item.id} for order ${orderId}.`, {
          code: "duplicate_line_item",
        });
      }
      seenLineItemIds.add(item.id);
      nodes.push(item);
    }
    if (!connection.pageInfo.hasNextPage) {
      complete = true;
      break;
    }
    if (!connection.pageInfo.endCursor) {
      throw new ShopifyApiError(`Shopify line-item pagination omitted a cursor for order ${orderId}.`, {
        code: "missing_line_item_cursor",
      });
    }
    after = connection.pageInfo.endCursor;
  }
  if (!complete) {
    throw new ShopifyApiError(
      `Shopify sync exceeded ${SHOPIFY_MAX_LINE_ITEM_PAGES * SHOPIFY_LINE_ITEM_PAGE_SIZE} line items for order ${orderId}; no partial metrics were stored.`,
      { code: "line_item_page_limit_exceeded" },
    );
  }
  return {
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    pageInfo: { hasNextPage: false },
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function dateKeyInTimeZone(date: Date, ianaTimezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function subtractCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function zonedStartOfDayUtc(dateKey: string, ianaTimezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = localMidnightAsUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const representedAsUtc = Date.UTC(
      Number(values.get("year")),
      Number(values.get("month")) - 1,
      Number(values.get("day")),
      Number(values.get("hour")),
      Number(values.get("minute")),
      Number(values.get("second")),
    );
    candidate = localMidnightAsUtc - (representedAsUtc - candidate);
  }
  return new Date(candidate).toISOString();
}

export function hashShopifySnapshot(snapshot: ShopifySyncSnapshot) {
  const canonical = {
    apiVersion: snapshot.apiVersion,
    attributionVersion: snapshot.attributionVersion,
    kind: snapshot.kind,
    lookbackDays: snapshot.lookbackDays,
    orders: snapshot.orders,
    queryStartAt: snapshot.queryStartAt,
    shop: snapshot.shop,
    windowStartDate: snapshot.windowStartDate,
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

export async function fetchShopifySnapshot(
  source: Pick<Source, "normalized_url" | "input_url" | "metadata">,
  credentials: Record<string, string>,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<ShopifySyncSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const store = getShopifyStoreForSource(source);
  const token = await exchangeShopifyClientCredentials(store.shopDomain, credentials, fetchImpl);
  const missingScopes = missingShopifyScopes(token.scopes.join(","));
  if (missingScopes.length > 0) {
    throw new ShopifyApiError(`Shopify app is installed but missing required scope: ${missingScopes.join(", ")}.`, {
      status: 403,
      code: "missing_scopes",
    });
  }
  const shop = await fetchShopifyShop(store.shopDomain, token.accessToken, fetchImpl);
  assertShopifyShopIdentity(source, shop);
  const windowEndDate = dateKeyInTimeZone(now, shop.ianaTimezone);
  const windowStartDate = subtractCalendarDays(windowEndDate, SHOPIFY_ORDER_LOOKBACK_DAYS - 1);
  const queryStartAt = zonedStartOfDayUtc(windowStartDate, shop.ianaTimezone);
  const orders = await fetchShopifyOrders(store.shopDomain, token.accessToken, queryStartAt, fetchImpl);
  return {
    kind: "shopify_orders_snapshot",
    attributionVersion: SHOPIFY_ATTRIBUTION_VERSION,
    fetchedAt: now.toISOString(),
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    lookbackDays: SHOPIFY_ORDER_LOOKBACK_DAYS,
    windowStartDate,
    queryStartAt,
    shop,
    orders,
  };
}

export function isShopifySnapshot(value: unknown): value is ShopifySyncSnapshot {
  return isRecord(value)
    && value.kind === "shopify_orders_snapshot"
    && value.attributionVersion === SHOPIFY_ATTRIBUTION_VERSION
    && typeof value.fetchedAt === "string"
    && typeof value.windowStartDate === "string"
    && typeof value.queryStartAt === "string"
    && isRecord(value.shop)
    && Array.isArray(value.orders);
}
