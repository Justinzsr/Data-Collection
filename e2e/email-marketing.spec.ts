import { expect, test, type Page } from "@playwright/test";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";
import { loginDashboard } from "./auth";

const EMAIL_SIGNUPS_API = "**/api/metrics/email-signups?**";

const snapshot = {
  rows: [
    {
      id: "signup-sent",
      email: "sent@example.com",
      email_normalized: "sent@example.com",
      source: "newsletter-popup",
      discount_code: "WELCOME",
      consent_email_marketing: true,
      page_url: "https://www.moonarqstudio.com/newsletter",
      referrer: "https://www.instagram.com/",
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "summer",
      promo_email_sent: true,
      zapier_sent_at: "2026-07-18T17:02:00.000Z",
      shopify_customer_id: "gid://shopify/Customer/101",
      created_at: "2026-07-18T17:00:00.000Z",
      updated_at: "2026-07-18T17:02:00.000Z",
    },
    {
      id: "signup-pending",
      email: "pending@example.com",
      email_normalized: "pending@example.com",
      source: "newsletter-popup",
      discount_code: "WELCOME",
      consent_email_marketing: true,
      page_url: "https://www.moonarqstudio.com/newsletter",
      referrer: "https://www.google.com/",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "brand",
      promo_email_sent: false,
      zapier_sent_at: null,
      shopify_customer_id: null,
      created_at: "2026-07-18T16:00:00.000Z",
      updated_at: "2026-07-18T16:00:00.000Z",
    },
    {
      id: "signup-not-eligible",
      email: "browse@example.com",
      email_normalized: "browse@example.com",
      source: "footer",
      discount_code: null,
      consent_email_marketing: false,
      page_url: "https://www.moonarqstudio.com/",
      referrer: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      promo_email_sent: false,
      zapier_sent_at: null,
      shopify_customer_id: null,
      created_at: "2026-07-17T16:00:00.000Z",
      updated_at: "2026-07-17T16:00:00.000Z",
    },
  ],
  kpis: {
    totalSignups: 3,
    consentedSignups: 2,
    promoEmailsSent: 1,
    pendingPromoEmails: 1,
    promoEmailSendRate: 50,
    shopifyLinkedCustomers: 1,
    signupsLast24Hours: 2,
    signupsLast7Days: 3,
  },
  fetchedAt: "2026-07-18T18:00:00.000Z",
  source: {
    project: "moonarq-web",
    schema: "public",
    table: "email_signups",
    connection: "direct_supabase",
  },
} satisfies EmailMarketingSnapshot;

async function mockEmailSignups(page: Page) {
  let requestCount = 0;
  await page.route(EMAIL_SIGNUPS_API, async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store, max-age=0" },
      body: JSON.stringify({ snapshot }),
    });
  });
  return () => requestCount;
}

test.beforeEach(async ({ page }) => {
  await loginDashboard(page);
});

test("email marketing page filters mocked signups and refreshes manually", async ({ page }) => {
  const requestCount = await mockEmailSignups(page);
  await page.goto("/w/moonarq/dashboard/supabase/email-marketing");

  await expect(page.getByRole("heading", { name: "MoonArq Email Marketing" })).toBeVisible();
  await expect(page.getByText("Every 60 seconds · pauses when hidden", { exact: true })).toBeVisible();
  await expect(page.getByText("3 of 3 rows", { exact: true })).toBeVisible();

  await page.getByLabel("Search email").fill("pending@example.com");
  await expect(page.getByLabel("Search email")).toHaveValue("pending@example.com");
  await expect(page.getByText("1 of 3 rows", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Promo status").selectOption("pending");
  await expect(page.getByLabel("Promo status")).toHaveValue("pending");
  await expect(page.getByText("1 of 3 rows", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  const beforeRefresh = requestCount();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(requestCount).toBe(beforeRefresh + 1);
  await expect(page.getByText("3 of 3 rows", { exact: true })).toBeVisible();
});

test("email marketing page has no horizontal overflow on desktop or narrow mobile", async ({ page }) => {
  await mockEmailSignups(page);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/w/moonarq/dashboard/supabase/email-marketing");
    await expect(page.getByRole("heading", { name: "MoonArq Email Marketing" })).toBeVisible();

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
