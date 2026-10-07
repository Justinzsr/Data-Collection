import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPlatformCards,
  etsyCard,
  getEtsyDetail,
  overviewRange,
} from "@/aggregation/services/platform-overview-service";
import { ETSY_APP_KEYS_MESSAGE } from "@/collection/connectors/etsy/errors";
import { authorizationState } from "@/presentation/dashboard/connection-health-panel";
import { platformHealth } from "@/presentation/overview/platform-health";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import type { JsonRecord, MetricDaily, Source } from "@/storage/db/schema";
import { getDemoStore, resetDemoStore } from "@/storage/repositories/demo-store";
import { addDaysToDateKey } from "@/storage/runtime/app-time";

// Tuesday Oct 6, 2026, 10:00 in Los Angeles.
const NOW = new Date("2026-10-06T17:00:00.000Z");
const TODAY = "2026-10-06";
const SOURCE_ID = "etsy-source";

function etsySourceRecord(patch: Partial<Source> = {}): Source {
  return {
    id: SOURCE_ID,
    data_space_id: DATA_SPACE_IDS.moonarq,
    source_type_key: "etsy",
    display_name: "Etsy: MoonArqStudio",
    input_url: "https://www.etsy.com/shop/MoonArqStudio",
    normalized_url: "https://www.etsy.com/shop/MoonArqStudio",
    external_account_id: "98765432",
    account_name: "MoonArqStudio",
    status: "healthy",
    sync_mode: "hourly",
    sync_frequency_minutes: 60,
    supports_webhook: false,
    webhook_url: null,
    webhook_secret_hint: null,
    last_manual_sync_at: null,
    last_cron_sync_at: "2026-10-06T16:00:00.000Z",
    last_webhook_sync_at: null,
    last_success_at: "2026-10-06T16:00:00.000Z",
    last_error_at: null,
    last_error: null,
    next_sync_at: "2026-10-06T18:00:00.000Z",
    metadata: { oauth_connected: true, etsy_currency: "usd", refresh_expires_at: "2027-01-04T16:00:00.000Z" },
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-10-06T16:00:00.000Z",
    ...patch,
  };
}

