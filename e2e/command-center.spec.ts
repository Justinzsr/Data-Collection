import {
  expect,
  settleResponsiveLayout,
  test,
  type APIRequestContext,
  type Page,
} from "./test";
import { dashboardAuthCookie, loginDashboard } from "./auth";

async function saveSourceAndCaptureId(page: Page) {
  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/sources" && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "Save source" }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const body = await createResponse.json() as { source?: { id?: unknown } };
  expect(typeof body.source?.id).toBe("string");
  return body.source!.id as string;
}

async function deleteCreatedSources(
  request: APIRequestContext,
  cookie: string,
  sourceIds: string[],
) {
  for (const sourceId of [...sourceIds].reverse()) {
    const response = await request.delete(
      `/api/sources/${encodeURIComponent(sourceId)}?dataSpaceSlug=moonarq`,
      { headers: { cookie } },
    );
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).deleted).toBe(true);
  }
}

async function assertDeterministicDemoRuntime(request: APIRequestContext) {
  const cookie = await dashboardAuthCookie(request);
  const response = await request.get("/api/sources?dataSpaceSlug=moonarq", {
    headers: { cookie },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json() as {
    sources?: Array<{
      source_type_key?: unknown;
      metadata?: Record<string, unknown>;
    }>;
  };
  const isDemoRuntime = Array.isArray(body.sources)
    && body.sources.length > 0
    && body.sources.every((source) => source.metadata?.demo === true);
  expect(
    isDemoRuntime,
    "E2E source and sync coverage requires the deterministic local demo runtime.",
  ).toBe(true);
  const websiteSourceCount = body.sources?.filter(
    (source) => source.source_type_key === "website",
  ).length;
  expect(
    websiteSourceCount,
    "E2E cleanup must preserve exactly one deterministic Website source.",
  ).toBe(1);
}

test.beforeEach(async ({ request }) => {
  await assertDeterministicDemoRuntime(request);
});

test("MoonArq Overview leads with paid ads and one card per platform", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard");
  await expect(page.getByRole("heading", { name: "MoonArq Overview", level: 1 })).toBeVisible();
  const ads = page.getByTestId("paid-ads-overview");
  await expect(ads).toBeVisible();
  await expect(ads.getByRole("heading", { name: "Meta Ads" })).toBeVisible();
  await expect(ads.getByRole("link", { name: "Connect Meta Ads" })).toHaveAttribute(
    "href",
    /\/api\/oauth\/meta-ads\/start\?instagramSourceId=.*dataSpaceSlug=moonarq/,
  );
  const grid = page.getByTestId("overview-platform-grid");
  await expect(grid.locator("[data-testid^='platform-card-']")).toHaveCount(5);
  for (const platform of ["website", "shopify", "instagram", "tiktok", "supabase"]) {
    await expect(page.getByTestId(`platform-card-${platform}`)).toBeVisible();
  }
  await expect(page.getByTestId("overview-add-platform")).toHaveAttribute("href", "/w/moonarq/dashboard/sources/new");
  // Storefront analysis lives on the Website page now.
  await expect(page.getByTestId("business-pulse")).toHaveCount(0);
  await expect(page.getByTestId("storefront-funnel")).toHaveCount(0);
});

test("paid ads and the first row of platforms sit above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard?demo_state=ads-live");

  const placement = await page.evaluate(() => {
    const top = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().top ?? Infinity;
    return {
      scrollY: window.scrollY,
      headerTop: top("[data-testid='overview-header']"),
      adsTop: top("[data-testid='paid-ads-overview']"),
      cardTops: Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='platform-card-']"))
        .map((card) => card.getBoundingClientRect().top),
      viewportHeight: window.innerHeight,
    };
  });

  expect(placement.scrollY).toBe(0);
  expect(placement.headerTop).toBeLessThan(120);
  expect(placement.adsTop).toBeLessThan(placement.headerTop + 200);
  expect(placement.cardTops).toHaveLength(5);
  expect(placement.cardTops.filter((top) => top < placement.viewportHeight).length).toBeGreaterThanOrEqual(3);
});

