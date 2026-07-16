import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConnector } from "@/collection/connectors/registry";
import { enqueueSyncRun } from "@/collection/sync/engine";
import {
  fetchShopifySnapshot,
  hashShopifySnapshot,
  normalizeShopifyStoreUrl,
  type ShopifyCustomerJourneySummary,
  type ShopifyCustomerVisit,
  type ShopifyOrder,
  type ShopifySyncSnapshot,
} from "@/collection/connectors/shopify/api";
import type { Source } from "@/storage/db/schema";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { saveCredential } from "@/storage/repositories/credentials-repository";
import { createSource } from "@/storage/repositories/sources-repository";

const CLIENT_ID = "shopify-client-id-for-tests";
const CLIENT_SECRET = "shopify-client-secret-for-tests";
const ACCESS_TOKEN = "shpat_test_access_token_never_persist";
const NOW = new Date("2026-07-14T20:00:00.000Z");

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function money(amount: string, currencyCode = "USD") {
  return { shopMoney: { amount, currencyCode } };
}

function visit(input: Partial<ShopifyCustomerVisit> = {}): ShopifyCustomerVisit {
  return {
    landingPage: "https://www.moonarqstudio.com/collections/bracelets",
    referrerUrl: "https://l.instagram.com/",
    source: "Instagram",
    sourceType: "AD",
    utmParameters: {
      source: "instagram",
      medium: "paid_social",
      campaign: "bracelet_grid_jul2026",
      content: "story_v1",
      term: null,
    },
    ...input,
  };
}

