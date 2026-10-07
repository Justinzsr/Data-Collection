// @vitest-environment node
// The connector calls Etsy with Node's fetch, Request, and Headers, which jsdom replaces.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchEtsyReceipts } from "@/collection/connectors/etsy/api";
import { detectEtsy } from "@/collection/connectors/etsy/detect";
import { etsySyncStartDate } from "@/collection/connectors/etsy/sync-window";
import { ETSY_RECONNECT_MESSAGE } from "@/collection/connectors/etsy/errors";
import {
  aggregateEtsySnapshot,
  hashEtsySnapshot,
  minimizeEtsyReceipt,
  type EtsySyncSnapshot,
} from "@/collection/connectors/etsy/receipts";
import { getConnector, getInitialSourceStatus } from "@/collection/connectors/registry";
import { enqueueSyncRun } from "@/collection/sync/engine";
import { isAuthorizationError } from "@/aggregation/services/platform-overview-service";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { Source } from "@/storage/db/schema";
import { getDecryptedCredentialMap, saveCredential } from "@/storage/repositories/credentials-repository";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { createSource, getSource } from "@/storage/repositories/sources-repository";
import { addDaysToDateKey, dateKeyInAppTimeZone } from "@/storage/runtime/app-time";

const KEYSTRING = "testkeystring0123456789abc";
const SHARED_SECRET = "testsharedsecret9876";
const ACCESS_TOKEN = "12345678.test-access-token-value-0123456789";
const REFRESH_TOKEN = "12345678.test-refresh-token-value-9876543210";
const SHOP_ID = "98765432";
const DAY_MS = 86_400_000;

const BUYER = {
  name: "Avery Buyer",
  buyer_email: "avery.buyer@example.com",
  first_line: "12 Private Lane",
  city: "Hidden Town",
  zip: "99999",
  formatted_address: "Avery Buyer, 12 Private Lane, Hidden Town",
  message_from_buyer: "Please wrap it nicely",
  gift_message: "Happy birthday, Sam",
};
const PRIVATE_TEXT = [...Object.values(BUYER), "Moon phase necklace", "Hand-made silver moon"];

function money(amount: number, currency = "USD") {
  return { amount: Math.round(amount * 100), divisor: 100, currency_code: currency };
}

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

type ReceiptInput = {
  id: number;
  createdAt: Date;
  updatedAt?: Date;
  status?: string;
  isPaid?: boolean;
  subtotal?: number;
  quantities?: number[];
  refunds?: Array<{ amount: number; at: Date }>;
  currency?: string;
};

/** A receipt shaped like Etsy's getShopReceipts results, private fields included. */
function receipt(input: ReceiptInput) {
  const currency = input.currency ?? "USD";
  return {
    receipt_id: input.id,
    receipt_type: 0,
    seller_user_id: 12345678,
    buyer_user_id: 555,
    ...BUYER,
    status: input.status ?? "paid",
    is_paid: input.isPaid ?? true,
    is_shipped: false,
    create_timestamp: seconds(input.createdAt),
    created_timestamp: seconds(input.createdAt),
    update_timestamp: seconds(input.updatedAt ?? input.createdAt),
    updated_timestamp: seconds(input.updatedAt ?? input.createdAt),
    subtotal: money(input.subtotal ?? 20, currency),
    grandtotal: money((input.subtotal ?? 20) + 5, currency),
    transactions: (input.quantities ?? [1]).map((quantity, index) => ({
      transaction_id: input.id * 10 + index,
      title: "Moon phase necklace",
      description: "Hand-made silver moon",
      quantity,
      price: money(10, currency),
    })),
    refunds: (input.refunds ?? []).map((refund) => ({
      amount: money(refund.amount, currency),
      created_timestamp: seconds(refund.at),
      reason: "Damaged",
      note_from_issuer: "Sorry, Avery",
      status: "completed",
    })),
  };
}

const SHOP = { shop_id: Number(SHOP_ID), shop_name: "MoonArqStudio", currency_code: "USD", url: "https://www.etsy.com/shop/MoonArqStudio", listing_active_count: 42 };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

type Call = { url: URL; method: string; headers: Headers; body: string | null };

/**
 * Stands in for Etsy: the token endpoint, getShop, and getShopReceipts with its
 * created and last-modified filters and limit/offset paging.
 */
