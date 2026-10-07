import { createHash } from "node:crypto";
import type { NormalizedMetric } from "@/collection/connectors/types";
import { ETSY_DEFINITION_VERSION } from "@/collection/connectors/etsy/constants";
import type { JsonRecord } from "@/storage/db/schema";
import { addDaysToDateKey, dateKeyInAppTimeZone, isAppDateKey } from "@/storage/runtime/app-time";

/*
 * Etsy receipts are orders. Only what the metrics read is kept: buyer names,
 * addresses, emails, messages, gift notes, refund notes, and listing titles never
 * reach a raw payload.
 */

export type EtsyRefundRecord = {
  amount: number;
  currency: string | null;
  createdAt: string;
};

export type EtsyReceiptRecord = {
  receiptId: string;
  /** Etsy's status, lowercased: paid, completed, open, payment processing, canceled, fully refunded, partially refunded. */
  status: string | null;
  /** Whether the buyer paid; null when Etsy did not say. */
  isPaid: boolean | null;
  createdAt: string;
  updatedAt: string | null;
  currency: string | null;
  /** Items after shop coupons; no shipping or tax. */
  subtotal: number | null;
  grandTotal: number | null;
  units: number;
  refunds: EtsyRefundRecord[];
};

export type EtsySyncSnapshot = {
  kind: "etsy_sync_snapshot";
  fetchedAt: string;
  /** Pacific dates this snapshot recomputes completely. */
  window: { startDate: string; endDate: string };
  shop: { shopId: string; shopName: string | null; currency: string | null; url: string | null; activeListings: number | null };
  receipts: EtsyReceiptRecord[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function idText(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^\d+$/u.test(value)) return value;
  return null;
}

/** Etsy money is { amount, divisor, currency_code }: 500 with divisor 100 is 5.00. */
export function etsyMoney(value: unknown): { amount: number; currency: string | null } | null {
  const money = record(value);
  if (!money) return null;
  const amount = Number(money.amount);
  const divisor = Number(money.divisor);
  if (!Number.isFinite(amount) || !Number.isFinite(divisor) || divisor <= 0) return null;
  const currency = typeof money.currency_code === "string" && /^[A-Za-z]{3}$/u.test(money.currency_code) ? money.currency_code.toLowerCase() : null;
  return { amount: amount / divisor, currency };
}

function epochIso(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** The fields the metrics read, or null for something that is not a receipt. */
export function minimizeEtsyReceipt(raw: unknown): EtsyReceiptRecord | null {
  const receipt = record(raw);
  if (!receipt) return null;
  const receiptId = idText(receipt.receipt_id);
  const createdAt = epochIso(receipt.created_timestamp ?? receipt.create_timestamp);
  if (!receiptId || !createdAt) return null;
  const subtotal = etsyMoney(receipt.subtotal);
  const grandTotal = etsyMoney(receipt.grandtotal);
  const transactions = Array.isArray(receipt.transactions) ? receipt.transactions : [];
  const units = transactions.reduce<number>((total, item) => {
    const quantity = Number(record(item)?.quantity);
    return total + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
  const refunds = (Array.isArray(receipt.refunds) ? receipt.refunds : []).flatMap((item): EtsyRefundRecord[] => {
    const refund = record(item);
    const money = etsyMoney(refund?.amount);
    const refundedAt = epochIso(refund?.created_timestamp);
    return money && refundedAt ? [{ amount: Math.abs(money.amount), currency: money.currency, createdAt: refundedAt }] : [];
  });
  return {
    receiptId,
    status: typeof receipt.status === "string" ? receipt.status.trim().toLowerCase() : null,
    isPaid: typeof receipt.is_paid === "boolean" ? receipt.is_paid : null,
    createdAt,
    updatedAt: epochIso(receipt.updated_timestamp ?? receipt.update_timestamp),
    currency: subtotal?.currency ?? grandTotal?.currency ?? null,
    subtotal: subtotal?.amount ?? null,
    grandTotal: grandTotal?.amount ?? null,
    units,
    refunds,
  };
}

export function isEtsySyncSnapshot(value: unknown): value is EtsySyncSnapshot {
  const snapshot = record(value);
  const window = record(snapshot?.window);
  const shop = record(snapshot?.shop);
  return snapshot?.kind === "etsy_sync_snapshot"
    && typeof snapshot.fetchedAt === "string"
    && isAppDateKey(window?.startDate) && isAppDateKey(window?.endDate)
    && typeof shop?.shopId === "string"
    && Array.isArray(snapshot.receipts);
}

export function hashEtsySnapshot(snapshot: EtsySyncSnapshot) {
  // fetchedAt is left out, so an unchanged shop produces the same hash and is stored once.
  return createHash("sha256").update(JSON.stringify({ ...snapshot, fetchedAt: undefined })).digest("hex");
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Daily orders, sales, and units by the Pacific date each order was placed, and
 * refunds by the date each was issued, for every day of the snapshot's window
 * (zeros included, so a re-sync replaces the window completely).
 *
 * Sales are gross, as in Etsy's payments: an order counts on the day it was
 * placed whenever money changed hands (it was paid and not canceled, or Etsy
 * refunded it), and every refund, a cancellation's included, counts on the day
 * the money went back. A refunded order therefore keeps its sale, so recomputing
 * a day gives the same numbers however long after the refund it happens. Active
 * listings is the shop's count at the time of the sync, a snapshot of its own.
 */
export function aggregateEtsySnapshot(snapshot: EtsySyncSnapshot, sourceId: string): { metrics: NormalizedMetric[]; snapshotMetrics: NormalizedMetric[] } {
  const { startDate, endDate } = snapshot.window;
  const currency = snapshot.shop.currency ?? snapshot.receipts.find((receipt) => receipt.currency)?.currency ?? "usd";
  const days = new Map<string, { orders: number; sales: number; units: number; refunds: number }>();
  for (let date = startDate; date <= endDate; date = addDaysToDateKey(date, 1)) days.set(date, { orders: 0, sales: 0, units: 0, refunds: 0 });
  const seen = new Set<string>();
  for (const receipt of snapshot.receipts) {
    if (seen.has(receipt.receiptId)) continue;
    seen.add(receipt.receiptId);
    const orderDay = days.get(dateKeyInAppTimeZone(receipt.createdAt));
    // A refund means money was taken, so a refunded order counts whatever its status says now.
    const moneyChangedHands = receipt.refunds.length > 0 || (receipt.isPaid !== false && receipt.status !== "canceled");
    if (orderDay && moneyChangedHands && (!receipt.currency || receipt.currency === currency)) {
      orderDay.orders += 1;
      orderDay.sales += receipt.subtotal ?? 0;
      orderDay.units += receipt.units;
    }
    for (const refund of receipt.refunds) {
      const refundDay = days.get(dateKeyInAppTimeZone(refund.createdAt));
      if (refundDay && (!refund.currency || refund.currency === currency)) refundDay.refunds += refund.amount;
    }
  }
  const dimensions: JsonRecord = { rollup: "daily", shop_id: snapshot.shop.shopId, definition_version: ETSY_DEFINITION_VERSION };
  const metric = (date: string, metricKey: string, metricValue: number, unit: string, extra: JsonRecord = dimensions): NormalizedMetric => ({
    date, sourceId, sourceTypeKey: "etsy", metricKey, metricValue, unit, dimensions: extra,
  });
  const metrics: NormalizedMetric[] = [];
  for (const [date, values] of days) {
    metrics.push(
      metric(date, "etsy_orders", values.orders, "count"),
      metric(date, "etsy_sales", round(values.sales), currency),
      metric(date, "etsy_units_sold", values.units, "count"),
      metric(date, "etsy_refunds", round(values.refunds), currency),
    );
  }
  const syncDate = dateKeyInAppTimeZone(snapshot.fetchedAt);
  const snapshotMetrics = snapshot.shop.activeListings === null
    ? []
    : [metric(syncDate, "etsy_active_listings", snapshot.shop.activeListings, "count", { rollup: "snapshot", shop_id: snapshot.shop.shopId, definition_version: ETSY_DEFINITION_VERSION })];
  return { metrics, snapshotMetrics };
}