function recordSyncRequests(page: Page) {
  const syncRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/sources\/[^/]+\/sync(?:\?|$)/u.test(request.url())) syncRequests.push(request.url());
  });
  return syncRequests;
}

test("live paid delivery shows today, the period with direction, and freshness", async ({ page }) => {
  await loginDashboard(page);
  const syncRequests = recordSyncRequests(page);
  await page.goto("/w/moonarq/dashboard?demo_state=ads-live");
  const ads = page.getByTestId("paid-ads-overview");
  await expect(ads).toHaveAttribute("data-ads-state", "live");
  await expect(ads.getByText("Delivering", { exact: true })).toBeVisible();
  await expect(ads.getByTestId("paid-ads-today").getByText("Spend today", { exact: true })).toBeVisible();
  await expect(ads.getByTestId("paid-ads-period").getByText("Last 30 days", { exact: true })).toBeVisible();
  for (const label of ["Spend", "Link clicks", "CTR (link)", "CPC (link)"]) {
    await expect(ads.getByTestId("paid-ads-period").getByText(label, { exact: true })).toBeVisible();
  }
  await expect(ads.locator("[data-delta]").first()).toBeVisible();
  await expect(ads.getByTestId("paid-ads-freshness")).toContainText(
    /Updated (?:just now|\d+ min ago)\. Syncs with Meta every 15 minutes while this page is open\./,
  );
  await expect(ads.getByRole("link", { name: "Ads details" })).toHaveAttribute("href", "/w/moonarq/dashboard/platforms/ads?demo_state=ads-live");

  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(/[?&]range=today(?:&|$)/);
  await expect(page.getByTestId("paid-ads-period").getByText("Yesterday", { exact: true })).toBeVisible();
  // The Ads page opens on the same range.
  await expect(ads.getByRole("link", { name: "Ads details" })).toHaveAttribute(
    "href",
    "/w/moonarq/dashboard/platforms/ads?range=today&demo_state=ads-live",
  );
  // The fixture previews the live copy but has no connection to sync.
  expect(syncRequests).toEqual([]);
});

test("old Commerce links open the Shopify page", async ({ page }) => {
  await loginDashboard(page);
  for (const path of ["/w/moonarq/dashboard/commerce", "/dashboard/commerce"]) {
    const response = await page.goto(path);
    expect(response?.ok(), path).toBe(true);
    await expect(page, path).toHaveURL(/\/w\/moonarq\/dashboard\/platforms\/shopify$/);
    await expect(page.getByRole("heading", { name: "Shopify", level: 1 })).toBeVisible();
  }
});