function metric(metricKey: string, date: string, value: number, unit = "count", dimensions: JsonRecord = { rollup: "daily", shop_id: "98765432" }, updatedAt = "2026-10-06T16:00:00.000Z"): MetricDaily {
  return {
    id: `${metricKey}-${date}-${updatedAt}`,
    date,
    source_id: SOURCE_ID,
    source_type_key: "etsy",
    metric_key: metricKey,
    metric_value: value,
    unit,
    dimensions,
    dimensions_hash: JSON.stringify(dimensions),
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

/** Sixty days of a shop selling two orders (60 USD) a day, three a day (90 USD) in the last thirty, with one refund. */
function shopRows() {
  const rows: MetricDaily[] = [];
  for (let offset = 0; offset < 60; offset += 1) {
    const date = addDaysToDateKey(TODAY, -offset);
    const recent = offset < 30;
    rows.push(
      metric("etsy_orders", date, recent ? 3 : 2),
      metric("etsy_sales", date, recent ? 90 : 60, "usd"),
      metric("etsy_units_sold", date, recent ? 4 : 2),
      metric("etsy_refunds", date, date === "2026-10-01" ? 15 : 0, "usd"),
    );
  }
  rows.push(
    metric("etsy_active_listings", "2026-10-05", 40, "count", { rollup: "snapshot", shop_id: "98765432" }, "2026-10-05T16:00:00.000Z"),
    metric("etsy_active_listings", TODAY, 42, "count", { rollup: "snapshot", shop_id: "98765432" }),
  );
  return rows;
}

describe("Etsy overview card", () => {
  const range = overviewRange("30d", NOW);

  it("says what is missing before there is anything to show", () => {
    expect(etsyCard(null, [], range).unavailableReason).toBe("Add Etsy, then connect your shop.");
    expect(etsyCard(etsySourceRecord({ metadata: {} }), shopRows(), range).unavailableReason).toBe("Connect Etsy to see orders and sales.");
    const waiting = etsyCard(etsySourceRecord({ last_success_at: null }), [], range);
    expect(waiting.unavailableReason).toBe("Waiting for the first Etsy sync.");
    expect(waiting.primary.value).toBeNull();
    expect(waiting.sparkline.points).toEqual([]);
  });

  it("leads with sales, then orders and the latest active listing count", () => {
    const card = etsyCard(etsySourceRecord(), shopRows(), range);
    expect(card).toMatchObject({ key: "etsy", iconKey: "etsy", title: "Etsy", account: "MoonArqStudio", unavailableReason: null });
    expect(card.primary).toMatchObject({ key: "sales", label: "Sales", value: 30 * 90, unit: "usd", higherIsBetter: true });
    // Complete days only: 29 recent days of 90 against the 29 days before them, at 90 for one and 60 for the rest.
    expect(card.primary.delta).toMatchObject({ kind: "percent", basis: "vs previous 30 days" });
    const [orders, listings] = card.secondary;
    expect(orders).toMatchObject({ key: "orders", value: 90 });
    expect(listings).toMatchObject({ key: "active_listings", value: 42, delta: { kind: "none" } });
    expect(card.sparkline.points).toHaveLength(30);
    expect(card.sparkline.points.at(-1)).toEqual({ date: TODAY, value: 90 });
  });

  it("takes the currency from the newest sale, then the shop", () => {
    const euroRows = shopRows().map((row) => (row.metric_key === "etsy_sales" ? { ...row, unit: "eur" } : row));
    expect(etsyCard(etsySourceRecord(), euroRows, range).primary.unit).toBe("eur");
    expect(etsyCard(etsySourceRecord({ metadata: { oauth_connected: true, etsy_currency: "gbp" } }), [], range).primary.unit).toBe("gbp");
    expect(etsyCard(etsySourceRecord({ metadata: { oauth_connected: true } }), [], range).primary.unit).toBe("usd");
  });

  it("appears on the Overview, after Shopify, only once an Etsy source exists", () => {
    const base = { dataSpaceSlug: "moonarq", snapshotRows: [], range, websiteOverview: null };
    expect(buildPlatformCards({ ...base, sources: [], sumRows: [] }).some((card) => card.key === "etsy")).toBe(false);
    const keys = buildPlatformCards({ ...base, sources: [etsySourceRecord()], sumRows: shopRows() }).map((card) => card.key);
    expect(keys.indexOf("etsy")).toBe(keys.indexOf("shopify") + 1);
    expect(buildPlatformCards({ ...base, sources: [etsySourceRecord({ status: "disabled" })], sumRows: [] }).some((card) => card.key === "etsy")).toBe(false);
  });
});

describe("Etsy health", () => {
  it("tracks the refresh token, since access renews itself", () => {
    expect(authorizationState(etsySourceRecord(), NOW.getTime())).toMatchObject({ tone: "green", label: expect.stringContaining("Valid until"), attention: false });
    expect(authorizationState(etsySourceRecord({ metadata: { oauth_connected: true } }), NOW.getTime())).toMatchObject({ label: "Auto-refreshing", attention: false });
    expect(authorizationState(etsySourceRecord({ metadata: { oauth_connected: true, refresh_expires_at: "2026-10-12T00:00:00.000Z" } }), NOW.getTime())).toMatchObject({ tone: "amber", renewal: true });
    expect(authorizationState(etsySourceRecord({ metadata: {} }), NOW.getTime())).toMatchObject({ label: "Not authorized", attention: true });
    // A refused authorization outranks the expiry date still on record.
    expect(authorizationState(etsySourceRecord({ status: "error", last_error: "Etsy authorization expired or was revoked. Reconnect Etsy." }), NOW.getTime())).toMatchObject({ tone: "rose", label: "Reconnect needed", renewal: true });
  });

  it("asks for a reconnect when a sync failed for want of authorization", () => {
    expect(platformHealth(etsySourceRecord({ status: "error", last_error: "Etsy authorization expired or was revoked. Reconnect Etsy." }), NOW.getTime())).toMatchObject({ label: "Reconnect needed", needsAttention: true });
    expect(platformHealth(etsySourceRecord({ status: "error", last_error: "Etsy's rate limit was reached; the next sync will try again." }), NOW.getTime())).toMatchObject({ label: "Sync error" });
    // Rejected app keys are fixed in the key fields, not by reconnecting.
    expect(platformHealth(etsySourceRecord({ status: "error", last_error: ETSY_APP_KEYS_MESSAGE }), NOW.getTime())).toMatchObject({ label: "Sync error" });
    expect(platformHealth(etsySourceRecord({ status: "warning", metadata: {} }), NOW.getTime())).toMatchObject({ label: "Not authorized", needsAttention: true });
    expect(platformHealth(etsySourceRecord(), NOW.getTime())).toMatchObject({ label: "Live" });
  });
});

describe("Etsy detail", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    resetDemoStore();
  });

  it("totals the period and works out the average order value and its change", async () => {
    const store = getDemoStore();
    store.sources.push(etsySourceRecord());
    store.metricsDaily.push(...shopRows());
    const detail = await getEtsyDetail({ dataSpace: { id: DATA_SPACE_IDS.moonarq, slug: "moonarq" }, rangeKey: "30d", now: NOW });

    expect(detail.currency).toBe("usd");
    const byKey = Object.fromEntries(detail.metrics.map((item) => [item.key, item]));
    expect(Object.keys(byKey)).toEqual(["sales", "orders", "units_sold", "average_order_value", "refunds", "active_listings"]);
    expect(byKey.sales.value).toBe(2700);
    expect(byKey.orders.value).toBe(90);
    expect(byKey.units_sold.value).toBe(120);
    expect(byKey.average_order_value.value).toBe(30);
    expect(byKey.average_order_value.delta).toMatchObject({ kind: "percent", value: 0 });
    expect(byKey.refunds).toMatchObject({ value: 15, higherIsBetter: false });
    expect(byKey.active_listings.value).toBe(42);
    expect(detail.dailySales).toHaveLength(30);
    expect(detail.dailyOrders.at(-1)).toEqual({ date: TODAY, value: 3 });
  });

  it("shows nothing but the setup state before the shop is connected", async () => {
    getDemoStore().sources.push(etsySourceRecord({ metadata: {}, last_success_at: null }));
    const detail = await getEtsyDetail({ dataSpace: { id: DATA_SPACE_IDS.moonarq, slug: "moonarq" }, rangeKey: "7d", now: NOW });
    expect(detail.card.unavailableReason).toBe("Connect Etsy to see orders and sales.");
    expect(detail.metrics.every((item) => item.value === null)).toBe(true);
    expect(detail.dailySales).toEqual([]);
  });
});
