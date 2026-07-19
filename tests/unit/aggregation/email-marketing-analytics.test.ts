import { describe, expect, it } from "vitest";
import {
  buildDailyEmailSignupSeries,
  buildPromoStatusBreakdown,
  buildSignupSourceBreakdown,
  calculateEmailMarketingKpis,
  classifyPromoStatus,
  DEFAULT_EMAIL_MARKETING_FILTERS,
  filterAndSortEmailSignups,
  toEmailMarketingRecord,
  type EmailMarketingFilters,
  type EmailMarketingRecord,
} from "@/aggregation/services/email-marketing-analytics";
import type { EmailSignup } from "@/collection/connectors/supabase/email-signups-adapter";

const NOW = new Date("2026-07-18T20:00:00.000Z");

function signup(id: string, patch: Partial<EmailMarketingRecord> = {}): EmailMarketingRecord {
  return {
    id,
    email: `${id}@example.com`,
    source: "website_popup",
    discount_code: null,
    consent_email_marketing: false,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    promo_email_sent: false,
    zapier_sent_at: null,
    shopify_customer_id: null,
    created_at: "2026-07-18T19:00:00.000Z",
    updated_at: "2026-07-18T19:00:00.000Z",
    ...patch,
  };
}

function filters(patch: Partial<EmailMarketingFilters> = {}): EmailMarketingFilters {
  return { ...DEFAULT_EMAIL_MARKETING_FILTERS, ...patch };
}

function sortedIds(rows: EmailMarketingRecord[]) {
  return rows.map((row) => row.id).sort();
}