test("each platform card opens its detail page and leads back to the Overview", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard?range=7d");

  const routes = [
    { platform: "website", heading: "Website" },
    { platform: "shopify", heading: "Shopify" },
    { platform: "instagram", heading: "Instagram" },
    { platform: "tiktok", heading: "TikTok" },
    { platform: "supabase", heading: "Supabase" },
  ];
  for (const route of routes) {
    await page.goto("/w/moonarq/dashboard?range=7d");
    await page.getByTestId(`platform-card-${route.platform}`).getByRole("link", { name: route.heading, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/moonarq/dashboard/platforms/${route.platform}\\?range=7d$`));
    await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();
  }
  await page.getByRole("link", { name: "Overview", exact: true }).first().click();
  await expect(page).toHaveURL(/\/w\/moonarq\/dashboard$/);
});

test("the Ads page exposes the paid Story attribution and a stable no-data Meta connection state", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/platforms/ads");
  await expect(page.getByRole("heading", { name: "Meta Ads", level: 1 })).toBeVisible();
  await expect(page.getByTestId("ads-header").getByText("Not connected", { exact: true })).toBeVisible();

  const paidPanel = page.getByTestId("instagram-paid-ads-panel");
  await expect(paidPanel).toBeVisible();
  await expect(paidPanel.getByText("Paid Story attribution", { exact: true })).toBeVisible();
  await expect(paidPanel.getByText("MoonArq_IGStory_Traffic_BraceletGrid_Jul2026", { exact: true })).toBeVisible();
  await expect(paidPanel.getByText(
    "utm_source=instagram&utm_medium=paid_social&utm_campaign=bracelet_grid_jul2026&utm_content=story_v1",
    { exact: true },
  )).toBeVisible();
  await expect(paidPanel.getByText("Connect Ads", { exact: true })).toBeVisible();
  await expect(paidPanel.getByRole("link", { name: "Connect Meta Ads" })).toHaveAttribute(
    "href",
    /\/api\/oauth\/meta-ads\/start\?instagramSourceId=.*dataSpaceSlug=moonarq/,
  );
  await expect(paidPanel.getByText("Connect Meta Ads to begin", { exact: true })).toBeVisible();
  await expect(paidPanel.getByText("Creative UTM unknown", { exact: true })).toBeVisible();
  await expect(paidPanel.getByText("AIDMA paid measurement · Memory proxies", { exact: true })).toBeVisible();
  await expect(paidPanel.getByTestId("aidma-details")).toHaveJSProperty("open", true);
  await expect(paidPanel.getByRole("list", { name: "AIDMA paid media measurement ladder" })).toBeVisible();
  for (const stage of ["Attention", "Interest", "Desire", "Memory", "Action"]) {
    await expect(paidPanel.getByRole("listitem", { name: `${stage} stage` })).toBeVisible();
  }
  await expect(paidPanel.getByText(/behavioral proxies, not a direct measurement of human memory/)).toBeVisible();
  await expect(paidPanel.getByTestId("paid-raw-efficiency")).toHaveJSProperty("open", false);
  await expect(paidPanel.getByTestId("paid-budget-pacing")).toHaveJSProperty("open", false);
  await expect(paidPanel.getByTestId("paid-memory-economics")).toHaveJSProperty("open", false);
});

test("the Ads page breaks live delivery into today, the period, daily charts, and campaigns", async ({ page }) => {
  await loginDashboard(page);
  const syncRequests = recordSyncRequests(page);
  await page.goto("/w/moonarq/dashboard/platforms/ads?demo_state=ads-live");
  await expect(page.getByTestId("ads-header").getByText("Delivering", { exact: true })).toBeVisible();
  await expect(page.getByTestId("paid-ads-today-strip")).toContainText("Yesterday");
  await expect(page.getByTestId("paid-ads-today-strip").getByTestId("ads-freshness")).toContainText(
    "Syncs with Meta every 15 minutes while this page is open.",
  );
  await expect(page.getByTestId("ads-period-metrics").locator("[data-metric]")).toHaveCount(8);
  await expect(page.getByTestId("ads-daily-spend").locator(".recharts-bar-rectangle").first()).toBeVisible();
  const campaigns = page.getByRole("region", { name: "Scrollable campaigns table" });
  await expect(campaigns.getByRole("rowheader")).toHaveCount(3);
  await expect(campaigns.getByRole("rowheader").first()).toContainText("Moonlit Studio Reels");
  await expect(campaigns.getByText("Paused", { exact: true })).toBeVisible();
  expect(syncRequests).toEqual([]);
});

test("Shopify CTA opens the official connector directly and keeps credentials empty", async ({ page, request }) => {
  const cookie = await dashboardAuthCookie(request);
  const createdSourceIds: string[] = [];
  await loginDashboard(page);
  try {
    await page.goto("/w/moonarq/dashboard/sources/new?template=shopify");
    await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
    await expect(page.getByRole("heading", { name: "Configure Shopify" })).toBeVisible();
    await page.getByLabel("Public source URL").fill("https://e2e-shop.myshopify.com");
    await page.getByRole("button", { name: "Check URL" }).click();
    await expect(page.getByText("URL matches Shopify")).toBeVisible();
    await page.getByRole("button", { name: "Review connection" }).click();
    await expect(page.getByText("Encrypted server credentials", { exact: true })).toBeVisible();
    createdSourceIds.push(await saveSourceAndCaptureId(page));
    await page.getByText("Additional encrypted settings").click();
    await expect(page.getByLabel("Shopify Client ID")).toHaveValue("");
    await expect(page.getByLabel("Shopify Client secret")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Save Credentials" })).toBeVisible();
  } finally {
    await deleteCreatedSources(request, cookie, createdSourceIds);
  }
});

test("add source wizard detects Supabase and Website and shows credentials after save", async ({ page, request }) => {
  const cookie = await dashboardAuthCookie(request);
  const createdSourceIds: string[] = [];
  await loginDashboard(page);
  try {
    await page.goto("/w/moonarq/dashboard/sources/new");
    await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
    await page.getByRole("button", { name: /Supabase/ }).click();
    await page.getByLabel("Public source URL").fill("https://xxxxx.supabase.co");
    await page.getByRole("button", { name: "Check URL" }).click();
    await page.getByRole("button", { name: "Review connection" }).click();
    createdSourceIds.push(await saveSourceAndCaptureId(page));
    await page.getByText("Additional encrypted settings").click();
    await expect(page.getByLabel("Service role key")).toBeVisible();
    await expect(page.getByLabel("Anon key")).toHaveCount(0);
    await page.getByLabel("Service role key").fill("fake-service-role-value");
    await page.getByRole("button", { name: "Save Credentials" }).click();
    await expect(page.getByText("fake••••alue")).toBeVisible();

    await page.goto("/w/moonarq/dashboard/sources/new");
    await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
    await page.getByRole("button", { name: /Website Tracker/ }).click();
    await page.getByRole("button", { name: /First-party Website Tracker/ }).click();
    await page.getByRole("button", { name: "Check URL" }).click();
    await page.getByRole("button", { name: "Review connection" }).click();
    await expect(page.getByText("Advanced sync settings")).toBeVisible();
    await expect(page.getByText("Event-driven webhook").first()).toBeVisible();
    await expect(page.getByText("Manual only")).toHaveCount(0);
    createdSourceIds.push(await saveSourceAndCaptureId(page));
    await expect(page.getByText("First-party tracker").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open tracker snippet" })).toBeVisible();
  } finally {
    await deleteCreatedSources(request, cookie, createdSourceIds);
  }
});

test("add source wizard prepares MoonArq Instagram OAuth", async ({ page, request }) => {
  const cookie = await dashboardAuthCookie(request);
  const createdSourceIds: string[] = [];
  await loginDashboard(page);
  try {
    await page.goto("/w/moonarq/dashboard/sources/new");
    await expect(page.getByTestId("add-source-wizard")).toHaveAttribute("data-onboarding-ready", "true");
    await page.getByRole("button", { name: /Instagram/ }).click();
    await page.getByRole("button", { name: "Check URL" }).click();
    await page.getByRole("button", { name: "Review connection" }).click();
    createdSourceIds.push(await saveSourceAndCaptureId(page));
    const connect = page.getByRole("link", { name: "Connect Instagram" });
    await expect(connect).toBeVisible();
    await expect(connect).toHaveAttribute("href", /dataSpaceSlug=moonarq/);
    await expect(page.getByLabel("Instagram account ID")).toHaveCount(0);
  } finally {
    await deleteCreatedSources(request, cookie, createdSourceIds);
  }
});

test("events page shows non-empty JavaScript tracking snippet", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/events");
  await page.getByText("Endpoints, tracking snippets, and setup").click();
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("moonarq_anonymous_id").first()).toBeVisible();
  await expect(page.getByText("moonarq_session_id").first()).toBeVisible();
  await expect(page.getByText("/api/track").first()).toBeVisible();
});

test("credential API routes save masked hints and delete credentials", async ({ request }) => {
  const cookie = await dashboardAuthCookie(request);
  const createdSourceIds: string[] = [];
  try {
    const createResponse = await request.post("/api/sources", {
      headers: { cookie },
      data: {
        source_type_key: "supabase",
        display_name: "Supabase API route test",
        input_url: "https://xxxxx.supabase.co",
        normalized_url: "https://xxxxx.supabase.co",
        account_name: "xxxxx",
        sync_mode: "hybrid",
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const { source } = await createResponse.json();
    createdSourceIds.push(source.id);

    const fieldsResponse = await request.get(`/api/sources/${source.id}/credentials`, { headers: { cookie } });
    expect(fieldsResponse.ok()).toBeTruthy();
    const fieldsBody = await fieldsResponse.json();
    expect(fieldsBody.fields.map((field: { key: string }) => field.key)).toContain("service_role_key");
    expect(fieldsBody.fields.map((field: { key: string }) => field.key)).not.toContain("anon_key");

    const saveResponse = await request.post(`/api/sources/${source.id}/credentials`, {
      headers: { cookie },
      data: { credentials: { service_role_key: "fake-service-role-value" } },
    });
    expect(saveResponse.ok()).toBeTruthy();
    const saveBody = await saveResponse.json();
    expect(JSON.stringify(saveBody)).not.toContain("fake-service-role-value");
    expect(saveBody.saved.find((item: { field_key: string }) => item.field_key === "service_role_key").value_hint).toBe("fake••••alue");

    const deleteResponse = await request.delete(`/api/sources/${source.id}/credentials/service_role_key`, { headers: { cookie } });
    expect(deleteResponse.ok()).toBeTruthy();
    expect((await deleteResponse.json()).deleted).toBe(true);
  } finally {
    await deleteCreatedSources(request, cookie, createdSourceIds);
  }
});

test("source detail pages show setup, credentials, actions, and website snippets", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources/22222222-2222-4222-8222-222222222222");
  await expect(page.getByRole("heading", { name: "MoonArq Supabase" })).toBeVisible();
  await expect(page.getByText("Connection state")).toBeVisible();
  await page.getByText("Credentials and connection settings").click();
  await expect(page.getByLabel("Service role key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test Connection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Sync Now" })).toBeVisible();
  await page.getByText("Instructions, endpoints, and code snippets").click();
  await expect(page.getByText(/public\.profiles/).first()).toBeVisible();

  await page.goto("/w/moonarq/dashboard/sources/11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("heading", { name: "MoonArq Website / Vercel" })).toBeVisible();
  await page.getByText("Instructions, endpoints, and code snippets").click();
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
});

test("sources page supports sync controls", async ({ page }) => {
  await loginDashboard(page);
  await page.goto("/w/moonarq/dashboard/sources");
  await expect(page.getByRole("heading", { name: "MoonArq Source management" })).toBeVisible();
  const sourceContainer = page.getByTestId(
    (await page.getByTestId("source-row-22222222-2222-4222-8222-222222222222").isVisible())
      ? "source-row-22222222-2222-4222-8222-222222222222"
      : "source-card-22222222-2222-4222-8222-222222222222",
  );
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/sources/") && response.url().includes("/sync"));
  await sourceContainer.getByRole("button", { name: /^Sync$/ }).click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(500);
  await expect(page.getByRole("main").getByText(/Sync (success|failed)/)).toBeVisible();
});

test("mobile dashboard has no horizontal overflow", async ({ page }) => {
  await loginDashboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/w/moonarq/dashboard?demo_state=ads-live");
  await settleResponsiveLayout(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("paid-ads-overview")).toBeVisible();
  await expect(page.getByTestId("overview-platform-grid")).toBeVisible();
  // Phones get one compact row per platform so every platform fits on about one screen.
  const cardHeights = await page.locator("[data-testid^='platform-card-']").evaluateAll((cards) =>
    cards.map((card) => card.getBoundingClientRect().height));
  expect(cardHeights).toHaveLength(5);
  expect(cardHeights.every((height) => height <= 140)).toBe(true);
});
