import { expect, test } from "@playwright/test";

test("dashboard shows platform modules and sparklines", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "MoonArq Data Command Center" })).toBeVisible();
  for (const label of ["Website / Vercel Site", "Supabase", "TikTok", "Instagram", "Shopify"]) {
    await expect(page.locator("article").filter({ hasText: label }).first()).toBeVisible();
  }
  await expect(page.getByTestId("platform-sparkline").first()).toBeVisible();
});

test("add source wizard detects Supabase and Website and shows credentials after save", async ({ page }) => {
  await page.goto("/dashboard/sources/new");
  await page.getByLabel("Paste a source link or identifier").fill("https://xxxxx.supabase.co");
  await page.getByRole("button", { name: "Detect" }).click();
  await expect(page.getByText("Supabase").first()).toBeVisible();
  await page.getByRole("button", { name: "Save Source" }).click();
  await expect(page.getByLabel("Service role key")).toBeVisible();
  await expect(page.getByLabel("Anon key")).toBeVisible();
  await page.getByLabel("Service role key").fill("fake-service-role-value");
  await page.getByRole("button", { name: "Save Credentials" }).click();
  await expect(page.getByText("fake••••alue")).toBeVisible();

  await page.goto("/dashboard/sources/new");
  await page.getByLabel("Paste a source link or identifier").fill("https://example.com");
  await page.getByRole("button", { name: "Detect" }).click();
  await expect(page.getByText("Website tracking").first()).toBeVisible();
  await page.getByRole("button", { name: "Save Source" }).click();
  await expect(page.getByText("Website tracking setup")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Source Snippet" })).toBeVisible();
});

test("events page shows non-empty JavaScript tracking snippet", async ({ page }) => {
  await page.goto("/dashboard/events");
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
  await expect(page.getByText("moonarq_anonymous_id").first()).toBeVisible();
  await expect(page.getByText("moonarq_session_id").first()).toBeVisible();
  await expect(page.getByText("/api/track").first()).toBeVisible();
});

test("credential API routes save masked hints and delete credentials", async ({ request }) => {
  const createResponse = await request.post("/api/sources", {
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

  const fieldsResponse = await request.get(`/api/sources/${source.id}/credentials`);
  expect(fieldsResponse.ok()).toBeTruthy();
  const fieldsBody = await fieldsResponse.json();
  expect(fieldsBody.fields.map((field: { key: string }) => field.key)).toContain("service_role_key");

  const saveResponse = await request.post(`/api/sources/${source.id}/credentials`, {
    data: { credentials: { service_role_key: "fake-service-role-value" } },
  });
  expect(saveResponse.ok()).toBeTruthy();
  const saveBody = await saveResponse.json();
  expect(JSON.stringify(saveBody)).not.toContain("fake-service-role-value");
  expect(saveBody.saved.find((item: { field_key: string }) => item.field_key === "service_role_key").value_hint).toBe("fake••••alue");

  const deleteResponse = await request.delete(`/api/sources/${source.id}/credentials/service_role_key`);
  expect(deleteResponse.ok()).toBeTruthy();
  expect((await deleteResponse.json()).deleted).toBe(true);
});

test("source detail pages show setup, credentials, actions, and website snippets", async ({ page }) => {
  await page.goto("/dashboard/sources/22222222-2222-4222-8222-222222222222");
  await expect(page.getByRole("heading", { name: "MoonArq Supabase" })).toBeVisible();
  await expect(page.getByText("Connection state")).toBeVisible();
  await expect(page.getByLabel("Service role key")).toBeVisible();
  await expect(page.getByRole("button", { name: "Test Connection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Sync Now" })).toBeVisible();
  await expect(page.getByText("MoonArq public.profiles setup")).toBeVisible();

  await page.goto("/dashboard/sources/11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("heading", { name: "MoonArq Website" })).toBeVisible();
  await expect(page.getByText("Lightweight JavaScript snippet")).toBeVisible();
  await expect(page.getByText("window.moonarqTrack").first()).toBeVisible();
});

test("sources page supports sync controls", async ({ page }) => {
  await page.goto("/dashboard/sources");
  await expect(page.getByText("Connected platform command grid")).toBeVisible();
  await page.getByRole("button", { name: /^Sync$/ }).first().click();
  await expect(page.getByText(/Sync (success|skipped)/)).toBeVisible();
});

test("mobile dashboard has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByText("Website / Vercel Site").first()).toBeVisible();
});