describe("email marketing analytics", () => {
  it("classifies sent, pending, and ineligible promo states with sent taking precedence", () => {
    const sent = signup("sent", { consent_email_marketing: false, promo_email_sent: true });
    const pending = signup("pending", { consent_email_marketing: true });
    const ineligible = signup("ineligible");

    expect(classifyPromoStatus(sent)).toBe("sent");
    expect(classifyPromoStatus(pending)).toBe("pending");
    expect(classifyPromoStatus(ineligible)).toBe("not_eligible");
    expect(buildPromoStatusBreakdown([sent, pending, ineligible])).toEqual([
      { key: "sent", label: "Sent", value: 1 },
      { key: "pending", label: "Pending", value: 1 },
    ]);
  });

  it("calculates KPIs and includes exact 24-hour and 7-day boundaries", () => {
    const rows = [
      signup("sent-recent", {
        consent_email_marketing: true,
        promo_email_sent: true,
        shopify_customer_id: "gid://shopify/Customer/1",
        created_at: "2026-07-18T19:00:00.000Z",
      }),
      signup("pending-24h-boundary", {
        consent_email_marketing: true,
        created_at: "2026-07-17T20:00:00.000Z",
      }),
      signup("sent-this-week", {
        consent_email_marketing: true,
        promo_email_sent: true,
        shopify_customer_id: "gid://shopify/Customer/2",
        created_at: "2026-07-15T20:00:00.000Z",
      }),
      signup("seven-day-boundary", { created_at: "2026-07-11T20:00:00.000Z" }),
      signup("too-old", { created_at: "2026-07-11T19:59:59.999Z" }),
      signup("future", { created_at: "2026-07-18T20:00:00.001Z" }),
      signup("missing-date", { created_at: null }),
    ];

    expect(calculateEmailMarketingKpis(rows, NOW)).toEqual({
      totalSignups: 7,
      consentedSignups: 3,
      promoEmailsSent: 2,
      pendingPromoEmails: 1,
      promoEmailSendRate: (2 / 3) * 100,
      shopifyLinkedCustomers: 2,
      signupsLast24Hours: 2,
      signupsLast7Days: 4,
    });
  });

  it("returns a zero send rate when there are no consented signups", () => {
    expect(calculateEmailMarketingKpis([signup("not-consented")], NOW)).toMatchObject({
      consentedSignups: 0,
      promoEmailsSent: 0,
      pendingPromoEmails: 0,
      promoEmailSendRate: 0,
    });
  });

  it("groups the daily series by America/Los_Angeles calendar day", () => {
    const rows = [
      signup("july-16", { created_at: "2026-07-16T19:00:00.000Z" }),
      signup("july-17-midnight", { created_at: "2026-07-17T07:00:00.000Z" }),
      signup("july-17-last-second", { created_at: "2026-07-18T06:59:59.999Z" }),
      signup("july-18-midnight", { created_at: "2026-07-18T07:00:00.000Z" }),
      signup("outside-range", { created_at: "2026-07-16T06:59:59.999Z" }),
      signup("null-date", { created_at: null }),
      signup("malformed-date", { created_at: "not-a-timestamp" }),
    ];

    expect(buildDailyEmailSignupSeries(rows, 3, new Date("2026-07-18T08:00:00.000Z"))).toEqual([
      { date: "2026-07-16", value: 1 },
      { date: "2026-07-17", value: 2 },
      { date: "2026-07-18", value: 1 },
    ]);
  });

  it("prefers UTM source, falls back to source, and groups missing attribution", () => {
    const missingUtm = {
      ...signup("missing-utm", { source: null }),
      utm_source: undefined,
      utm_medium: undefined,
      utm_campaign: undefined,
    } as unknown as EmailMarketingRecord;
    const rows = [
      signup("instagram-1", { source: "popup", utm_source: " instagram " }),
      signup("instagram-2", { source: "footer", utm_source: "instagram" }),
      signup("instagram-3", { source: null, utm_source: "instagram" }),
      signup("email-1", { source: " Email ", utm_source: null }),
      signup("email-2", { source: "Email", utm_source: "" }),
      signup("tiktok", { source: "TikTok", utm_source: null }),
      missingUtm,
    ];

    const breakdown = buildSignupSourceBreakdown(rows);
    expect(Object.fromEntries(breakdown.map((entry) => [entry.label, entry.value]))).toEqual({
      instagram: 3,
      Email: 2,
      TikTok: 1,
      Unattributed: 1,
    });
    expect(buildSignupSourceBreakdown(rows, 3)).toEqual([
      { label: "instagram", value: 3 },
      { label: "Email", value: 2 },
      { label: "Other", value: 2 },
    ]);
  });

  it("searches email case-insensitively after trimming the query", () => {
    const rows = [
      signup("alpha", { email: "Alpha.Customer@Example.com" }),
      signup("beta", { email: "beta@example.com" }),
    ];

    expect(filterAndSortEmailSignups(rows, filters({ search: "  ALPHA.customer  " }), NOW).map((row) => row.id)).toEqual([
      "alpha",
    ]);
  });

  it("filters promo, consent, and Shopify status independently", () => {
    const rows = [
      signup("sent-linked", {
        consent_email_marketing: true,
        promo_email_sent: true,
        shopify_customer_id: "customer-1",
      }),
      signup("pending-unlinked", { consent_email_marketing: true }),
      signup("ineligible-linked", { shopify_customer_id: "customer-2" }),
    ];

    expect(sortedIds(filterAndSortEmailSignups(rows, filters({ promoStatus: "sent" }), NOW))).toEqual(["sent-linked"]);
    expect(sortedIds(filterAndSortEmailSignups(rows, filters({ promoStatus: "pending" }), NOW))).toEqual([
      "pending-unlinked",
    ]);
    expect(sortedIds(filterAndSortEmailSignups(rows, filters({ consent: "consented" }), NOW))).toEqual([
      "pending-unlinked",
      "sent-linked",
    ]);
    expect(sortedIds(filterAndSortEmailSignups(rows, filters({ consent: "not_consented" }), NOW))).toEqual([
      "ineligible-linked",
    ]);
    expect(sortedIds(filterAndSortEmailSignups(rows, filters({ shopify: "linked" }), NOW))).toEqual([
      "ineligible-linked",
      "sent-linked",
    ]);
    expect(sortedIds(filterAndSortEmailSignups(rows, filters({ shopify: "not_linked" }), NOW))).toEqual([
      "pending-unlinked",
    ]);
  });

  it.each([
    ["24h", ["within-24h"]],
    ["7d", ["within-24h", "within-7d"]],
    ["30d", ["within-24h", "within-30d", "within-7d"]],
  ] as const)("applies the %s date filter and rejects future, null, and malformed dates", (dateRange, expectedIds) => {
    const rows = [
      signup("within-24h", { created_at: "2026-07-18T19:00:00.000Z" }),
      signup("within-7d", { created_at: "2026-07-14T20:00:00.000Z" }),
      signup("within-30d", { created_at: "2026-06-28T20:00:00.000Z" }),
      signup("too-old", { created_at: "2026-06-18T19:59:59.999Z" }),
      signup("future", { created_at: "2026-07-18T20:00:00.001Z" }),
      signup("null-date", { created_at: null }),
      signup("malformed-date", { created_at: "not-a-timestamp" }),
    ];

    expect(sortedIds(filterAndSortEmailSignups(rows, filters({ dateRange }), NOW))).toEqual(expectedIds);
  });

  it("sorts by created_at descending by default and keeps null dates last", () => {
    const rows = [
      signup("null-date", { created_at: null }),
      signup("oldest", { created_at: "2026-07-01T12:00:00.000Z" }),
      signup("newest", { created_at: "2026-07-18T12:00:00.000Z" }),
      signup("middle", { created_at: "2026-07-10T12:00:00.000Z" }),
    ];

    expect(filterAndSortEmailSignups(rows, DEFAULT_EMAIL_MARKETING_FILTERS, NOW).map((row) => row.id)).toEqual([
      "newest",
      "middle",
      "oldest",
      "null-date",
    ]);
  });

  it("removes normalized email and page-level fields from presentation records while preserving optional UTMs", () => {
    const row: EmailSignup = {
      ...signup("converted", { utm_source: null, utm_medium: null, utm_campaign: null }),
      email_normalized: "converted@example.com",
      page_url: "https://www.moonarqstudio.com/",
      referrer: "https://www.google.com/",
    };

    expect(toEmailMarketingRecord(row)).toEqual(signup("converted", {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
    }));
    expect(toEmailMarketingRecord(row)).not.toHaveProperty("email_normalized");
    expect(toEmailMarketingRecord(row)).not.toHaveProperty("page_url");
    expect(toEmailMarketingRecord(row)).not.toHaveProperty("referrer");
  });
});