function stubEtsy(state: {
  receipts: () => ReturnType<typeof receipt>[];
  shop?: () => Response | null;
  receiptsResponse?: (url: URL) => Response | null;
  token?: () => Response | Promise<Response>;
}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body == null ? null : String(init.body) });
    if (url.toString() === "https://api.etsy.com/v3/public/oauth/token") {
      return (await state.token?.()) ?? jsonResponse({ access_token: `${ACCESS_TOKEN}-new`, refresh_token: `${REFRESH_TOKEN}-new`, expires_in: 3600, token_type: "Bearer" });
    }
    if (url.pathname === `/v3/application/shops/${SHOP_ID}`) return state.shop?.() ?? jsonResponse(SHOP);
    if (url.pathname === `/v3/application/shops/${SHOP_ID}/receipts`) {
      const custom = state.receiptsResponse?.(url);
      if (custom) return custom;
      const number = (key: string) => (url.searchParams.has(key) ? Number(url.searchParams.get(key)) : null);
      const [minCreated, maxCreated, minModified, maxModified] = ["min_created", "max_created", "min_last_modified", "max_last_modified"].map(number);
      const matching = state.receipts()
        .filter((item) => (minCreated === null || item.created_timestamp >= minCreated) && (maxCreated === null || item.created_timestamp <= maxCreated))
        .filter((item) => (minModified === null || item.updated_timestamp >= minModified) && (maxModified === null || item.updated_timestamp <= maxModified))
        .sort((left, right) => left.created_timestamp - right.created_timestamp);
      const offset = number("offset") ?? 0;
      const limit = number("limit") ?? 25;
      return jsonResponse({ count: matching.length, results: matching.slice(offset, offset + limit) });
    }
    throw new Error(`Unexpected Etsy request: ${url}`);
  }));
  return calls;
}

async function connectedSource(options: { tokenExpiresAt?: string; status?: Source["status"] } = {}): Promise<Source> {
  const source = await createSource({
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "etsy",
    display_name: "Etsy: MoonArqStudio",
    input_url: "https://www.etsy.com/shop/MoonArqStudio",
    normalized_url: "https://www.etsy.com/shop/MoonArqStudio",
    external_account_id: SHOP_ID,
    account_name: "MoonArqStudio",
    sync_mode: "hourly",
    status: options.status ?? "healthy",
    metadata: { oauth_connected: true, etsy_shop_id: SHOP_ID },
  });
  await saveCredential(source.id, "etsy_keystring", KEYSTRING);
  await saveCredential(source.id, "etsy_shared_secret", SHARED_SECRET);
  await saveCredential(source.id, "etsy_access_token", ACCESS_TOKEN);
  await saveCredential(source.id, "etsy_refresh_token", REFRESH_TOKEN);
  await saveCredential(source.id, "etsy_shop_id", SHOP_ID);
  await saveCredential(source.id, "etsy_token_expires_at", options.tokenExpiresAt ?? new Date(Date.now() + 50 * 60_000).toISOString());
  return source;
}

function metricRows(sourceId: string, metricKey: string) {
  return getDemoStore().metricsDaily.filter((row) => row.source_id === sourceId && row.metric_key === metricKey);
}

function metricOn(sourceId: string, metricKey: string, date: string) {
  return metricRows(sourceId, metricKey).filter((row) => row.date === date).reduce((sum, row) => sum + row.metric_value, 0);
}

function metricTotal(sourceId: string, metricKey: string) {
  return metricRows(sourceId, metricKey).reduce((sum, row) => sum + row.metric_value, 0);
}

describe("Etsy detection and definition", () => {
  it("names the source after the shop and points listings and short links at the shop URL", () => {
    expect(detectEtsy("https://www.etsy.com/de/shop/MoonArqStudio?ref=x")).toMatchObject({ normalizedUrl: "https://www.etsy.com/shop/MoonArqStudio", accountName: "MoonArqStudio" });
    expect(detectEtsy("https://etsy.com/listing/123456/moon-necklace")).toMatchObject({ normalizedUrl: "https://www.etsy.com/listing/123456" });
    expect(detectEtsy("https://www.etsy.com/listing/123456")?.accountName).toBeUndefined();
    expect(detectEtsy("https://etsy.me/3abc")?.reasons.join(" ")).toContain("shop URL");
    // Etsy also gives every shop its own address on a subdomain.
    expect(detectEtsy("https://moonarqstudio.etsy.com/?ref=profile")).toMatchObject({ normalizedUrl: "https://www.etsy.com/shop/moonarqstudio", accountName: "moonarqstudio" });
    expect(detectEtsy("https://m.etsy.com/shop/MoonArqStudio")).toMatchObject({ accountName: "MoonArqStudio" });
    for (const other of ["https://www.etsy.com/", "https://www.etsy.com/search?q=moon", "https://notetsy.com/shop/x", "https://help.etsy.com/hc/en-us", "https://developers.etsy.com/documentation", "https://developer.etsy.com/documentation", "https://a.b.etsy.com/", "not a url"]) {
      expect(detectEtsy(other), other).toBeNull();
    }
  });

  it("is a live OAuth connector whose only fields are the encrypted app keys", () => {
    const etsyConnector = getConnector("etsy");
    expect(etsyConnector).toMatchObject({ key: "etsy", availability: "live", setupKind: "oauth", defaultSyncMode: "hourly" });
    expect(etsyConnector.requiredFields.map((field) => [field.key, field.secret, field.required])).toEqual([
      ["etsy_keystring", true, true],
      ["etsy_shared_secret", true, true],
    ]);
    expect(etsyConnector.optionalFields).toEqual([]);
    expect(etsyConnector.capabilities).toMatchObject({ supportsPolling: true, supportsManualSync: true, supportsWebhook: false, canBackfill: true });
    expect(getInitialSourceStatus(etsyConnector, true)).toBe("needs_credentials");
    expect(etsyConnector.getMetricDefinitions().map((definition) => definition.key).sort()).toEqual([
      "etsy_active_listings",
      "etsy_orders",
      "etsy_refunds",
      "etsy_sales",
      "etsy_units_sold",
    ]);
  });
});