function order(input: Partial<ShopifyOrder> & Pick<ShopifyOrder, "id" | "createdAt">): ShopifyOrder {
  const { id, createdAt, ...overrides } = input;
  return {
    id,
    createdAt,
    test: false,
    currencyCode: "USD",
    subtotalPriceSet: money("90.00"),
    totalDiscountsSet: money("10.00"),
    currentTotalPriceSet: money("85.00"),
    netPaymentSet: money("80.00"),
    totalRefundedSet: money("5.00"),
    customerJourneySummary: null,
    lineItems: {
      nodes: [
        {
          id: `${input.id}-line-1`,
          name: "Moon Bracelet",
          quantity: 2,
          originalUnitPriceSet: money("50.00"),
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    ...overrides,
  };
}

function orderWithoutLineItems(value: ShopifyOrder): Omit<ShopifyOrder, "lineItems"> {
  return {
    id: value.id,
    createdAt: value.createdAt,
    test: value.test,
    currencyCode: value.currencyCode,
    subtotalPriceSet: value.subtotalPriceSet,
    totalDiscountsSet: value.totalDiscountsSet,
    currentTotalPriceSet: value.currentTotalPriceSet,
    netPaymentSet: value.netPaymentSet,
    totalRefundedSet: value.totalRefundedSet,
    customerJourneySummary: value.customerJourneySummary,
  };
}

function shopifySource(patch: Partial<Source> = {}): Source {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "shopify",
    display_name: "MoonArq Shopify",
    input_url: "https://moonarq-store.myshopify.com",
    normalized_url: "https://moonarq-store.myshopify.com",
    external_account_id: "moonarq-store.myshopify.com",
    account_name: "moonarq-store",
    status: "needs_credentials",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: null,
    last_webhook_sync_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    next_sync_at: null,
    metadata: {},
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...patch,
  };
}

type MockOptions = {
  scope?: string;
  shopId?: string;
  shopDomain?: string;
  tokenStatus?: number;
  tokenErrorDescription?: string;
  lineItemPagination?: boolean;
  lineItemMissingCursor?: boolean;
  omitFirstOrder?: boolean;
  firstOrderJourney?: ShopifyCustomerJourneySummary | null;
};

function mockShopifyApi(options: MockOptions = {}) {
  const requests: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = [];
  const firstOrder = order({
    id: "gid://shopify/Order/1",
    createdAt: "2026-07-14T05:30:00.000Z",
    customerJourneySummary: options.firstOrderJourney ?? null,
  });
  const testOrder = order({ id: "gid://shopify/Order/2", createdAt: "2026-07-14T07:00:00.000Z", test: true });
  const secondOrder = order({
    id: "gid://shopify/Order/3",
    createdAt: "2026-07-14T19:00:00.000Z",
    subtotalPriceSet: money("40.00"),
    totalDiscountsSet: money("0.00"),
    currentTotalPriceSet: money("40.00"),
    netPaymentSet: money("40.00"),
    totalRefundedSet: money("0.00"),
    lineItems: {
      nodes: [
        {
          id: "gid://shopify/LineItem/3",
          name: "Orbit Charm",
          quantity: 1,
          originalUnitPriceSet: money("40.00"),
        },
      ],
      pageInfo: { hasNextPage: false },
    },
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    if (url.endsWith("/admin/oauth/access_token")) {
      requests.push({ url, init });
      if (options.tokenStatus && options.tokenStatus !== 200) {
        return jsonResponse({
          error: "invalid_client",
          error_description: options.tokenErrorDescription ?? "Invalid client credentials.",
        }, options.tokenStatus);
      }
      return jsonResponse({
        access_token: ACCESS_TOKEN,
        scope: options.scope ?? "read_orders",
        expires_in: 86_399,
      });
    }
    const parsed = JSON.parse(String(init?.body ?? "{}")) as { query?: string; variables?: Record<string, unknown> };
    requests.push({ url, init, body: parsed as Record<string, unknown> });
    if (parsed.query?.includes("MoonArqShopifyConnection")) {
      return jsonResponse({
        data: {
          shop: {
            id: options.shopId ?? "gid://shopify/Shop/1",
            name: "MoonArq Studio",
            myshopifyDomain: options.shopDomain ?? "moonarq-store.myshopify.com",
            currencyCode: "USD",
            ianaTimezone: "America/Los_Angeles",
          },
        },
      });
    }
    if (parsed.query?.includes("MoonArqShopifyOrderLineItems")) {
      const orderId = String(parsed.variables?.orderId ?? "");
      const after = parsed.variables?.after;
      const sourceOrder = orderId === firstOrder.id ? firstOrder : orderId === secondOrder.id ? secondOrder : null;
      if (!sourceOrder) return jsonResponse({ data: { order: null } });
      if (orderId === firstOrder.id && options.lineItemPagination) {
        if (after === "line-page-2") {
          return jsonResponse({
            data: {
              order: {
                id: orderId,
                lineItems: {
                  nodes: [{
                    id: "gid://shopify/LineItem/1-extra",
                    name: "Moon Charm",
                    quantity: 1,
                    originalUnitPriceSet: money("15.00"),
                  }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          });
        }
        return jsonResponse({
          data: {
            order: {
              id: orderId,
              lineItems: {
                nodes: sourceOrder.lineItems.nodes,
                pageInfo: {
                  hasNextPage: true,
                  endCursor: options.lineItemMissingCursor ? null : "line-page-2",
                },
              },
            },
          },
        });
      }
      if (orderId === firstOrder.id && options.lineItemMissingCursor) {
        return jsonResponse({
          data: {
            order: {
              id: orderId,
              lineItems: {
                nodes: sourceOrder.lineItems.nodes,
                pageInfo: { hasNextPage: true, endCursor: null },
              },
            },
          },
        });
      }
      return jsonResponse({
        data: {
          order: {
            id: orderId,
            lineItems: {
              nodes: sourceOrder.lineItems.nodes,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    }
    const after = parsed.variables?.after;
    const firstOrderCore = orderWithoutLineItems(firstOrder);
    const testOrderCore = orderWithoutLineItems(testOrder);
    const secondOrderCore = orderWithoutLineItems(secondOrder);
    return jsonResponse({
      data: {
        orders: after
          ? { nodes: [secondOrderCore], pageInfo: { hasNextPage: false, endCursor: null } }
          : {
              nodes: options.omitFirstOrder ? [testOrderCore] : [firstOrderCore, testOrderCore],
              pageInfo: { hasNextPage: true, endCursor: "page-2" },
            },
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests };
}

describe("Shopify client-credentials connector", () => {
  beforeEach(() => {
    resetDemoStore();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes only official HTTPS Shopify store URLs", () => {
    expect(normalizeShopifyStoreUrl("https://moonarq-store.myshopify.com/orders")).toEqual({
      storeHandle: "moonarq-store",
      shopDomain: "moonarq-store.myshopify.com",
      normalizedUrl: "https://moonarq-store.myshopify.com",
    });
    expect(normalizeShopifyStoreUrl("https://admin.shopify.com/store/moonarq-store/orders")).toMatchObject({
      shopDomain: "moonarq-store.myshopify.com",
    });
    expect(normalizeShopifyStoreUrl("http://moonarq-store.myshopify.com")).toBeNull();
    expect(normalizeShopifyStoreUrl("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(normalizeShopifyStoreUrl("https://moonarq-store.myshopify.com.attacker.example")).toBeNull();
  });

  it("tests the installed app without exposing the token or client secret", async () => {
    const { requests } = mockShopifyApi();
    const result = await getConnector("shopify").testConnection({
      source: shopifySource(),
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "connected",
      details: {
        shopDomain: "moonarq-store.myshopify.com",
        currency: "USD",
        timezone: "America/Los_Angeles",
        scopes: ["read_orders"],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CLIENT_SECRET);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(requests[0].url).not.toContain(CLIENT_ID);
    expect(requests[0].url).not.toContain(CLIENT_SECRET);
    expect(String(requests[0].init?.body)).toContain("grant_type=client_credentials");
    expect(new Headers(requests[1].init?.headers).get("x-shopify-access-token")).toBe(ACCESS_TOKEN);
  });

  it("accepts a renamed myshopify alias while retaining Shopify's permanent shop domain", async () => {
    const { requests } = mockShopifyApi({ shopDomain: "original-shop-id.myshopify.com" });
    const result = await getConnector("shopify").testConnection({
      source: shopifySource({
        input_url: "https://friendly-shop-name.myshopify.com",
        normalized_url: "https://friendly-shop-name.myshopify.com",
        external_account_id: "friendly-shop-name.myshopify.com",
        account_name: "friendly-shop-name",
        metadata: { shopify_shop_id: "gid://shopify/Shop/1" },
      }),
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "connected",
      details: { shopDomain: "original-shop-id.myshopify.com" },
    });
    expect(requests[0].url).toBe("https://friendly-shop-name.myshopify.com/admin/oauth/access_token");
    expect(requests[1].url).toBe("https://friendly-shop-name.myshopify.com/admin/api/2026-07/graphql.json");
  });

  it("pins the immutable shop ID on first connect and rejects a later cross-store switch", async () => {
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "shopify",
      display_name: "MoonArq Shopify",
      input_url: "https://friendly-shop-name.myshopify.com",
      normalized_url: "https://friendly-shop-name.myshopify.com",
      external_account_id: "friendly-shop-name.myshopify.com",
      account_name: "friendly-shop-name",
      status: "needs_credentials",
      sync_mode: "hourly",
    });
    mockShopifyApi({ shopDomain: "original-shop-id.myshopify.com" });

    const first = await getConnector("shopify").testConnection({
      source,
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
    });
    expect(first).toMatchObject({ ok: true, status: "connected" });
    const pinnedSource = getDemoStore().sources.find((item) => item.id === source.id);
    expect(pinnedSource?.metadata).toMatchObject({
      shopify_shop_id: "gid://shopify/Shop/1",
      shopify_permanent_domain: "original-shop-id.myshopify.com",
      shopify_connected_domain: "friendly-shop-name.myshopify.com",
    });

    vi.unstubAllGlobals();
    const { requests } = mockShopifyApi({
      shopId: "gid://shopify/Shop/2",
      shopDomain: "another-shop.myshopify.com",
    });
    const credentials = { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET };
    const switched = await getConnector("shopify").testConnection({
      source: pinnedSource!,
      credentials,
      isDemoMode: false,
    });
    expect(switched).toMatchObject({
      ok: false,
      status: "error",
      details: { code: "shop_identity_mismatch", sanitized: true },
    });
    await expect(getConnector("shopify").sync({
      source: pinnedSource!,
      credentials,
      isDemoMode: false,
      trigger: "manual",
    })).rejects.toMatchObject({ code: "shop_identity_mismatch" });
    expect(requests.some((request) => String(request.body?.query).includes("MoonArqShopifyOrders"))).toBe(false);
  });

  it("atomically allows only one first-time Shopify identity pin", async () => {
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "shopify",
      display_name: "MoonArq Shopify",
      input_url: "https://friendly-a.myshopify.com",
      normalized_url: "https://friendly-a.myshopify.com",
      external_account_id: "friendly-a.myshopify.com",
      account_name: "friendly-a",
      status: "needs_credentials",
      sync_mode: "hourly",
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      if (url.endsWith("/admin/oauth/access_token")) {
        return jsonResponse({ access_token: ACCESS_TOKEN, scope: "read_orders", expires_in: 86_399 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      if (!body.query?.includes("MoonArqShopifyConnection")) {
        return jsonResponse({ errors: [{ message: "Unexpected query." }] }, 400);
      }
      const hostname = new URL(url).hostname;
      const suffix = hostname.startsWith("friendly-a.") ? "a" : "b";
      return jsonResponse({
        data: {
          shop: {
            id: `gid://shopify/Shop/${suffix === "a" ? "1" : "2"}`,
            name: `MoonArq ${suffix.toUpperCase()}`,
            myshopifyDomain: `original-${suffix}.myshopify.com`,
            currencyCode: "USD",
            ianaTimezone: "America/Los_Angeles",
          },
        },
      });
    }));
    const sourceB: Source = {
      ...source,
      input_url: "https://friendly-b.myshopify.com",
      normalized_url: "https://friendly-b.myshopify.com",
      external_account_id: "friendly-b.myshopify.com",
      account_name: "friendly-b",
    };
    const credentials = { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET };

    const results = await Promise.all([
      getConnector("shopify").testConnection({ source, credentials, isDemoMode: false }),
      getConnector("shopify").testConnection({ source: sourceB, credentials, isDemoMode: false }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["connected", "error"]);
    expect(results.find((result) => !result.ok)).toMatchObject({
      details: { code: "shop_identity_mismatch", sanitized: true },
    });
    const pinned = getDemoStore().sources.find((item) => item.id === source.id);
    const pinnedShopId = String(pinned?.metadata.shopify_shop_id ?? "");
    expect(["gid://shopify/Shop/1", "gid://shopify/Shop/2"]).toContain(pinnedShopId);
    expect(pinned?.metadata.shopify_permanent_domain).toBe(
      pinnedShopId.endsWith("/1") ? "original-a.myshopify.com" : "original-b.myshopify.com",
    );
    expect(JSON.stringify(results)).not.toContain(CLIENT_SECRET);
    expect(JSON.stringify(results)).not.toContain(ACCESS_TOKEN);
  });

  it("syncs a complete paginated window and normalizes store-local, non-test metrics", async () => {
    const { requests } = mockShopifyApi();
    const connector = getConnector("shopify");
    const source = shopifySource();
    const sync = await connector.sync({
      source,
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
      trigger: "manual",
    });
    const normalized = await connector.normalize(sync.rawPayloads, source);

    expect(sync.recordsFetched).toBe(3);
    expect(sync.cursorAfter).toMatchObject({ mode: "overlapping_60_day_snapshot" });
    expect(normalized.metrics.filter((item) => item.metricKey === "orders")).toHaveLength(60);
    expect(normalized.metrics.find((item) => item.metricKey === "orders" && item.date === "2026-07-13")?.metricValue).toBe(1);
    expect(normalized.metrics.find((item) => item.metricKey === "gross_sales" && item.date === "2026-07-13")?.metricValue).toBe(100);
    expect(normalized.metrics.find((item) => item.metricKey === "net_payment" && item.date === "2026-07-13")?.metricValue).toBe(80);
    expect(normalized.metrics.find((item) => item.metricKey === "refunds" && item.date === "2026-07-13")?.metricValue).toBe(5);
    expect(normalized.metrics.find((item) => item.metricKey === "orders" && item.date === "2026-07-14")?.metricValue).toBe(1);
    expect(normalized.metrics.filter((item) => item.metricKey === "top_products")).toHaveLength(2);
    expect(normalized.metrics.find((item) => item.dimensions?.product_name === "Moon Bracelet")?.metricValue).toBe(2);

    const raw = JSON.stringify(sync.rawPayloads);
    for (const forbidden of [
      CLIENT_SECRET,
      ACCESS_TOKEN,
      "email",
      "phone",
      "address",
      "ipAddress",
      "clientIp",
      "paymentGatewayNames",
      "billingAddress",
      "shippingAddress",
    ]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    const orderQueries = requests.filter((request) => typeof request.body?.query === "string" && String(request.body.query).includes("MoonArqShopifyOrders"));
    expect(orderQueries).toHaveLength(2);
    expect(orderQueries[1].body?.variables).toMatchObject({ after: "page-2" });
    expect(orderQueries[0].body?.variables).toMatchObject({ search: "created_at:>='2026-05-16T07:00:00.000Z'" });
    expect(JSON.stringify(orderQueries)).not.toContain("read_all_orders");
    expect(JSON.stringify(orderQueries)).not.toContain("read_customers");
  });

  it("stores privacy-safe first/last journeys and emits exact order-level UTM attribution tuples", async () => {
    const firstVisit = visit({
      source: "Facebook",
      utmParameters: {
        source: "facebook",
        medium: "paid_social",
        campaign: "bracelet_grid_jul2026",
        content: "feed_v1",
        term: "moon bracelet",
      },
    });
    const lastVisit = visit({
      landingPage: "https://www.moonarqstudio.com/collections/bracelets?utm_source=instagram&email=private%40example.com#details",
      referrerUrl: "https://l.instagram.com/?u=encoded-product-url&click_token=secret-click-token",
    });
    const { requests } = mockShopifyApi({
      firstOrderJourney: {
        ready: true,
        daysToConversion: 2,
        customerOrderIndex: 1,
        firstVisit,
        lastVisit,
      },
    });
    const connector = getConnector("shopify");
    const source = shopifySource();
    const sync = await connector.sync({
      source,
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
      trigger: "manual",
    });
    const normalized = await connector.normalize(sync.rawPayloads, source);
    const attributedOrders = normalized.metrics.filter((item) => item.metricKey === "shopify_attributed_orders");
    const attributedGrossSales = normalized.metrics.filter((item) => item.metricKey === "shopify_attributed_gross_sales");
    const attributedDiscounts = normalized.metrics.filter((item) => item.metricKey === "shopify_attributed_discounts");
    const attributedCurrentTotal = normalized.metrics.filter((item) => item.metricKey === "shopify_attributed_current_total");
    const attributedRefunds = normalized.metrics.filter((item) => item.metricKey === "shopify_attributed_refunds");
    const attributedRevenue = normalized.metrics.filter((item) => item.metricKey === "shopify_attributed_net_revenue");

    expect(attributedOrders).toHaveLength(2);
    expect(attributedGrossSales).toHaveLength(2);
    expect(attributedDiscounts).toHaveLength(2);
    expect(attributedCurrentTotal).toHaveLength(2);
    expect(attributedRefunds).toHaveLength(2);
    expect(attributedRevenue).toHaveLength(2);
    expect(attributedOrders.filter((item) => item.dimensions?.attribution_model === "first_visit")).toHaveLength(1);
    expect(attributedOrders.filter((item) => item.dimensions?.attribution_model === "last_visit")).toHaveLength(1);
    expect(attributedOrders.find((item) => item.dimensions?.attribution_model === "last_visit")).toMatchObject({
      date: "2026-07-13",
      metricValue: 1,
      unit: "count",
      dimensions: {
        attribution_ready: true,
        attribution_model: "last_visit",
        utm_source: "instagram",
        utm_medium: "paid_social",
        utm_campaign: "bracelet_grid_jul2026",
        utm_content: "story_v1",
        utm_term: null,
        order_id: "gid://shopify/Order/1",
        currency: "USD",
      },
    });
    expect(attributedRevenue.find((item) => item.dimensions?.attribution_model === "last_visit")).toMatchObject({
      metricValue: 80,
      unit: "usd",
    });
    expect(attributedGrossSales.find((item) => item.dimensions?.attribution_model === "last_visit")).toMatchObject({
      metricValue: 100,
      unit: "usd",
    });
    expect(attributedDiscounts.find((item) => item.dimensions?.attribution_model === "last_visit")).toMatchObject({
      metricValue: 10,
      unit: "usd",
    });
    expect(attributedCurrentTotal.find((item) => item.dimensions?.attribution_model === "last_visit")).toMatchObject({
      metricValue: 85,
      unit: "usd",
    });
    expect(attributedRefunds.find((item) => item.dimensions?.attribution_model === "last_visit")).toMatchObject({
      metricValue: 5,
      unit: "usd",
    });
    expect(normalized.replaceMetricWindow?.metricKeys).toEqual(expect.arrayContaining([
      "shopify_attributed_orders",
      "shopify_attributed_gross_sales",
      "shopify_attributed_discounts",
      "shopify_attributed_current_total",
      "shopify_attributed_refunds",
      "shopify_attributed_net_revenue",
    ]));

    const snapshot = sync.rawPayloads[0].payload as unknown as ShopifySyncSnapshot;
    expect(snapshot.attributionVersion).toBe("customer-journey-v1");
    const journey = snapshot.orders.find((item) => item.id === "gid://shopify/Order/1")?.customerJourneySummary;
    expect(journey).toMatchObject({
      ready: true,
      daysToConversion: 2,
      customerOrderIndex: 1,
      lastVisit: {
        landingPage: "https://www.moonarqstudio.com/collections/bracelets",
        referrerUrl: "https://l.instagram.com/",
      },
    });
    expect(JSON.stringify(journey)).not.toContain("private@example.com");
    expect(JSON.stringify(journey)).not.toContain("secret-click-token");

    const orderQuery = requests.find((request) => String(request.body?.query).includes("MoonArqShopifyOrders"));
    expect(String(orderQuery?.body?.query)).toContain("customerJourneySummary");
    for (const selectedField of [
      "ready",
      "daysToConversion",
      "customerOrderIndex",
      "firstVisit",
      "lastVisit",
      "landingPage",
      "referrerUrl",
      "sourceType",
      "utmParameters",
    ]) {
      expect(String(orderQuery?.body?.query)).toContain(selectedField);
    }
    expect(String(orderQuery?.body?.query)).not.toMatch(/\b(email|phone|clientIp|billingAddress|shippingAddress)\b/u);
  });

  it("keeps null and not-ready journeys in raw data without inventing attribution metrics", async () => {
    mockShopifyApi({
      firstOrderJourney: {
        ready: false,
        daysToConversion: null,
        customerOrderIndex: null,
        firstVisit: null,
        lastVisit: null,
      },
    });
    const connector = getConnector("shopify");
    const source = shopifySource();
    const sync = await connector.sync({
      source,
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
      trigger: "manual",
    });
    const normalized = await connector.normalize(sync.rawPayloads, source);

    expect(normalized.metrics.some((item) => item.metricKey.startsWith("shopify_attributed_"))).toBe(false);
    const snapshot = sync.rawPayloads[0].payload as unknown as ShopifySyncSnapshot;
    expect(snapshot.orders.find((item) => item.id === "gid://shopify/Order/1")?.customerJourneySummary).toEqual({
      ready: false,
      daysToConversion: null,
      customerOrderIndex: null,
      firstVisit: null,
      lastVisit: null,
    });
    expect(snapshot.orders.find((item) => item.id === "gid://shopify/Order/3")?.customerJourneySummary).toBeNull();
  });

  it("keeps an unchanged same-day replay idempotent in raw storage and daily metrics", async () => {
    mockShopifyApi();
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "shopify",
      display_name: "MoonArq Shopify",
      input_url: "https://moonarq-store.myshopify.com",
      normalized_url: "https://moonarq-store.myshopify.com",
      external_account_id: "moonarq-store.myshopify.com",
      account_name: "moonarq-store",
      status: "needs_credentials",
      sync_mode: "hourly",
    });
    await saveCredential(source.id, "shopify_client_id", CLIENT_ID);
    await saveCredential(source.id, "shopify_client_secret", CLIENT_SECRET);

    const first = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    const sourceMetricsAfterFirst = getDemoStore().metricsDaily.filter((item) => item.source_id === source.id).length;
    const second = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    expect(getDemoStore().rawIngestions.filter((item) => item.source_id === source.id)).toHaveLength(1);
    expect(getDemoStore().metricsDaily.filter((item) => item.source_id === source.id)).toHaveLength(sourceMetricsAfterFirst);
    expect(second.records_inserted).toBe(0);
  });

  it("keeps Shopify queries cost-bounded and paginates every order's line items", async () => {
    const { requests } = mockShopifyApi({ lineItemPagination: true });
    const source = shopifySource();
    const sync = await getConnector("shopify").sync({
      source,
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
      trigger: "manual",
    });
    const normalized = await getConnector("shopify").normalize(sync.rawPayloads, source);

    expect(normalized.metrics.filter((item) => item.metricKey === "top_products")).toHaveLength(3);
    const orderRequests = requests.filter((request) => String(request.body?.query).includes("MoonArqShopifyOrders"));
    const lineItemRequests = requests.filter((request) => String(request.body?.query).includes("MoonArqShopifyOrderLineItems"));
    expect(orderRequests).toHaveLength(2);
    expect(orderRequests[0].body?.variables).toMatchObject({ first: 25 });
    expect(String(orderRequests[0].body?.query)).not.toContain("lineItems(");
    expect(lineItemRequests.filter((request) => (
      (request.body?.variables as Record<string, unknown> | undefined)?.orderId === "gid://shopify/Order/1"
    ))).toHaveLength(2);
    expect(lineItemRequests.every((request) => (
      (request.body?.variables as Record<string, unknown> | undefined)?.first === 100
    ))).toBe(true);
    expect(new Headers(lineItemRequests[0].init?.headers).get("Shopify-GraphQL-Cost-Debug")).toBe("1");
  });

  it("replaces the authoritative window so removed Shopify order lines cannot remain stale", async () => {
    mockShopifyApi();
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "shopify",
      display_name: "MoonArq Shopify",
      input_url: "https://moonarq-store.myshopify.com",
      normalized_url: "https://moonarq-store.myshopify.com",
      external_account_id: "moonarq-store.myshopify.com",
      account_name: "moonarq-store",
      status: "needs_credentials",
      sync_mode: "hourly",
    });
    await saveCredential(source.id, "shopify_client_id", CLIENT_ID);
    await saveCredential(source.id, "shopify_client_secret", CLIENT_SECRET);

    const first = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    const unrelatedMetricCount = getDemoStore().metricsDaily.filter((item) => item.source_id !== source.id).length;
    expect(first.status).toBe("success");
    expect(getDemoStore().metricsDaily.some((item) => (
      item.source_id === source.id &&
      item.metric_key === "top_products" &&
      item.dimensions.product_name === "Moon Bracelet"
    ))).toBe(true);

    vi.unstubAllGlobals();
    mockShopifyApi({ omitFirstOrder: true });
    const second = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });

    expect(second.status).toBe("success");
    const productRows = getDemoStore().metricsDaily.filter((item) => (
      item.source_id === source.id && item.metric_key === "top_products"
    ));
    expect(productRows.map((item) => item.dimensions.product_name)).toEqual(["Orbit Charm"]);
    expect(getDemoStore().metricsDaily.filter((item) => item.source_id !== source.id)).toHaveLength(unrelatedMetricCount);
  });

  it("uses a canonical content hash that ignores fetch time", () => {
    const snapshot: ShopifySyncSnapshot = {
      kind: "shopify_orders_snapshot",
      attributionVersion: "customer-journey-v1",
      fetchedAt: NOW.toISOString(),
      apiVersion: "2026-07",
      lookbackDays: 60,
      windowStartDate: "2026-05-16",
      queryStartAt: "2026-05-16T07:00:00.000Z",
      shop: {
        id: "gid://shopify/Shop/1",
        name: "MoonArq Studio",
        myshopifyDomain: "moonarq-store.myshopify.com",
        currencyCode: "USD",
        ianaTimezone: "America/Los_Angeles",
      },
      orders: [order({ id: "gid://shopify/Order/1", createdAt: NOW.toISOString() })],
    };
    expect(hashShopifySnapshot(snapshot)).toBe(hashShopifySnapshot({ ...snapshot, fetchedAt: "2026-07-14T20:05:00.000Z" }));
  });

  it("computes the 60-day window by store-local calendar dates across daylight saving time", async () => {
    const { requests } = mockShopifyApi();
    const snapshot = await fetchShopifySnapshot(
      shopifySource(),
      { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      { now: new Date("2026-03-09T07:30:00.000Z") },
    );

    expect(snapshot.windowStartDate).toBe("2026-01-09");
    expect(snapshot.queryStartAt).toBe("2026-01-09T08:00:00.000Z");
    const orderRequest = requests.find((request) => String(request.body?.query).includes("MoonArqShopifyOrders"));
    expect(orderRequest?.body?.variables).toMatchObject({ search: "created_at:>='2026-01-09T08:00:00.000Z'" });
  });

  it("rejects missing scopes, unsafe partial pagination, and secret-bearing API errors", async () => {
    mockShopifyApi({ scope: "read_products" });
    const missingScope = await getConnector("shopify").testConnection({
      source: shopifySource(),
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
    });
    expect(missingScope).toMatchObject({ ok: false, status: "unsupported" });
    expect(missingScope.message).toContain("read_orders");

    vi.unstubAllGlobals();
    mockShopifyApi({ lineItemMissingCursor: true });
    await expect(getConnector("shopify").sync({
      source: shopifySource(),
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
      trigger: "manual",
    })).rejects.toThrow("omitted a cursor");

    vi.unstubAllGlobals();
    mockShopifyApi({ tokenStatus: 401, tokenErrorDescription: `Invalid client_secret=${CLIENT_SECRET}` });
    const failed = await getConnector("shopify").testConnection({
      source: shopifySource(),
      credentials: { shopify_client_id: CLIENT_ID, shopify_client_secret: CLIENT_SECRET },
      isDemoMode: false,
    });
    expect(failed.ok).toBe(false);
    expect(failed.message).not.toContain(CLIENT_SECRET);
  });
});
