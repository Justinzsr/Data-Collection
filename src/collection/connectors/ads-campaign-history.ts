import "server-only";
import { createHash } from "node:crypto";
import type { NormalizedMetric } from "@/collection/connectors/types";
import type { JsonRecord, Source } from "@/storage/db/schema";

export type AdsHistoryPlatform = "meta_ads" | "chatgpt_ads";
export type AdsHistoryAccount = { id: string; currency: string; timeZone: string };
export type AdsCampaignHistoryRow = { campaignId: string; campaignName: string; spend: number; impressions: number; clicks: number };
export type AdsCampaignHistoryReport = {
  platform: AdsHistoryPlatform;
  accountId: string;
  currency: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  rows: AdsCampaignHistoryRow[];
  reportHash: string;
  /** Allowlisted response evidence only; never part of content identity or metric dimensions. */
  evidence?: { rows: JsonRecord[]; pages?: JsonRecord[] };
};
export type AdsCampaignHistory =
  | { status: "available"; report: AdsCampaignHistoryReport }
  | { status: "unavailable"; error: string };

export function adsHistoryDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function adsHistoryDateInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const date = `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  if (!adsHistoryDate(date)) throw new Error("Ads history has an invalid account-local date.");
  return date;
}

export function adsHistoryWindow(platform: AdsHistoryPlatform, fetchedAt: string, timeZone: string) {
  const today = adsHistoryDateInTimeZone(new Date(fetchedAt), timeZone);
  const end = new Date(`${today}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  if (platform === "chatgpt_ads") start.setUTCDate(start.getUTCDate() - 364);
  else {
    const afterRetentionBoundary = (reference: Date) => {
      // Clamp the day before subtracting months (March 31 must not overflow into March).
      const targetMonth = reference.getUTCFullYear() * 12 + reference.getUTCMonth() - 37;
      const year = Math.floor(targetMonth / 12);
      const month = ((targetMonth % 12) + 12) % 12;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const boundary = new Date(Date.UTC(year, month, Math.min(reference.getUTCDate(), lastDay)));
      boundary.setUTCDate(boundary.getUTCDate() + 1);
      return boundary;
    };
    // The API retention cap is relative to now, not the completed-day report end.
    start.setTime(Math.max(afterRetentionBoundary(end).getTime(), afterRetentionBoundary(new Date(`${today}T00:00:00.000Z`)).getTime()));
  }
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

/** Only used to prove the observed UTC-label/zero-row metadata inconsistency. */
export function adsHistoryEpochCoverage(start: unknown, end: unknown, startDate: string, endDate: string, timeZone: string) {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return false;
  const first = new Date(start * 1_000);
  const last = new Date(end * 1_000);
  if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) return false;
  const next = new Date(`${endDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const midnight = (date: Date) => {
      const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      return parts.hour === "00" && parts.minute === "00" && parts.second === "00" ? `${parts.year}-${parts.month}-${parts.day}` : null;
    };
    return midnight(first) === startDate && midnight(last) === next.toISOString().slice(0, 10);
  } catch { return false; }
}

/** Report values are account-currency main units; missing and invalid values never become zero. */
export function adsHistoryNumber(value: unknown, count = false): number {
  if ((typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && !/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.trim()))) {
    throw new Error("Ads history returned an unavailable or invalid metric.");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (count && !Number.isSafeInteger(number))) {
    throw new Error("Ads history returned an unavailable or invalid metric.");
  }
  return number;
}

export function createAdsCampaignHistoryReport(input: Omit<AdsCampaignHistoryReport, "reportHash">): AdsCampaignHistoryReport {
  if (typeof input.accountId !== "string" || !input.accountId.trim() || input.accountId !== input.accountId.trim() || !/^[A-Z]{3}$/u.test(input.currency)
    || !adsHistoryDate(input.startDate) || !adsHistoryDate(input.endDate) || input.startDate > input.endDate) {
    throw new Error("Ads history returned invalid account, currency, or reporting coverage.");
  }
  adsHistoryDateInTimeZone(new Date(`${input.endDate}T12:00:00Z`), input.timeZone);
  const byId = new Map<string, AdsCampaignHistoryRow>();
  for (const row of input.rows) {
    if (typeof row.campaignId !== "string" || !row.campaignId.trim() || row.campaignId !== row.campaignId.trim()
      || typeof row.campaignName !== "string") throw new Error("Ads history returned an invalid campaign identity.");
    const canonical = {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      spend: adsHistoryNumber(row.spend),
      impressions: adsHistoryNumber(row.impressions, true),
      clicks: adsHistoryNumber(row.clicks, true),
    };
    const previous = byId.get(canonical.campaignId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(canonical)) throw new Error("Ads history returned conflicting duplicate campaigns.");
    byId.set(canonical.campaignId, canonical);
  }
  const report = {
    platform: input.platform,
    accountId: input.accountId,
    currency: input.currency,
    timeZone: input.timeZone,
    startDate: input.startDate,
    endDate: input.endDate,
    rows: [...byId.values()].sort((left, right) => left.campaignId < right.campaignId ? -1 : left.campaignId > right.campaignId ? 1 : 0),
  };
  return { ...report, reportHash: createHash("sha256").update(JSON.stringify(report)).digest("hex") };
}

export function adsCampaignHistoryCursor(history: AdsCampaignHistory | undefined): JsonRecord {
  if (!history) return {};
  if (history.status === "unavailable") return { historyStatus: "unavailable", historyError: history.error };
  return { historyStatus: "available", historyReportHash: history.report.reportHash, historyReportStart: history.report.startDate, historyReportEnd: history.report.endDate };
}

/** The shared engine must persist the report marker and campaign facts in one transaction. */
export function adsCampaignHistoryMetrics(
  history: AdsCampaignHistory | undefined,
  source: Source,
  account: AdsHistoryAccount,
  fetchedAt: string,
): NormalizedMetric[] {
  if (!history || history.status !== "available") return [];
  const report = createAdsCampaignHistoryReport(history.report);
  const selectedAccount = report.platform === "meta_ads" ? source.external_account_id?.replace(/^act_/u, "") : source.external_account_id;
  if (report.platform !== source.source_type_key || report.accountId !== account.id
    || (selectedAccount && selectedAccount !== account.id) || report.currency !== account.currency || report.timeZone !== account.timeZone || report.reportHash !== history.report.reportHash) {
    throw new Error("Ads history snapshot does not match its verified account or report hash.");
  }
  const date = adsHistoryDateInTimeZone(new Date(fetchedAt), account.timeZone);
  const dimensions: JsonRecord = {
    account_id: account.id, account_currency: account.currency, account_timezone: account.timeZone,
    report_start: report.startDate, report_end: report.endDate, report_hash: report.reportHash,
  };
  const metric = (suffix: string, value: number, unit: string, extra: JsonRecord): NormalizedMetric => ({
    date, sourceId: source.id, sourceTypeKey: source.source_type_key,
    metricKey: `${report.platform}_history_${suffix}`, metricValue: value, unit,
    dimensions: { ...dimensions, ...extra },
  });
  return [
    metric("campaign_count", report.rows.length, "count", { rollup: "campaign_history_report" }),
    ...report.rows.flatMap((row) => {
      const campaign = { rollup: "campaign_history_total", campaign_id: row.campaignId, campaign_name: row.campaignName };
      return [metric("spend", row.spend, account.currency, campaign), metric("impressions", row.impressions, "count", campaign), metric("clicks", row.clicks, "count", campaign)];
    }),
  ];
}