describe("Etsy receipts", () => {
  it("keeps only what the metrics read: no buyer, address, message, or listing text", () => {
    const minimized = minimizeEtsyReceipt(receipt({ id: 7, createdAt: new Date("2026-10-02T18:00:00.000Z"), quantities: [1, 2], refunds: [{ amount: 4.5, at: new Date("2026-10-03T18:00:00.000Z") }] }));
    expect(minimized).toEqual({
      receiptId: "7",
      status: "paid",
      isPaid: true,
      createdAt: "2026-10-02T18:00:00.000Z",
      updatedAt: "2026-10-02T18:00:00.000Z",
      currency: "usd",
      subtotal: 20,
      grandTotal: 25,
      units: 3,
      refunds: [{ amount: 4.5, currency: "usd", createdAt: "2026-10-03T18:00:00.000Z" }],
    });
    const text = JSON.stringify(minimized);
    for (const value of PRIVATE_TEXT) expect(text).not.toContain(value);
    expect(minimizeEtsyReceipt({ receipt_id: "abc", created_timestamp: 1 })).toBeNull();
    expect(minimizeEtsyReceipt(null)).toBeNull();
  });

  it("counts orders by the Pacific day they were placed and refunds by the day they were issued", () => {
    const at = (iso: string) => new Date(iso);
    const receipts = [
      // 23:30 Pacific on Oct 1, already Oct 2 in UTC.
      receipt({ id: 1, createdAt: at("2026-10-02T06:30:00.000Z"), subtotal: 30, quantities: [2] }),
      receipt({ id: 2, createdAt: at("2026-10-02T18:00:00.000Z"), subtotal: 12.5, quantities: [1], refunds: [{ amount: 12.5, at: at("2026-10-04T17:00:00.000Z") }] }),
      // Canceled and refunded: money changed hands, so the sale counts and so does the refund.
      receipt({ id: 3, createdAt: at("2026-10-02T19:00:00.000Z"), status: "canceled", subtotal: 99, quantities: [5], refunds: [{ amount: 99, at: at("2026-10-03T17:00:00.000Z") }] }),
      receipt({ id: 4, createdAt: at("2026-10-02T20:00:00.000Z"), subtotal: 50, currency: "EUR" }),
      // Placed before the window: only its refund falls inside it.
      receipt({ id: 5, createdAt: at("2026-09-20T18:00:00.000Z"), status: "canceled", subtotal: 8, refunds: [{ amount: 8, at: at("2026-10-03T18:00:00.000Z") }] }),
      // No money changed hands: canceled without a refund, and never paid.
      receipt({ id: 6, createdAt: at("2026-10-02T21:00:00.000Z"), status: "canceled", subtotal: 70 }),
      receipt({ id: 7, createdAt: at("2026-10-02T22:00:00.000Z"), status: "payment processing", isPaid: false, subtotal: 60 }),
      // Listed twice, as when it matches both the created and the last-modified filter.
      receipt({ id: 2, createdAt: at("2026-10-02T18:00:00.000Z"), subtotal: 12.5, quantities: [1] }),
    ].map(minimizeEtsyReceipt).filter((item) => item !== null);
    const snapshot: EtsySyncSnapshot = {
      kind: "etsy_sync_snapshot",
      fetchedAt: "2026-10-04T20:00:00.000Z",
      window: { startDate: "2026-09-30", endDate: "2026-10-04" },
      shop: { shopId: SHOP_ID, shopName: "MoonArqStudio", currency: "usd", url: null, activeListings: 42 },
      receipts,
    };
    const { metrics, snapshotMetrics } = aggregateEtsySnapshot(snapshot, "source-1");
    const value = (key: string, date: string) => metrics.find((metric) => metric.metricKey === key && metric.date === date)?.metricValue;
    expect(value("etsy_orders", "2026-10-01")).toBe(1);
    expect(value("etsy_sales", "2026-10-01")).toBe(30);
    expect(value("etsy_units_sold", "2026-10-01")).toBe(2);
    expect(value("etsy_orders", "2026-10-02")).toBe(2);
    expect(value("etsy_sales", "2026-10-02")).toBe(111.5);
    expect(value("etsy_units_sold", "2026-10-02")).toBe(6);
    expect(value("etsy_refunds", "2026-10-03")).toBe(107);
    expect(value("etsy_refunds", "2026-10-04")).toBe(12.5);
    expect(value("etsy_refunds", "2026-10-02")).toBe(0);
    // Every day of the window gets a row, so a re-sync replaces it completely.
    expect(value("etsy_orders", "2026-09-30")).toBe(0);
    expect(metrics.filter((metric) => metric.metricKey === "etsy_orders")).toHaveLength(5);
    // The listing count is a snapshot of the sync date, apart from the window's daily rows.
    expect(metrics.some((metric) => metric.metricKey === "etsy_active_listings")).toBe(false);
    expect(snapshotMetrics).toEqual([
      expect.objectContaining({ date: "2026-10-04", metricKey: "etsy_active_listings", metricValue: 42, dimensions: expect.objectContaining({ rollup: "snapshot", shop_id: SHOP_ID }) }),
    ]);
    expect(aggregateEtsySnapshot({ ...snapshot, shop: { ...snapshot.shop, activeListings: null } }, "source-1").snapshotMetrics).toEqual([]);
    expect(metrics.find((metric) => metric.metricKey === "etsy_sales")).toMatchObject({ unit: "usd", dimensions: { rollup: "daily", shop_id: SHOP_ID, definition_version: "etsy-receipts-v1" } });
  });

  it("hashes a snapshot the same way whenever the shop is unchanged", () => {
    const snapshot: EtsySyncSnapshot = {
      kind: "etsy_sync_snapshot",
      fetchedAt: "2026-10-04T20:00:00.000Z",
      window: { startDate: "2026-09-30", endDate: "2026-10-04" },
      shop: { shopId: SHOP_ID, shopName: "MoonArqStudio", currency: "usd", url: null, activeListings: 42 },
      receipts: [],
    };
    expect(hashEtsySnapshot({ ...snapshot, fetchedAt: "2026-10-04T21:00:00.000Z" })).toBe(hashEtsySnapshot(snapshot));
    expect(hashEtsySnapshot({ ...snapshot, shop: { ...snapshot.shop, activeListings: 41 } })).not.toBe(hashEtsySnapshot(snapshot));
  });

  it("pages through receipts and stops at Etsy's offset limit", async () => {
    const all = Array.from({ length: 250 }, (_, index) => receipt({ id: index + 1, createdAt: new Date(Date.now() - index * 60_000) }));
    const calls = stubEtsy({ receipts: () => all });
    const auth = { apiKey: `${KEYSTRING}:${SHARED_SECRET}`, accessToken: ACCESS_TOKEN };
    await expect(fetchEtsyReceipts(auth, SHOP_ID, {})).resolves.toHaveLength(250);
    expect(calls.map((call) => call.url.searchParams.get("offset"))).toEqual(["0", "100", "200"]);
    expect(calls.every((call) => call.url.searchParams.get("limit") === "100")).toBe(true);

    vi.unstubAllGlobals();
    const page = Array.from({ length: 100 }, (_, index) => receipt({ id: index + 1, createdAt: new Date() }));
    const capped = stubEtsy({ receipts: () => [], receiptsResponse: () => jsonResponse({ count: 20_000, results: page }) });
    await expect(fetchEtsyReceipts(auth, SHOP_ID, {})).rejects.toMatchObject({ code: "too_many_receipts" });
    // Known from the first page, so no time is spent paging through what can't be finished.
    expect(capped).toHaveLength(1);

    vi.unstubAllGlobals();
    // Without a count, paging stops at Etsy's offset limit.
    const uncounted = stubEtsy({ receipts: () => [], receiptsResponse: () => jsonResponse({ results: page }) });
    await expect(fetchEtsyReceipts(auth, SHOP_ID, {})).rejects.toMatchObject({ code: "too_many_receipts" });
    expect(uncounted).toHaveLength(121);
  });
});

