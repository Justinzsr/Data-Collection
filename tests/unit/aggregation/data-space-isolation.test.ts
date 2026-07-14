import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { dailyReportToExcelXml, generateDailyReport } from "@/aggregation/services/daily-report-service";
import { getSystemHealth } from "@/aggregation/services/health-service";
import { getPlatformModules } from "@/aggregation/services/platform-modules-service";
import { getSourceDataExplorer } from "@/aggregation/services/source-data-explorer-service";
import { runDueSources } from "@/collection/sync/engine";
import { GET as listSourcesRoute, POST as createSourceRoute } from "@/app/api/sources/route";
import { listDataSpaces } from "@/storage/repositories/data-spaces-repository";
import { listSources } from "@/storage/repositories/sources-repository";
import { DATA_SPACE_IDS } from "@/storage/data-spaces";
import { resetDemoStore } from "@/storage/repositories/demo-store";

describe("data space isolation", () => {
  beforeEach(() => resetDemoStore());

  it("seeds MoonArq as the default and Auto Lab as the personal testing space", async () => {
    const spaces = await listDataSpaces();
    expect(spaces.map((space) => space.slug)).toEqual(["moonarq", "auto-lab"]);
    expect(spaces.find((space) => space.slug === "moonarq")).toMatchObject({
      id: DATA_SPACE_IDS.moonarq,
      display_name: "MoonArq",
      category: "business",
      is_default: true,
    });
    expect(spaces.find((space) => space.slug === "auto-lab")).toMatchObject({
      id: DATA_SPACE_IDS.autoLab,
      display_name: "Auto Lab",
      category: "personal",
      description: "Personal car/content account testing space",
      is_default: false,
    });
  });

  it("assigns existing demo sources to MoonArq and leaves Auto Lab empty", async () => {
    const moonarqSources = await listSources({ dataSpaceId: DATA_SPACE_IDS.moonarq });
    const autoLabSources = await listSources({ dataSpaceId: DATA_SPACE_IDS.autoLab });
    expect(moonarqSources.map((source) => source.display_name)).toContain("MoonArq Website / Vercel");
    expect(moonarqSources.map((source) => source.display_name)).toContain("MoonArq Supabase");
    expect(moonarqSources.every((source) => source.data_space_id === DATA_SPACE_IDS.moonarq)).toBe(true);
    expect(autoLabSources).toHaveLength(0);
  });

  it("defaults source API reads to MoonArq and creates Auto Lab sources in Auto Lab only", async () => {
    const createResponse = await createSourceRoute(
      new Request("https://app.example.com/api/sources", {
        method: "POST",
        body: JSON.stringify({
          data_space_slug: "auto-lab",
          source_type_key: "tiktok",
          display_name: "Auto Lab TikTok",
          input_url: "https://www.tiktok.com/@auto_lab_cars",
          normalized_url: "https://www.tiktok.com/@auto_lab_cars",
          account_name: "@auto_lab_cars",
          sync_mode: "manual",
          metadata: { intended_use: "personal_car_content_testing", scaffoldOnly: true },
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.source.data_space_id).toBe(DATA_SPACE_IDS.autoLab);

    const moonarqSources = await listSources({ dataSpaceId: DATA_SPACE_IDS.moonarq });
    const autoLabSources = await listSources({ dataSpaceId: DATA_SPACE_IDS.autoLab });
    expect(moonarqSources.map((source) => source.display_name)).not.toContain("Auto Lab TikTok");
    expect(autoLabSources.map((source) => source.display_name)).toEqual(["Auto Lab TikTok"]);

    const defaultResponse = await listSourcesRoute(new Request("https://app.example.com/api/sources"));
    const defaultBody = await defaultResponse.json();
    expect(defaultBody.sources.map((source: { display_name: string }) => source.display_name)).not.toContain("Auto Lab TikTok");
  });

  it("scopes dashboard modules, explorer rows, sync, and health by data space", async () => {
    const moonarqModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.moonarq, dataSpaceName: "MoonArq" });
    const autoLabModules = await getPlatformModules("30d", { dataSpaceId: DATA_SPACE_IDS.autoLab, dataSpaceName: "Auto Lab" });
    expect(moonarqModules.find((module) => module.sourceTypeKey === "website")?.sourceId).toBeTruthy();
    expect(moonarqModules.find((module) => module.sourceTypeKey === "supabase")?.sourceId).toBeTruthy();
    expect(autoLabModules.find((module) => module.sourceTypeKey === "website")?.sourceId).toBeNull();
    expect(autoLabModules.find((module) => module.sourceTypeKey === "supabase")?.sourceId).toBeNull();

    const moonarqExplorer = await getSourceDataExplorer({ tab: "website", range: "30d", dataSpaceId: DATA_SPACE_IDS.moonarq });
    const autoLabExplorer = await getSourceDataExplorer({ tab: "website", range: "30d", dataSpaceId: DATA_SPACE_IDS.autoLab });
    expect(moonarqExplorer.rows.length).toBeGreaterThan(0);
    expect(autoLabExplorer.rows).toHaveLength(0);

    const health = await getSystemHealth({ dataSpaceId: DATA_SPACE_IDS.autoLab });
    expect(health.sourcesTotal).toBe(0);
    expect(await runDueSources("manual", { dataSpaceId: DATA_SPACE_IDS.autoLab })).toHaveLength(0);
  });

  it("scopes Daily Report and Excel export by data space", async () => {
    const moonarqReport = await generateDailyReport("2026-04-21", (await listDataSpaces()).find((space) => space.slug === "moonarq"));
    const autoLabReport = await generateDailyReport("2026-04-21", (await listDataSpaces()).find((space) => space.slug === "auto-lab"));
    expect(moonarqReport.run.data_space_id).toBe(DATA_SPACE_IDS.moonarq);
    expect(autoLabReport.run.data_space_id).toBe(DATA_SPACE_IDS.autoLab);
    expect(autoLabReport.run.source_count).toBe(0);
    expect(autoLabReport.run.summary).toContain("Auto Lab has no sources yet");

    const moonarqWorkbook = dailyReportToExcelXml(moonarqReport);
    const autoLabWorkbook = dailyReportToExcelXml(autoLabReport);
    expect(moonarqWorkbook).toContain('ss:Name="MoonArq_Website_Vercel"');
    expect(moonarqWorkbook).toContain('ss:Name="MoonArq_Supabase"');
    expect(autoLabWorkbook).toContain('ss:Name="Summary"');
    expect(autoLabWorkbook).not.toContain("MoonArq_Website_Vercel");
    expect(autoLabWorkbook).not.toContain("MoonArq_Supabase");
  });

  it("keeps TikTok sources scoped in Daily Report and Excel source counts", async () => {
    await createSourceRoute(
      new Request("https://app.example.com/api/sources", {
        method: "POST",
        body: JSON.stringify({
          data_space_slug: "auto-lab",
          source_type_key: "tiktok",
          display_name: "Auto Lab TikTok",
          input_url: "https://www.tiktok.com/@auto_lab_cars",
          normalized_url: "https://www.tiktok.com/@auto_lab_cars",
          account_name: "@auto_lab_cars",
          sync_mode: "manual",
          metadata: { intended_use: "personal_car_content_testing", scaffoldOnly: true },
        }),
      }),
    );
    await createSourceRoute(
      new Request("https://app.example.com/api/sources", {
        method: "POST",
        body: JSON.stringify({
          data_space_slug: "moonarq",
          source_type_key: "tiktok",
          display_name: "MoonArq TikTok",
          input_url: "https://www.tiktok.com/@moonarq",
          normalized_url: "https://www.tiktok.com/@moonarq",
          account_name: "@moonarq",
          sync_mode: "manual",
          metadata: { scaffoldOnly: true },
        }),
      }),
    );
    const spaces = await listDataSpaces();
    const moonarq = spaces.find((space) => space.slug === "moonarq");
    const autoLab = spaces.find((space) => space.slug === "auto-lab");
    const [moonarqReport, autoLabReport, moonarqSources, autoLabSources] = await Promise.all([
      generateDailyReport("2026-05-12", moonarq),
      generateDailyReport("2026-05-12", autoLab),
      listSources({ dataSpaceId: DATA_SPACE_IDS.moonarq }),
      listSources({ dataSpaceId: DATA_SPACE_IDS.autoLab }),
    ]);

    expect(moonarqReport.run.source_count).toBe(moonarqSources.filter((source) => source.status !== "disabled").length);
    expect(autoLabReport.run.source_count).toBe(autoLabSources.filter((source) => source.status !== "disabled").length);
    expect(moonarqReport.run.source_count).not.toBe(autoLabReport.run.source_count);
    const moonarqWorkbook = dailyReportToExcelXml(moonarqReport);
    const autoLabWorkbook = dailyReportToExcelXml(autoLabReport);
    expect(moonarqWorkbook).toContain("MoonArq_Website_Vercel");
    expect(autoLabWorkbook).not.toContain("MoonArq_Website_Vercel");
  });

  it("adds data-space columns to generic reporting views", () => {
    const migration = readFileSync("src/storage/db/migrations/0003_data_spaces.sql", "utf8");
    expect(migration).toContain("create or replace view reporting.platform_website_daily");
    expect(migration).toContain("create or replace view reporting.platform_supabase_daily");
    expect(migration).toContain("s.data_space_id");
    expect(migration).toContain("s.data_space_slug");
    expect(migration).toContain("s.data_space_name");
    expect(migration).toContain("where data_space_slug = 'moonarq'");
  });

  it("keeps the Shopify reporting migration private and PostgreSQL aggregate filters well formed", () => {
    const migration = readFileSync("src/storage/db/migrations/0006_shopify_official_connector.sql", "utf8");
    expect(migration).toContain("create or replace view reporting.moonarq_shopify_daily");
    expect(migration).toContain("with (security_invoker = true)");
    expect(migration).toContain("upper(max(m.unit) filter (where m.unit ~ '^[a-zA-Z]{3}$'))");
    expect(migration).toContain("revoke all on reporting.moonarq_shopify_daily from anon, authenticated");
    expect(migration).not.toContain("upper(max(m.unit)) filter");
  });
});
