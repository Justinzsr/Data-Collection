import { beforeEach, describe, expect, it } from "vitest";
import { dailyReportToExcelXml, generateDailyReport, getDailyReport, shouldGenerateDailyReportNow } from "@/aggregation/services/daily-report-service";
import { resetDemoStore } from "@/storage/repositories/demo-store";

describe("daily report service", () => {
  beforeEach(() => resetDemoStore());

  it("generates an idempotent daily report for one PT date", async () => {
    const first = await generateDailyReport("2026-04-21");
    const second = await generateDailyReport("2026-04-21");
    const stored = await getDailyReport("2026-04-21");
    expect(second.run.id).toBe(first.run.id);
    expect(stored?.run.report_date).toBe("2026-04-21");
    expect(stored?.sections.length).toBeGreaterThan(0);
    expect(stored?.metrics.find((metric) => metric.metric_key === "users_total")?.value).toBeGreaterThan(0);
  });

  it("keeps Supabase snapshot totals useful even if new signups are zero", async () => {
    const report = await generateDailyReport("2026-01-01");
    expect(report.metrics.find((metric) => metric.metric_key === "new_signups")?.value).toBe(0);
    expect(report.metrics.find((metric) => metric.metric_key === "users_total")?.value).toBeGreaterThan(0);
  });

  it("exports a manual Excel-compatible workbook without secret-looking fields", async () => {
    const report = await generateDailyReport("2026-04-21");
    const workbook = dailyReportToExcelXml(report);
    expect(workbook).toContain('ss:Name="Summary"');
    expect(workbook).toContain('ss:Name="MoonArq_Website_Vercel"');
    expect(workbook).toContain('ss:Name="MoonArq_Supabase"');
    expect(workbook).not.toMatch(/service_role|encrypted_value|drain_signature|password|secret/i);
  });

  it("waits until after 7 AM PT for cron-safe generation", () => {
    expect(shouldGenerateDailyReportNow(new Date("2026-04-22T13:59:00.000Z"))).toBe(false);
    expect(shouldGenerateDailyReportNow(new Date("2026-04-22T14:00:00.000Z"))).toBe(true);
  });
});