describe("Etsy sync window", () => {
  it("reaches back a year at first, then five weeks before the last successful sync", () => {
    expect(etsySyncStartDate("2026-10-06", null)).toBe("2025-10-06");
    expect(etsySyncStartDate("2026-10-06", "2026-10-06T15:00:00.000Z")).toBe("2026-09-01");
    // After an outage the window also covers the five weeks the last good sync kept up to date.
    expect(etsySyncStartDate("2026-10-06", "2026-09-10T15:00:00.000Z")).toBe("2026-08-06");
    expect(etsySyncStartDate("2026-10-06", "2026-08-07T15:00:00.000Z")).toBe("2026-07-03");
    expect(etsySyncStartDate("2026-10-06", "2024-01-01T15:00:00.000Z")).toBe("2025-10-06");
    // A last success stamped after today's date (clock skew) never shortens the window.
    expect(etsySyncStartDate("2026-10-06", "2026-10-09T15:00:00.000Z")).toBe("2026-09-01");
  });
});

describe("Etsy sync through the shared engine", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABASE_URL;
    resetDemoStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips, without calling Etsy, until the app keys are saved and the shop is connected", async () => {
    const source = await createSource({
      data_space_id: DATA_SPACE_IDS.moonarq,
      source_type_key: "etsy",
      display_name: "Etsy: MoonArqStudio",
      sync_mode: "hourly",
      status: "needs_credentials",
    });
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchSpy);
    const withoutKeys = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    expect(withoutKeys).toMatchObject({ status: "skipped" });
    expect(withoutKeys.error_message).toContain("Etsy app keystring");

    await saveCredential(source.id, "etsy_keystring", KEYSTRING);
    await saveCredential(source.id, "etsy_shared_secret", SHARED_SECRET);
    const notConnected = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    expect(notConnected).toMatchObject({ status: "skipped", error_message: "Connect Etsy to start syncing." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("backfills a year on the first sync, then recomputes five weeks so later changes replace old counts", async () => {
    const now = Date.now();
    const twoDaysAgo = new Date(now - 2 * DAY_MS);
    const yesterday = new Date(now - DAY_MS);
    const fiftyDaysAgo = new Date(now - 50 * DAY_MS);
    const refundedAt = new Date(now - 60_000);
    let receipts = [
      receipt({ id: 1, createdAt: twoDaysAgo, subtotal: 25, quantities: [1, 2] }),
      receipt({ id: 2, createdAt: twoDaysAgo, status: "canceled", subtotal: 40 }),
      receipt({ id: 3, createdAt: yesterday, status: "completed", subtotal: 10, refunds: [{ amount: 5, at: refundedAt }], updatedAt: refundedAt }),
      receipt({ id: 4, createdAt: fiftyDaysAgo, subtotal: 18, refunds: [{ amount: 7, at: refundedAt }], updatedAt: refundedAt }),
    ];
    const source = await connectedSource();
    const calls = stubEtsy({ receipts: () => receipts });
    const rawRows = () => getDemoStore().rawIngestions.filter((row) => row.source_id === source.id);
    const latestWindow = () => (rawRows().at(-1)?.payload as unknown as EtsySyncSnapshot).window;

    const first = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    expect(first).toMatchObject({ status: "success", records_fetched: 4 });
    const backfill = latestWindow();
    expect(backfill.startDate).toBe(addDaysToDateKey(backfill.endDate, -365));

    // Etsy asks for long histories in windows: contiguous month-long created filters, then older orders that changed.
    const createdWindow = (call: Call) => call.url.searchParams.has("min_created") && !call.url.searchParams.has("min_last_modified");
    const created = calls.filter(createdWindow);
    expect(created.length).toBeGreaterThanOrEqual(13);
    for (const [index, call] of created.entries()) {
      const min = Number(call.url.searchParams.get("min_created"));
      const max = Number(call.url.searchParams.get("max_created"));
      expect(max - min).toBeLessThan(30 * 86_400);
      if (index > 0) expect(min).toBe(Number(created[index - 1].url.searchParams.get("max_created")) + 1);
    }
    const windowStart = Number(created[0].url.searchParams.get("min_created"));
    expect(dateKeyInAppTimeZone(new Date(windowStart * 1000))).toBe(backfill.startDate);
    const modified = calls.filter((call) => call.url.searchParams.has("min_last_modified"));
    expect(modified).toHaveLength(1);
    expect(Object.fromEntries(modified[0].url.searchParams)).toMatchObject({ min_created: String(Date.UTC(2005, 0, 1) / 1000), max_created: String(windowStart - 1), min_last_modified: String(windowStart) });
    expect(modified[0].url.searchParams.has("max_last_modified")).toBe(false);
    for (const call of calls) {
      expect(call.headers.get("x-api-key")).toBe(`${KEYSTRING}:${SHARED_SECRET}`);
      expect(call.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    }

    expect(metricOn(source.id, "etsy_orders", dateKeyInAppTimeZone(twoDaysAgo))).toBe(1);
    expect(metricOn(source.id, "etsy_sales", dateKeyInAppTimeZone(twoDaysAgo))).toBe(25);
    expect(metricOn(source.id, "etsy_units_sold", dateKeyInAppTimeZone(twoDaysAgo))).toBe(3);
    expect(metricOn(source.id, "etsy_orders", dateKeyInAppTimeZone(fiftyDaysAgo))).toBe(1);
    expect(metricOn(source.id, "etsy_refunds", dateKeyInAppTimeZone(refundedAt))).toBe(12);
    expect(metricOn(source.id, "etsy_active_listings", backfill.endDate)).toBe(42);
    expect(metricTotal(source.id, "etsy_orders")).toBe(3);

    expect(rawRows()).toHaveLength(1);
    expect(rawRows()[0].external_id).toBe(`etsy:${SHOP_ID}:${backfill.endDate}`);
    const rawText = JSON.stringify(rawRows()[0].payload);
    for (const value of [...PRIVATE_TEXT, ACCESS_TOKEN, SHARED_SECRET]) expect(rawText).not.toContain(value);

    // Later syncs recompute five weeks; the same shop twice stores nothing new and counts nothing twice.
    const metricCount = getDemoStore().metricsDaily.filter((row) => row.source_id === source.id).length;
    // A row an earlier definition left in the window is replaced along with the rest, never added to.
    const yesterdayKey = dateKeyInAppTimeZone(yesterday);
    const current = metricRows(source.id, "etsy_orders").find((row) => row.date === yesterdayKey)!;
    getDemoStore().metricsDaily.push({ ...current, id: "stale-row", metric_value: 9, dimensions: { ...current.dimensions, definition_version: "etsy-receipts-v0" }, dimensions_hash: "stale-row" });
    expect(metricOn(source.id, "etsy_orders", yesterdayKey)).toBe(10);
    // An earlier day's listing count is history, which no sync rewrites.
    const listings = metricRows(source.id, "etsy_active_listings")[0];
    getDemoStore().metricsDaily.push({ ...listings, id: "older-listings", date: addDaysToDateKey(backfill.endDate, -3), metric_value: 39 });
    calls.length = 0;
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual" })).status).toBe("success");
    const recent = latestWindow();
    expect(recent.startDate).toBe(addDaysToDateKey(recent.endDate, -35));
    expect(calls.filter(createdWindow).some((call) => Number(call.url.searchParams.get("min_created")) === windowStart)).toBe(false);
    expect(metricOn(source.id, "etsy_orders", yesterdayKey)).toBe(1);
    expect(metricOn(source.id, "etsy_active_listings", addDaysToDateKey(backfill.endDate, -3))).toBe(39);
    expect(metricOn(source.id, "etsy_active_listings", recent.endDate)).toBe(42);
    const rawCount = rawRows().length;
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual" })).status).toBe("success");
    expect(rawRows()).toHaveLength(rawCount);
    expect(metricTotal(source.id, "etsy_orders")).toBe(3);
    // The older order's refund still arrives, through the changed-orders filter.
    expect(metricOn(source.id, "etsy_refunds", dateKeyInAppTimeZone(refundedAt))).toBe(12);

    // The order from two days ago is canceled: the five-week window rewrites its day.
    receipts = receipts.map((item) => (item.receipt_id === 1 ? { ...item, status: "canceled", updated_timestamp: seconds(new Date()) } : item));
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual" })).status).toBe("success");
    expect(metricOn(source.id, "etsy_orders", dateKeyInAppTimeZone(twoDaysAgo))).toBe(0);
    expect(metricOn(source.id, "etsy_sales", dateKeyInAppTimeZone(twoDaysAgo))).toBe(0);
    // Older days keep what the backfill recorded.
    expect(metricOn(source.id, "etsy_orders", dateKeyInAppTimeZone(fiftyDaysAgo))).toBe(1);
    expect(metricTotal(source.id, "etsy_orders")).toBe(2);
    expect(getDemoStore().metricsDaily.filter((row) => row.source_id === source.id).length).toBe(metricCount + 1);
  });

  it("gives the same numbers whether a day is recomputed now or was kept from earlier", async () => {
    const now = Date.now();
    const placed = new Date(now - 40 * DAY_MS);
    const refundedAt = new Date(now - 60 * 60_000);
    let receipts = [
      receipt({ id: 1, createdAt: placed, subtotal: 20 }),
      receipt({ id: 2, createdAt: new Date(now - 3 * DAY_MS), subtotal: 15 }),
    ];
    stubEtsy({ receipts: () => receipts });
    const kept = await connectedSource();
    expect((await enqueueSyncRun({ sourceId: kept.id, trigger: "manual" })).status).toBe("success");
    // Canceled and refunded a month later, after its day left the five weeks every sync recomputes.
    receipts = [{ ...receipts[0], ...receipt({ id: 1, createdAt: placed, subtotal: 20, status: "canceled", updatedAt: refundedAt, refunds: [{ amount: 20, at: refundedAt }] }) }, receipts[1]];
    expect((await enqueueSyncRun({ sourceId: kept.id, trigger: "manual" })).status).toBe("success");

    // A shop connected today reads the whole history as it is now.
    const fresh = await connectedSource();
    expect((await enqueueSyncRun({ sourceId: fresh.id, trigger: "manual" })).status).toBe("success");
    for (const key of ["etsy_orders", "etsy_sales", "etsy_units_sold", "etsy_refunds"]) {
      for (const date of [dateKeyInAppTimeZone(placed), dateKeyInAppTimeZone(new Date(now - 3 * DAY_MS)), dateKeyInAppTimeZone(refundedAt)]) {
        expect(metricOn(kept.id, key, date), `${key} on ${date}`).toBe(metricOn(fresh.id, key, date));
      }
    }
    expect(metricOn(kept.id, "etsy_sales", dateKeyInAppTimeZone(placed))).toBe(20);
    expect(metricOn(kept.id, "etsy_refunds", dateKeyInAppTimeZone(refundedAt))).toBe(20);
  });

  it("splits the older-orders filter too when it matches more than Etsy pages through", async () => {
    const now = Date.now();
    const old = receipt({ id: 1, createdAt: new Date(now - 200 * DAY_MS), subtotal: 9, refunds: [{ amount: 9, at: new Date(now - 60_000) }], updatedAt: new Date(now - 60_000) });
    const source = await connectedSource();
    getDemoStore().sources.find((item) => item.id === source.id)!.last_success_at = new Date(now - 60 * 60_000).toISOString();
    const olderFilters: Array<{ min: number; max: number }> = [];
    stubEtsy({
      receipts: () => [old],
      receiptsResponse: (url) => {
        if (!url.searchParams.has("min_last_modified")) return null;
        const min = Number(url.searchParams.get("min_created"));
        const max = Number(url.searchParams.get("max_created"));
        // Pretend Etsy touched a thousand old orders a day: anything wider than twelve days overflows.
        if (((max - min) / 86_400) * 1000 > 12_100) return jsonResponse({ count: 99_999, results: [] });
        if (url.searchParams.get("offset") === "0") olderFilters.push({ min, max });
        return null;
      },
    });
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    expect(run).toMatchObject({ status: "success" });
    expect(olderFilters.length).toBeGreaterThan(1);
    for (let index = 1; index < olderFilters.length; index += 1) expect(olderFilters[index].min).toBe(olderFilters[index - 1].max + 1);
    expect(metricOn(source.id, "etsy_refunds", dateKeyInAppTimeZone(new Date(now - 60_000)))).toBe(9);
  });

  it("reads a stretch busier than Etsy pages through in smaller windows", async () => {
    const now = Date.now();
    const receipts = Array.from({ length: 40 }, (_, index) => receipt({ id: index + 1, createdAt: new Date(now - index * 9 * DAY_MS) }));
    const accepted: Array<{ min: number; max: number }> = [];
    stubEtsy({
      receipts: () => receipts,
      // Pretend every day holds a thousand orders: a window longer than twelve days is more than Etsy pages through.
      receiptsResponse: (url) => {
        if (!url.searchParams.has("min_created") || url.searchParams.has("min_last_modified")) return null;
        const min = Number(url.searchParams.get("min_created"));
        const max = Number(url.searchParams.get("max_created"));
        if (((max - min) / 86_400) * 1000 > 12_100) return jsonResponse({ count: 99_999, results: [] });
        if (url.searchParams.get("offset") === "0") accepted.push({ min, max });
        return null;
      },
    });
    const source = await connectedSource();
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    expect(run).toMatchObject({ status: "success", records_fetched: 40 });
    expect(accepted.every((window) => window.max - window.min <= 12.1 * 86_400)).toBe(true);
    for (let index = 1; index < accepted.length; index += 1) expect(accepted[index].min).toBe(accepted[index - 1].max + 1);
    expect(accepted.at(-1)!.max).toBeGreaterThanOrEqual(Math.floor(now / 1000) - 5);
  });

  it("after an outage, reaches back to the last successful sync instead of five weeks", async () => {
    const lastSuccess = new Date(Date.now() - 60 * DAY_MS).toISOString();
    const source = await connectedSource();
    getDemoStore().sources.find((item) => item.id === source.id)!.last_success_at = lastSuccess;
    const missedOrder = new Date(Date.now() - 45 * DAY_MS);
    stubEtsy({ receipts: () => [receipt({ id: 1, createdAt: missedOrder, subtotal: 33 })] });
    expect((await enqueueSyncRun({ sourceId: source.id, trigger: "manual" })).status).toBe("success");
    const raw = getDemoStore().rawIngestions.filter((row) => row.source_id === source.id).at(-1)!;
    const window = (raw.payload as unknown as EtsySyncSnapshot).window;
    expect(window.startDate).toBe(etsySyncStartDate(window.endDate, lastSuccess));
    expect(window.startDate < addDaysToDateKey(window.endDate, -35)).toBe(true);
    expect(metricOn(source.id, "etsy_sales", dateKeyInAppTimeZone(missedOrder))).toBe(33);
  });

  it("keeps values the request sent out of a sync error", async () => {
    const source = await connectedSource();
    stubEtsy({ receipts: () => [], shop: () => jsonResponse({ error: "server_error", error_description: `upstream rejected header ${KEYSTRING}:${SHARED_SECRET} at ${SHARED_SECRET}` }, 500) });
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "manual" });
    expect(run.status).toBe("error");
    expect(run.error_message).toContain("Etsy request failed: upstream rejected header [redacted]");
    const stored = JSON.stringify([run, await getSource(source.id), getDemoStore().connectorEvents.filter((event) => event.source_id === source.id)]);
    expect(stored).not.toContain(SHARED_SECRET);
    expect(stored).not.toContain(KEYSTRING);
  });

  it("refreshes an access token that is about to expire before calling Etsy", async () => {
    const source = await connectedSource({ tokenExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    const calls = stubEtsy({ receipts: () => [] });
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "cron" });
    expect(run.status).toBe("success");

    expect(calls[0].url.toString()).toBe("https://api.etsy.com/v3/public/oauth/token");
    expect(Object.fromEntries(new URLSearchParams(calls[0].body ?? ""))).toEqual({ grant_type: "refresh_token", client_id: KEYSTRING, refresh_token: REFRESH_TOKEN });
    for (const call of calls.slice(1)) expect(call.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}-new`);
    expect(await getDecryptedCredentialMap(source.id)).toMatchObject({ etsy_access_token: `${ACCESS_TOKEN}-new`, etsy_refresh_token: `${REFRESH_TOKEN}-new` });
    const updated = await getSource(source.id);
    expect(Date.parse(String(updated?.metadata.token_expires_at))).toBeGreaterThan(Date.now() + 55 * 60_000);
    expect(Date.parse(String(updated?.metadata.refresh_expires_at))).toBeGreaterThan(Date.now() + 89 * DAY_MS);
    const events = getDemoStore().connectorEvents.filter((event) => event.source_id === source.id);
    expect(events.some((event) => event.event_type === "etsy_token_refreshed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(ACCESS_TOKEN);
  });

  it("refreshes once and retries when Etsy refuses a token it has not yet expired", async () => {
    const source = await connectedSource();
    let refused = false;
    const calls = stubEtsy({
      receipts: () => [],
      shop: () => {
        if (refused) return null;
        refused = true;
        return jsonResponse({ error: "invalid_token" }, 401);
      },
    });
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "cron" });
    expect(run.status).toBe("success");
    expect(calls.map((call) => call.url.pathname).slice(0, 3)).toEqual([`/v3/application/shops/${SHOP_ID}`, "/v3/public/oauth/token", `/v3/application/shops/${SHOP_ID}`]);
  });

  it("uses the token pair a connection test just saved instead of asking for a reconnect", async () => {
    const source = await connectedSource({ tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const calls = stubEtsy({
      receipts: () => [],
      // Etsy refuses the old refresh token because something else used it a moment ago and saved the new pair.
      token: async () => {
        await saveCredential(source.id, "etsy_access_token", `${ACCESS_TOKEN}-other`);
        await saveCredential(source.id, "etsy_refresh_token", `${REFRESH_TOKEN}-other`);
        await saveCredential(source.id, "etsy_token_expires_at", new Date(Date.now() + 55 * 60_000).toISOString());
        return jsonResponse({ error: "invalid_grant" }, 400);
      },
    });
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "cron" });
    expect(run.status).toBe("success");
    for (const call of calls.slice(1)) expect(call.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}-other`);
  });

  it("asks for a reconnect when the refresh token is no longer accepted", async () => {
    const source = await connectedSource({ tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    stubEtsy({ receipts: () => [], token: () => jsonResponse({ error: "invalid_grant", error_description: `refresh token ${REFRESH_TOKEN} expired` }, 400) });
    const run = await enqueueSyncRun({ sourceId: source.id, trigger: "cron" });
    expect(run).toMatchObject({ status: "error", error_message: ETSY_RECONNECT_MESSAGE });
    const updated = await getSource(source.id);
    expect(updated).toMatchObject({ status: "error", last_error: ETSY_RECONNECT_MESSAGE });
    expect(isAuthorizationError(updated?.last_error)).toBe(true);
    expect(JSON.stringify(getDemoStore().syncRuns.filter((item) => item.source_id === source.id))).not.toContain(REFRESH_TOKEN);
  });

  it("reports Etsy's rate limit and rejected app keys in plain words", async () => {
    const limited = await connectedSource();
    stubEtsy({ receipts: () => [], receiptsResponse: () => jsonResponse({ error: "Too many requests" }, 429, { "retry-after": "30" }) });
    expect(await enqueueSyncRun({ sourceId: limited.id, trigger: "cron" })).toMatchObject({
      status: "error",
      error_message: "Etsy's rate limit was reached; the next sync will try again.",
    });

    vi.unstubAllGlobals();
    resetDemoStore();
    const rejected = await connectedSource();
    stubEtsy({ receipts: () => [], shop: () => jsonResponse({ error: `Invalid API key: ${KEYSTRING}:${SHARED_SECRET}` }, 403) });
    const run = await enqueueSyncRun({ sourceId: rejected.id, trigger: "cron" });
    expect(run.status).toBe("error");
    expect(run.error_message).toContain("rejected the app keystring or shared secret");
    expect(JSON.stringify(run)).not.toContain(SHARED_SECRET);
  });
});
