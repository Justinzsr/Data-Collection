import type {
  CommerceOrderFactInput,
  ConnectionTestResult,
  ConnectorDefinition,
  NormalizedMetric,
  RawPayload,
} from "@/collection/connectors/types";
import {
  assertShopifyShopIdentity,
  exchangeShopifyClientCredentials,
  fetchShopifyShop,
  fetchShopifySnapshot,
  getPinnedShopifyShopId,
  getShopifyStoreForSource,
  hashShopifySnapshot,
  isShopifySnapshot,
  missingShopifyScopes,
  normalizeShopifyStoreUrl,
  SHOPIFY_ORDER_LOOKBACK_DAYS,
  SHOPIFY_REQUIRED_SCOPES,
  SHOPIFY_SHOP_ID_METADATA_KEY,
  ShopifyApiError,
  type ShopifyMoneyBag,
  type ShopifyOrder,
  type ShopifyCustomerVisit,
  type ShopifySyncSnapshot,
} from "@/collection/connectors/shopify/api";
import { metricDefinitions } from "@/aggregation/metric-definitions/definitions";
import type { JsonRecord, Source } from "@/storage/db/schema";
import { pinSourceMetadataValue } from "@/storage/repositories/sources-repository";
import { isShopifyCommerceFactsV2Enabled } from "@/storage/runtime/commerce-feature-flags";

type DailySummary = {
  orders: number;
  grossSales: number;
  currentTotal: number;
  netPayment: number;
  refunds: number;
};

const SHOPIFY_WINDOW_METRIC_KEYS = [
  "orders",
  "gross_sales",
  "current_total",
  "net_payment",
  "refunds",
  "top_products",
  "shopify_attributed_orders",
  "shopify_attributed_gross_sales",
  "shopify_attributed_discounts",
  "shopify_attributed_current_total",
  "shopify_attributed_refunds",
  "shopify_attributed_net_revenue",
] as const;

function roundMetric(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function moneyAmount(bag: ShopifyMoneyBag | null, expectedCurrency: string, label: string) {
  if (!bag) return null;
  const currency = bag.shopMoney?.currencyCode;
  if (currency !== expectedCurrency) {
    throw new Error(`${label} used ${currency || "an unknown currency"}; expected the shop currency ${expectedCurrency}. Mixed currencies are not summed.`);
  }
  const amount = bag.shopMoney?.amount;
  if (typeof amount !== "string") throw new Error(`${label} returned an invalid money amount.`);
  return amount;
}

function moneyValue(bag: ShopifyMoneyBag | null, expectedCurrency: string, label: string) {
  const rawAmount = moneyAmount(bag, expectedCurrency, label);
  if (rawAmount === null) return null;
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount)) throw new Error(`${label} returned an invalid money amount.`);
  return amount;
}

function normalizeMoneyDecimal(amount: string, label: string) {
  if (!/^\d+(?:\.\d+)?$/u.test(amount)) {
    throw new Error(`${label} returned an invalid money amount.`);
  }
  const [integer, fraction = ""] = amount.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/u, "");
  const normalizedFraction = fraction.replace(/0+$/u, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function requiredMoneyDecimal(bag: ShopifyMoneyBag | null, expectedCurrency: string, label: string) {
  const amount = moneyAmount(bag, expectedCurrency, label);
  if (amount === null) throw new Error(`${label} was missing; commerce facts were not replaced.`);
  return normalizeMoneyDecimal(amount, label);
}

function decimalParts(amount: string) {
  const [integer, fraction = ""] = amount.split(".");
  return {
    units: BigInt(`${integer}${fraction}`),
    scale: fraction.length,
  };
}

function decimalFromParts(units: bigint, scale: number) {
  if (scale === 0) return units.toString();
  const digits = units.toString().padStart(scale + 1, "0");
  return normalizeMoneyDecimal(
    `${digits.slice(0, -scale)}.${digits.slice(-scale)}`,
    "Shopify calculated money",
  );
}

function addMoneyDecimals(left: string, right: string) {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftUnits = leftParts.units * (BigInt(10) ** BigInt(scale - leftParts.scale));
  const rightUnits = rightParts.units * (BigInt(10) ** BigInt(scale - rightParts.scale));
  return decimalFromParts(leftUnits + rightUnits, scale);
}

function multiplyMoneyDecimal(amount: string, quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Shopify line-item quantity was invalid.");
  }
  const parts = decimalParts(amount);
  return decimalFromParts(parts.units * BigInt(quantity), parts.scale);
}

