import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; prefetch?: unknown; href: string }) =>
    createElement("a", props, children),
}));

import { EmailMarketingDashboardView } from "@/presentation/email-marketing/email-marketing-dashboard";

const emptySnapshot: EmailMarketingSnapshot = {
  rows: [],
  kpis: {
    totalSignups: 0,
    consentedSignups: 0,
    promoEmailsSent: 0,
    pendingPromoEmails: 0,
    promoEmailSendRate: 0,
    shopifyLinkedCustomers: 0,
    signupsLast24Hours: 0,
    signupsLast7Days: 0,
  },
  fetchedAt: "2026-07-18T18:00:00.000Z",
  source: {
    project: "moonarq-web",
    schema: "public",
    table: "email_signups",
    connection: "direct_supabase",
  },
};

const commonProps = {
  dataSpaceName: "MoonArq",
  dataSpaceSlug: "moonarq",
  isRefreshing: false,
  isStale: false,
  isAuthLocked: false,
  error: null,
  refresh: vi.fn(async () => undefined),
};

describe("EmailMarketingDashboardView states", () => {
  it("renders a clear first-load state before any snapshot is available", () => {
    const markup = renderToStaticMarkup(
      <EmailMarketingDashboardView
        {...commonProps}
        snapshot={null}
        isLoading
      />,
    );

    expect(markup).toContain("Loading marketing email signups");
    expect(markup).toContain("Reading the protected MoonArq website Supabase source");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("No marketing email signups yet");
  });

  it("renders the source-backed empty state after a successful empty response", () => {
    const markup = renderToStaticMarkup(
      <EmailMarketingDashboardView
        {...commonProps}
        snapshot={emptySnapshot}
        isLoading={false}
      />,
    );

    expect(markup).toContain("No marketing email signups yet");
    expect(markup).toContain("moonarq-web.public.email_signups");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("Loading marketing email signups");
  });

  it("renders only the locked state and removes protected snapshot and search content", () => {
    const protectedEmail = "locked-person@example.com";
    const protectedShopifyId = "gid://shopify/Customer/locked-101";
    const protectedSnapshot: EmailMarketingSnapshot = {
      ...emptySnapshot,
      rows: [
        {
          id: "locked-signup",
          email: protectedEmail,
          email_normalized: protectedEmail,
          source: "synthetic-test",
          discount_code: "EXAMPLE",
          consent_email_marketing: true,
          page_url: "https://store.example.com/newsletter",
          referrer: "https://referrer.example.com/",
          utm_source: "example",
          utm_medium: "test",
          utm_campaign: "locked-state",
          promo_email_sent: true,
          zapier_sent_at: "2026-07-18T17:02:00.000Z",
          shopify_customer_id: protectedShopifyId,
          created_at: "2026-07-18T17:00:00.000Z",
          updated_at: "2026-07-18T17:02:00.000Z",
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <EmailMarketingDashboardView
        {...commonProps}
        snapshot={protectedSnapshot}
        isLoading={false}
        isStale
        isAuthLocked
      />,
    );

    expect(markup).toContain("Email Marketing is locked");
    expect(markup).toContain("Protected marketing data has been cleared from this page");
    expect(markup).toContain("/login?next=%2Fw%2Fmoonarq%2Fdashboard%2Fsupabase%2Femail-marketing");
    expect(markup).not.toContain(protectedEmail);
    expect(markup).not.toContain(protectedShopifyId);
    expect(markup).not.toContain("Search email");
    expect(markup).not.toContain("Marketing email signups");
    expect(markup).not.toContain("Stale");
    expect(markup).not.toContain("Showing the last successful dataset");
  });
});
