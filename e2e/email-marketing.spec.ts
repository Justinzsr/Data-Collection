import { expect, test, type Page } from "@playwright/test";
import type { EmailMarketingSnapshot } from "@/aggregation/services/email-marketing-service";
import { loginDashboard } from "./auth";
import { settleResponsiveLayout } from "./test";

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
  const mock = await mockMutableEmailSignups(page);
  return mock.requestCount;
}

type MockResponseMode = "success" | "network" | 401 | 403 | 500;

async function mockMutableEmailSignups(page: Page) {
  let requestCount = 0;
  let mode: MockResponseMode = "success";
  await page.route(EMAIL_SIGNUPS_API, async (route) => {
    requestCount += 1;
    if (mode === "network") {
      await route.abort("failed");
      return;
    }
    if (mode !== "success") {
      await route.fulfill({
        status: mode,
        contentType: "application/json",
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          Vary: "Cookie",
        },
        body: JSON.stringify({ error: "Synthetic protected failure body must not render." }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Vary: "Cookie",
      },
      body: JSON.stringify({ snapshot }),
    });
  });
  return {
    requestCount: () => requestCount,
    setMode: (nextMode: MockResponseMode) => {
      mode = nextMode;
    },
  };
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

for (const status of [401, 403] as const) {
  test(`email marketing clears protected DOM and locks after a ${status} refresh`, async ({ page }) => {
    const mock = await mockMutableEmailSignups(page);
    await page.goto("/w/moonarq/dashboard/supabase/email-marketing");
    await expect(page.getByText("sent@example.com", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("gid://shopify/Customer/101", { exact: true }).filter({ visible: true }).first()).toBeVisible();

    const protectedSearchValue = "search-private@example.com";
    await page.getByLabel("Search email").fill(protectedSearchValue);
    mock.setMode(status);
    const beforeRefresh = mock.requestCount();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(mock.requestCount).toBe(beforeRefresh + 1);
    await expect(page.getByRole("heading", { name: "Email Marketing is locked" })).toBeVisible();

    const html = await page.locator("html").innerHTML();
    expect(html).not.toContain("sent@example.com");
    expect(html).not.toContain("gid://shopify/Customer/101");
    expect(html).not.toContain(protectedSearchValue);
    expect(html).not.toContain("Synthetic protected failure body must not render.");
    await expect(page.getByLabel("Search email")).toHaveCount(0);
    await expect(page.getByText("Stale", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Showing the last successful dataset.", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Return to private login" })).toHaveAttribute(
      "href",
      "/login?next=%2Fw%2Fmoonarq%2Fdashboard%2Fsupabase%2Femail-marketing",
    );
  });
}

for (const mode of [500, "network"] as const) {
  test(`email marketing retains a stale snapshot after a ${mode} refresh failure`, async ({ page }) => {
    const mock = await mockMutableEmailSignups(page);
    await page.goto("/w/moonarq/dashboard/supabase/email-marketing");
    await expect(page.getByText("sent@example.com", { exact: true }).filter({ visible: true }).first()).toBeVisible();

    mock.setMode(mode);
    const beforeRefresh = mock.requestCount();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(mock.requestCount).toBe(beforeRefresh + 1);

    await expect(page.getByText("Stale", { exact: true })).toBeVisible();
    await expect(page.getByText("Showing the last successful dataset.", { exact: true })).toBeVisible();
    await expect(page.getByText("sent@example.com", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText("gid://shopify/Customer/101", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Email Marketing is locked" })).toHaveCount(0);
  });
}

test("unauthenticated Email Marketing UI and API expose no protected data", async ({ page }) => {
  await page.context().clearCookies();
  const response = await page.request.get("/api/metrics/email-signups?dataSpaceSlug=moonarq");
  const responseText = await response.text();
  const headers = response.headers();

  expect(response.status()).toBe(401);
  expect(responseText).toBe('{"error":"Unauthorized."}');
  expect(responseText).not.toMatch(/@|shopify|customer|signup/iu);
  expect(headers["cache-control"]).toBe("private, no-store, max-age=0");
  expect(headers.pragma).toBe("no-cache");
  expect(headers.vary.split(",").map((value) => value.trim())).toContain("Cookie");

  await page.goto("/w/moonarq/dashboard/supabase/email-marketing");
  await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fmoonarq%2Fdashboard%2Fsupabase%2Femail-marketing/u);
  await expect(page.getByRole("heading", { name: "MoonArq private login" })).toBeVisible();
  const html = await page.locator("html").innerHTML();
  expect(html).not.toContain("sent@example.com");
  expect(html).not.toContain("gid://shopify/Customer/101");
});

test("new Overview Supabase card opens the Email Marketing page", async ({ page }) => {
  await mockEmailSignups(page);
  await page.goto("/w/moonarq/dashboard");

  const supabaseModule = page.getByTestId("overview-module-supabase");
  await supabaseModule.getByTestId("overview-module-summary-supabase").click();
  await expect(supabaseModule).toHaveJSProperty("open", true);
  const emailMarketingLink = supabaseModule.getByRole("link", { name: "Email Marketing", exact: true });
  await expect(emailMarketingLink).toHaveAttribute(
    "href",
    "/w/moonarq/dashboard/supabase/email-marketing",
  );
  await emailMarketingLink.click();

  await expect(page).toHaveURL("/w/moonarq/dashboard/supabase/email-marketing");
  await expect(page.getByRole("heading", { name: "MoonArq Email Marketing" })).toBeVisible();
});

test("email marketing page has no horizontal overflow on desktop or narrow mobile", async ({ page }) => {
  await mockEmailSignups(page);

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 360, height: 780 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/w/moonarq/dashboard/supabase/email-marketing");
    await expect(page.getByRole("heading", { name: "MoonArq Email Marketing" })).toBeVisible();
    await settleResponsiveLayout(page);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