function grossSales(order: ShopifyOrder, expectedCurrency: string) {
  const subtotal = moneyValue(order.subtotalPriceSet, expectedCurrency, `Order ${order.id} subtotal`);
  const discounts = moneyValue(order.totalDiscountsSet, expectedCurrency, `Order ${order.id} discounts`) ?? 0;
  if (subtotal !== null) return subtotal + discounts;
  return order.lineItems.nodes.reduce((sum, item) => {
    const unitPrice = moneyValue(item.originalUnitPriceSet, expectedCurrency, `Line item ${item.id} original price`);
    if (unitPrice === null) throw new Error(`Line item ${item.id} did not include an original price.`);
    return sum + unitPrice * item.quantity;
  }, 0);
}

function commerceFactGrossSales(order: ShopifyOrder, expectedCurrency: string) {
  const subtotalAmount = moneyAmount(order.subtotalPriceSet, expectedCurrency, "Shopify order subtotal");
  const discountAmount = moneyAmount(order.totalDiscountsSet, expectedCurrency, "Shopify order discounts");
  if (subtotalAmount !== null && discountAmount !== null) {
    return addMoneyDecimals(
      normalizeMoneyDecimal(subtotalAmount, "Shopify order subtotal"),
      normalizeMoneyDecimal(discountAmount, "Shopify order discounts"),
    );
  }
  if (order.lineItems.nodes.length === 0) {
    throw new Error("Shopify order gross sales could not be reconstructed from an empty line-item set.");
  }
  return order.lineItems.nodes.reduce((sum, item) => (
    addMoneyDecimals(
      sum,
      multiplyMoneyDecimal(
        requiredMoneyDecimal(
          item.originalUnitPriceSet,
          expectedCurrency,
          "Shopify line-item original price",
        ),
        item.quantity,
      ),
    )
  ), "0");
}

function hasUtmAttribution(visit: ShopifyCustomerVisit) {
  const utm = visit.utmParameters;
  return utm !== null && [utm.source, utm.medium, utm.campaign, utm.content, utm.term].some(Boolean);
}

function attributionDimensions(
  snapshot: ShopifySyncSnapshot,
  order: ShopifyOrder,
  visit: ShopifyCustomerVisit,
  attributionModel: "first_visit" | "last_visit",
): JsonRecord {
  const journey = order.customerJourneySummary;
  const utm = visit.utmParameters;
  return {
    rollup: "order_utm_attribution",
    attribution_ready: journey?.ready === true,
    attribution_model: attributionModel,
    utm_source: utm?.source ?? null,
    utm_medium: utm?.medium ?? null,
    utm_campaign: utm?.campaign ?? null,
    utm_content: utm?.content ?? null,
    utm_term: utm?.term ?? null,
    order_id: order.id,
    currency: snapshot.shop.currencyCode,
    store: snapshot.shop.myshopifyDomain,
    timezone: snapshot.shop.ianaTimezone,
    visit_source: visit.source,
    visit_source_type: visit.sourceType,
    landing_page: visit.landingPage,
    referrer_url: visit.referrerUrl,
    days_to_conversion: journey?.daysToConversion ?? null,
    customer_order_index: journey?.customerOrderIndex ?? null,
    definition_version: "shopify-order-utm-v1",
  };
}

