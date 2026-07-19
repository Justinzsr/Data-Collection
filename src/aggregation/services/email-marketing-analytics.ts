import type { EmailSignup } from "@/collection/connectors/supabase/email-signups-adapter";
import { addDaysToDateKey, dateKeyInAppTimeZone } from "@/storage/runtime/app-time";

export type EmailMarketingRecord = Omit<EmailSignup, "email_normalized" | "page_url" | "referrer">;

export type EmailMarketingKpis = {
  totalSignups: number;
  consentedSignups: number;
  promoEmailsSent: number;
  pendingPromoEmails: number;
  promoEmailSendRate: number;
  shopifyLinkedCustomers: number;
  signupsLast24Hours: number;
  signupsLast7Days: number;
};

export type PromoStatus = "sent" | "pending" | "not_eligible";
export type PromoStatusFilter = "all" | "sent" | "pending";
export type ConsentFilter = "all" | "consented" | "not_consented";
export type ShopifyFilter = "all" | "linked" | "not_linked";
export type EmailSignupDateFilter = "all" | "24h" | "7d" | "30d";
export type EmailMarketingSortKey =
  | "email"
  | "consent_email_marketing"
  | "discount_code"
  | "promo_email_sent"
  | "zapier_sent_at"
  | "shopify_customer_id"
  | "source"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "created_at"
  | "updated_at";

export type EmailMarketingFilters = {
  search: string;
  promoStatus: PromoStatusFilter;
  consent: ConsentFilter;
  shopify: ShopifyFilter;
  dateRange: EmailSignupDateFilter;
  sortKey: EmailMarketingSortKey;
  sortDirection: "asc" | "desc";
};

export const DEFAULT_EMAIL_MARKETING_FILTERS: EmailMarketingFilters = {
  search: "",
  promoStatus: "all",
  consent: "all",
  shopify: "all",
  dateRange: "all",
  sortKey: "created_at",
  sortDirection: "desc",
};

function timestamp(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function classifyPromoStatus(row: EmailMarketingRecord): PromoStatus {
  if (row.promo_email_sent) return "sent";
  if (row.consent_email_marketing) return "pending";
  return "not_eligible";
}

export function calculateEmailMarketingKpis(
  rows: EmailMarketingRecord[],
  now: Date = new Date(),
): EmailMarketingKpis {
  const nowMs = now.getTime();
  const within = (value: string | null, durationMs: number) => {
    const createdAt = timestamp(value);
    return createdAt !== null && createdAt <= nowMs && createdAt >= nowMs - durationMs;
  };
  const consentedSignups = rows.filter((row) => row.consent_email_marketing).length;
  const promoEmailsSent = rows.filter((row) => row.promo_email_sent).length;

  return {
    totalSignups: rows.length,
    consentedSignups,
    promoEmailsSent,
    pendingPromoEmails: rows.filter((row) => classifyPromoStatus(row) === "pending").length,
    promoEmailSendRate: consentedSignups === 0 ? 0 : (promoEmailsSent / consentedSignups) * 100,
    shopifyLinkedCustomers: rows.filter((row) => Boolean(row.shopify_customer_id)).length,
    signupsLast24Hours: rows.filter((row) => within(row.created_at, 24 * 60 * 60 * 1_000)).length,
    signupsLast7Days: rows.filter((row) => within(row.created_at, 7 * 24 * 60 * 60 * 1_000)).length,
  };
}

export function buildDailyEmailSignupSeries(
  rows: EmailMarketingRecord[],
  days = 30,
  now: Date = new Date(),
) {
  const safeDays = Math.min(366, Math.max(1, Math.floor(days)));
  const endDate = dateKeyInAppTimeZone(now);
  const startDate = addDaysToDateKey(endDate, -(safeDays - 1));
  const totals = new Map<string, number>();

  for (const row of rows) {
    if (!row.created_at) continue;
    const createdAt = timestamp(row.created_at);
    if (createdAt === null) continue;
    const date = dateKeyInAppTimeZone(createdAt);
    if (date < startDate || date > endDate) continue;
    totals.set(date, (totals.get(date) ?? 0) + 1);
  }

  return Array.from({ length: safeDays }, (_, index) => {
    const date = addDaysToDateKey(startDate, index);
    return { date, value: totals.get(date) ?? 0 };
  });
}

export function buildPromoStatusBreakdown(rows: EmailMarketingRecord[]) {
  return [
    { key: "sent" as const, label: "Sent", value: rows.filter((row) => classifyPromoStatus(row) === "sent").length },
    { key: "pending" as const, label: "Pending", value: rows.filter((row) => classifyPromoStatus(row) === "pending").length },
  ];
}

export function buildSignupSourceBreakdown(rows: EmailMarketingRecord[], limit = 8) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const label = row.utm_source?.trim() || row.source?.trim() || "Unattributed";
    totals.set(label, (totals.get(label) ?? 0) + 1);
  }
  const sorted = [...totals.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (sorted.length <= limit) return sorted.map(([label, value]) => ({ label, value }));
  const visible = sorted.slice(0, Math.max(1, limit - 1));
  const other = sorted.slice(visible.length).reduce((sum, entry) => sum + entry[1], 0);
  return [...visible.map(([label, value]) => ({ label, value })), { label: "Other", value: other }];
}

