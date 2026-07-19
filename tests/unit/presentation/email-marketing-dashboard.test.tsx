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
});