export function shopifyDateKey(value: string, ianaTimezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Shopify returned an invalid timestamp: ${value}`);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    throw new Error(`Shopify returned an invalid IANA time zone: ${ianaTimezone}`);
  }
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) throw new Error("Could not calculate the Shopify store-local date.");
  return `${year}-${month}-${day}`;
}

function enumerateDateKeys(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const dates: string[] = [];
  while (start <= end) {
    dates.push(start.toISOString().slice(0, 10));
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return dates;
}

function emptySummary(): DailySummary {
  return { orders: 0, grossSales: 0, currentTotal: 0, netPayment: 0, refunds: 0 };
}

function metric(
  date: string,
  source: Source,
  metricKey: string,
  metricValue: number,
  unit: string,
  dimensions: JsonRecord,
): NormalizedMetric {
  return {
    date,
    sourceId: source.id,
    sourceTypeKey: "shopify",
    metricKey,
    metricValue: roundMetric(metricValue),
    unit,
    dimensions,
  };
}

function normalizeSnapshot(snapshot: ShopifySyncSnapshot, source: Source) {
  const currency = snapshot.shop.currencyCode;
  const unit = currency.toLowerCase();
  const startDate = snapshot.windowStartDate;
  const endDate = shopifyDateKey(snapshot.fetchedAt, snapshot.shop.ianaTimezone);
  const summaries = new Map(enumerateDateKeys(startDate, endDate).map((date) => [date, emptySummary()]));
  const productMetrics: NormalizedMetric[] = [];
  const attributionMetrics: NormalizedMetric[] = [];

  for (const order of snapshot.orders) {
    if (order.test) continue;
    if (order.currencyCode !== currency) {
      throw new Error(`Order ${order.id} used ${order.currencyCode}; expected shop currency ${currency}. Mixed currencies are not summed.`);
    }
    const date = shopifyDateKey(order.createdAt, snapshot.shop.ianaTimezone);
    const summary = summaries.get(date) ?? emptySummary();
    summary.orders += 1;
    summary.grossSales += grossSales(order, currency);
    summary.currentTotal += moneyValue(order.currentTotalPriceSet, currency, `Order ${order.id} current total`) ?? 0;
    summary.netPayment += moneyValue(order.netPaymentSet, currency, `Order ${order.id} net payment`) ?? 0;
    summary.refunds += moneyValue(order.totalRefundedSet, currency, `Order ${order.id} refunds`) ?? 0;
    summaries.set(date, summary);

    if (order.customerJourneySummary?.ready === true) {
      const attributedVisits = [
        ["first_visit", order.customerJourneySummary.firstVisit],
        ["last_visit", order.customerJourneySummary.lastVisit],
      ] as const;
      for (const [attributionModel, visit] of attributedVisits) {
        if (!visit || !hasUtmAttribution(visit)) continue;
        const dimensions = attributionDimensions(snapshot, order, visit, attributionModel);
        attributionMetrics.push(
          metric(date, source, "shopify_attributed_orders", 1, "count", dimensions),
          metric(
            date,
            source,
            "shopify_attributed_gross_sales",
            grossSales(order, currency),
            unit,
            dimensions,
          ),
          metric(
            date,
            source,
            "shopify_attributed_discounts",
            moneyValue(order.totalDiscountsSet, currency, `Order ${order.id} attributed discounts`) ?? 0,
            unit,
            dimensions,
          ),
          metric(
            date,
            source,
            "shopify_attributed_current_total",
            moneyValue(order.currentTotalPriceSet, currency, `Order ${order.id} attributed current total`) ?? 0,
            unit,
            dimensions,
          ),
          metric(
            date,
            source,
            "shopify_attributed_refunds",
            moneyValue(order.totalRefundedSet, currency, `Order ${order.id} attributed refunds`) ?? 0,
            unit,
            dimensions,
          ),
          metric(
            date,
            source,
            "shopify_attributed_net_revenue",
            moneyValue(order.netPaymentSet, currency, `Order ${order.id} attributed net payment`) ?? 0,
            unit,
            dimensions,
          ),
        );
      }
    }

    for (const item of order.lineItems.nodes) {
      if (!Number.isInteger(item.quantity) || item.quantity < 0) {
        throw new Error(`Line item ${item.id} returned an invalid quantity.`);
      }
      productMetrics.push(metric(date, source, "top_products", item.quantity, "units", {
        rollup: "order_line_units",
        store: snapshot.shop.myshopifyDomain,
        order_id: order.id,
        line_item_id: item.id,
        product_name: item.name.slice(0, 240),
      }));
    }
  }

  const dailyMetrics = [...summaries.entries()].flatMap(([date, summary]) => {
    const dimensions: JsonRecord = {
      rollup: "daily_order_summary",
      store: snapshot.shop.myshopifyDomain,
      currency,
      timezone: snapshot.shop.ianaTimezone,
      definition_version: "orders-v1",
    };
    return [
      metric(date, source, "orders", summary.orders, "count", dimensions),
      metric(date, source, "gross_sales", summary.grossSales, unit, dimensions),
      metric(date, source, "current_total", summary.currentTotal, unit, dimensions),
      metric(date, source, "net_payment", summary.netPayment, unit, dimensions),
      metric(date, source, "refunds", summary.refunds, unit, dimensions),
    ];
  });
  return [...dailyMetrics, ...productMetrics, ...attributionMetrics];
}

function commerceOrderFacts(snapshot: ShopifySyncSnapshot): CommerceOrderFactInput[] {
  const currency = snapshot.shop.currencyCode;
  return snapshot.orders.map((order) => {
    if (order.currencyCode !== currency) {
      throw new Error(`A Shopify order used a different currency than the connected shop. Mixed currencies are not stored.`);
    }
    return {
      shopifyOrderId: order.id,
      occurredAt: order.createdAt,
      test: order.test,
      cancelledAt: order.cancelledAt,
      currencyCode: currency,
      grossSales: commerceFactGrossSales(order, currency),
      currentTotal: requiredMoneyDecimal(order.currentTotalPriceSet, currency, "Shopify order current total"),
      netPayment: requiredMoneyDecimal(order.netPaymentSet, currency, "Shopify order net payment"),
      totalRefunded: requiredMoneyDecimal(order.totalRefundedSet, currency, "Shopify order refunds"),
      checkoutEventIdHash: order.checkoutEventIdHash,
      checkoutBridgeState: order.checkoutBridgeState,
      lines: order.lineItems.nodes.map((line) => ({
        shopifyLineItemId: line.id,
        quantity: line.quantity,
        itemInstanceIdHash: line.itemInstanceIdHash,
        itemBridgeState: line.itemBridgeState,
      })),
    };
  });
}

function connectionError(error: unknown): ConnectionTestResult {
  if (error instanceof ShopifyApiError && error.code === "shop_not_permitted") {
    return {
      ok: false,
      status: "unsupported",
      message: "Shopify rejected this store because the app and store are not in the same Shopify organization. Use an app owned by this store's organization.",
      details: { code: error.code },
    };
  }
  return {
    ok: false,
    status: error instanceof ShopifyApiError && error.code === "missing_scopes" ? "unsupported" : "error",
    message: error instanceof Error ? error.message : "Shopify connection test failed.",
    details: { code: error instanceof ShopifyApiError ? error.code ?? null : null, sanitized: true },
  };
}

async function pinShopifyIdentity(
  source: Source,
  shop: Pick<ShopifySyncSnapshot["shop"], "id" | "myshopifyDomain">,
  configuredShopDomain: string,
) {
  if (getPinnedShopifyShopId(source)) return;
  const result = await pinSourceMetadataValue(
    source.id,
    SHOPIFY_SHOP_ID_METADATA_KEY,
    shop.id,
    {
      shopify_permanent_domain: shop.myshopifyDomain,
      shopify_connected_domain: configuredShopDomain,
    },
    { dataSpaceId: source.data_space_id },
  );
  if (result.status === "conflict") {
    throw new ShopifyApiError(
      "The Shopify app resolved to a different store than this source's pinned Shopify identity. Create a new source to connect another store.",
      { status: 409, code: "shop_identity_mismatch" },
    );
  }
}

export const shopifyConnector: ConnectorDefinition = {
  key: "shopify",
  displayName: "Shopify",
  description: "Official Shopify Admin GraphQL API connector for store-local orders and sales, without collecting customer contact data.",
  category: "Commerce",
  icon: "ShoppingBag",
  availability: "live",
  setupKind: "credentials",
  defaultSyncMode: "hourly",
  urlPatterns: [/^https:\/\/[a-z0-9-]+\.myshopify\.com\/?$/i, /^https:\/\/admin\.shopify\.com\/store\/[a-z0-9-]+/i],
  authType: "shopify_client_credentials",
  docsUrl: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant",
  requiredFields: [
    {
      key: "shopify_client_id",
      label: "Shopify Client ID",
      description: "From the installed app's Settings page in Shopify Dev Dashboard. Stored encrypted server-side.",
      required: true,
      secret: true,
      type: "password",
      placeholder: "Paste the Client ID",
    },
    {
      key: "shopify_client_secret",
      label: "Shopify Client secret",
      description: "Used only server-side to request a short-lived Admin API token. Never stored in frontend code or raw analytics payloads.",
      required: true,
      secret: true,
      type: "password",
      placeholder: "Paste the Client secret",
    },
  ],
  optionalFields: [],
  capabilities: {
    supportsWebhook: false,
    supportsPolling: true,
    supportsManualSync: true,
    recommendedSyncFrequencyMinutes: 60,
    canBackfill: true,
    canTestConnection: true,
  },
  detect(inputUrl) {
    const store = normalizeShopifyStoreUrl(inputUrl);
    if (!store) return null;
    return {
      sourceTypeKey: "shopify",
      displayName: "Shopify",
      availability: "live",
      setupKind: "credentials",
      confidence: 0.99,
      normalizedUrl: store.normalizedUrl,
      externalAccountId: store.shopDomain,
      accountName: store.storeHandle,
      reasons: ["Official Shopify store URL detected and normalized to its canonical myshopify.com domain."],
      requiredSetup: this.getSetupInstructions(),
      possibleMetrics: this.getMetricDefinitions().map((definition) => definition.key),
      demoAvailable: false,
    };
  },
  async testConnection(ctx) {
    if (!ctx.credentials.shopify_client_id?.trim() || !ctx.credentials.shopify_client_secret?.trim()) {
      return {
        ok: false,
        status: "needs_credentials",
        message: "Save the Shopify Client ID and Client secret before testing the connection.",
        details: { required: ["shopify_client_id", "shopify_client_secret"] },
      };
    }
    try {
      const store = getShopifyStoreForSource(ctx.source);
      const token = await exchangeShopifyClientCredentials(store.shopDomain, ctx.credentials);
      const missingScopes = missingShopifyScopes(token.scopes.join(","));
      if (missingScopes.length > 0) {
        return {
          ok: false,
          status: "unsupported",
          message: `Shopify app is installed but missing required scope: ${missingScopes.join(", ")}. Release a version with read_orders and update the installation.`,
          details: { missingScopes, requiredScopes: [...SHOPIFY_REQUIRED_SCOPES] },
        };
      }
      const shop = await fetchShopifyShop(store.shopDomain, token.accessToken);
      assertShopifyShopIdentity(ctx.source, shop);
      await pinShopifyIdentity(ctx.source, shop, store.shopDomain);
      return {
        ok: true,
        status: "connected",
        message: `Shopify Admin API connected for ${shop.name}.`,
        details: {
          shopDomain: shop.myshopifyDomain,
          shopName: shop.name,
          currency: shop.currencyCode,
          timezone: shop.ianaTimezone,
          scopes: token.scopes,
          tokenLifetimeSeconds: token.expiresIn,
        },
      };
    } catch (error) {
      return connectionError(error);
    }
  },
  async sync(ctx) {
    const snapshot = await fetchShopifySnapshot(ctx.source, ctx.credentials);
    await pinShopifyIdentity(ctx.source, snapshot.shop, getShopifyStoreForSource(ctx.source).shopDomain);
    const commerceFacts = isShopifyCommerceFactsV2Enabled()
      ? {
          commerceOrderFacts: commerceOrderFacts(snapshot),
          replaceCommerceOrderWindow: {
            startAt: snapshot.queryStartAt,
            endAt: snapshot.fetchedAt,
          },
        }
      : {};
    return {
      rawPayloads: [
        {
          externalId: `shopify:${snapshot.shop.myshopifyDomain}:${snapshot.queryStartAt.slice(0, 10)}`,
          fetchedAt: snapshot.fetchedAt,
          payload: snapshot as unknown as JsonRecord,
          payloadHash: hashShopifySnapshot(snapshot),
          cursor: {
            fetchedAt: snapshot.fetchedAt,
            queryStartAt: snapshot.queryStartAt,
            orderCount: snapshot.orders.length,
            mode: "overlapping_60_day_snapshot",
          },
        },
      ],
      cursorAfter: {
        fetchedAt: snapshot.fetchedAt,
        queryStartAt: snapshot.queryStartAt,
        mode: "overlapping_60_day_snapshot",
      },
      ...commerceFacts,
      recordsFetched: snapshot.orders.length,
      message: `Synced ${snapshot.orders.length} Shopify order record(s) from the latest ${SHOPIFY_ORDER_LOOKBACK_DAYS}-day window without customer contact fields.`,
    };
  },
  async normalize(rawPayloads: RawPayload[], source: Source) {
    const snapshots = rawPayloads
      .map((payload) => payload.payload)
      .filter(isShopifySnapshot)
      .sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt));
    const latest = snapshots.at(-1);
    if (!latest) return { metrics: [] };
    return {
      metrics: normalizeSnapshot(latest, source),
      replaceMetricWindow: {
        metricKeys: [...SHOPIFY_WINDOW_METRIC_KEYS],
        startDate: latest.windowStartDate,
        endDate: shopifyDateKey(latest.fetchedAt, latest.shop.ianaTimezone),
      },
    };
  },
  getMetricDefinitions() {
    return metricDefinitions.filter((definition) => definition.source_type_key === "shopify");
  },
  getSetupInstructions() {
    return [
      "In Shopify Dev Dashboard, create an app owned by the same organization as this store.",
      "Create and release an app version with only the read_orders Admin API scope, then install it on this store.",
      "Copy the Client ID and Client secret from the app Settings page into MoonArq; both values stay encrypted server-side.",
      `MoonArq exchanges those credentials for a short-lived token on each run and recomputes an overlapping ${SHOPIFY_ORDER_LOOKBACK_DAYS}-day window idempotently.`,
      "The connector requests order totals and line-item names/quantities only. It does not request customer names, email, phone, address, IP, notes, or payment details.",
      "Gross sales means order subtotal plus pre-return discounts; current total is after edits/returns; net payment is received minus refunded; refunds are grouped by the order's store-local creation date.",
    ];
  },
};