function compareValues(left: unknown, right: unknown) {
  if (left === right) return 0;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
}

function isEmptySortValue(value: unknown) {
  return value === null || value === undefined || value === "";
}

export function filterAndSortEmailSignups(
  rows: EmailMarketingRecord[],
  filters: EmailMarketingFilters,
  now: Date = new Date(),
) {
  const search = filters.search.trim().toLowerCase();
  const nowMs = now.getTime();
  const minimumCreatedAt =
    filters.dateRange === "24h"
      ? nowMs - 24 * 60 * 60 * 1_000
      : filters.dateRange === "7d"
        ? nowMs - 7 * 24 * 60 * 60 * 1_000
        : filters.dateRange === "30d"
          ? nowMs - 30 * 24 * 60 * 60 * 1_000
          : null;

  return rows
    .filter((row) => {
      if (search && !row.email.toLowerCase().includes(search)) return false;
      if (filters.promoStatus !== "all" && classifyPromoStatus(row) !== filters.promoStatus) return false;
      if (filters.consent === "consented" && !row.consent_email_marketing) return false;
      if (filters.consent === "not_consented" && row.consent_email_marketing) return false;
      if (filters.shopify === "linked" && !row.shopify_customer_id) return false;
      if (filters.shopify === "not_linked" && row.shopify_customer_id) return false;
      if (minimumCreatedAt !== null) {
        const createdAt = timestamp(row.created_at);
        if (createdAt === null || createdAt < minimumCreatedAt || createdAt > nowMs) return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftValue = left[filters.sortKey];
      const rightValue = right[filters.sortKey];
      if (isEmptySortValue(leftValue) && isEmptySortValue(rightValue)) return 0;
      if (isEmptySortValue(leftValue)) return 1;
      if (isEmptySortValue(rightValue)) return -1;
      const result = compareValues(leftValue, rightValue);
      return filters.sortDirection === "asc" ? result : -result;
    });
}

export function toEmailMarketingRecord(row: EmailSignup): EmailMarketingRecord {
  return {
    id: row.id,
    email: row.email,
    source: row.source,
    discount_code: row.discount_code,
    consent_email_marketing: row.consent_email_marketing,
    utm_source: row.utm_source,
    utm_medium: row.utm_medium,
    utm_campaign: row.utm_campaign,
    promo_email_sent: row.promo_email_sent,
    zapier_sent_at: row.zapier_sent_at,
    shopify_customer_id: row.shopify_customer_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
